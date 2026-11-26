/**
 * Offline scoring and parsing. Used (a) as the free scorer for high-volume LinkedIn X-Ray sourcing and (b) when the
 * AI is unavailable (no key, quota used up, outage). Candidate scoring is a weighted, explainable model; see
 * scoreCandidate below. Results are marked with a heuristic model name so the UI can label them "Quick score".
 */
import { stripIndianMobiles } from "@/server/sourcing/phone";
import type { JobTextInput } from "./profileText";

/** Fallback score when the AI is unavailable. Upgraded to an AI score on a later run (see resetUnscoredMatches). */
export const HEURISTIC_MODEL = "heuristic";
/** Score from the free LinkedIn X-Ray pipeline. Deliberately NOT upgraded to AI: that would spend credits. */
export const XRAY_HEURISTIC_MODEL = "xray-heuristic";

/** How a match was scored, for the UI: "xray" = free weighted LinkedIn score (by design), "quick" = AI fallback, "ai". */
/** Model name stored for scores produced by the Naukri browser extension. */
export const NAUKRI_EXT_MODEL = "naukri-ext";

export const scoredByOf = (model: string | null | undefined): "ai" | "quick" | "xray" | "extension" =>
  model === XRAY_HEURISTIC_MODEL ? "xray" : model === HEURISTIC_MODEL ? "quick" : model === NAUKRI_EXT_MODEL ? "extension" : "ai";

/** True for every score produced without an AI model. */
export const isQuickScoreModel = (model: string | null | undefined): boolean =>
  model === HEURISTIC_MODEL || model === XRAY_HEURISTIC_MODEL;

/** Known synonyms / abbreviations. Keys and values are lower case. */
const SYNONYMS: Record<string, string[]> = {
  postgresql: ["postgres", "psql", "postgresql"],
  kubernetes: ["k8s", "kubernetes"],
  javascript: ["js", "javascript", "ecmascript", "es6"],
  typescript: ["ts", "typescript"],
  "node.js": ["node", "nodejs", "node.js"],
  go: ["golang", "go"],
  "c#": ["c#", "csharp", ".net", "dotnet"],
  ".net": [".net", "dotnet", "asp.net"],
  "c++": ["c++", "cpp"],
  react: ["react", "reactjs", "react.js"],
  "next.js": ["next.js", "nextjs"],
  vue: ["vue", "vuejs", "vue.js"],
  angular: ["angular", "angularjs"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud"],
  azure: ["azure"],
  "machine learning": ["machine learning", "ml"],
  "artificial intelligence": ["artificial intelligence", "ai"],
  "rest api": ["rest", "restful", "rest api", "rest apis"],
  graphql: ["graphql"],
  mongodb: ["mongodb", "mongo"],
  docker: ["docker", "containers", "containerization"],
  "jupyter notebook": ["jupyter", "jupyter notebook"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  pytorch: ["pytorch", "torch"],
  tensorflow: ["tensorflow", "tf"],
};

/**
 * One-way evidence: the KEY skill is shown by any of these, but not the other way round
 * ("SQL" is evidenced by "MySQL", yet a JD asking for SQL does not ask for MySQL).
 */
const UMBRELLAS: Record<string, string[]> = {
  sql: ["mysql", "postgresql", "postgres", "sqlite", "t-sql", "pl/sql", "mssql"],
  "ci/cd": ["cicd", "continuous integration", "github actions", "jenkins", "gitlab ci"],
  terraform: ["hcl"],
  spark: ["pyspark", "apache spark"],
};

/** GitHub language names (as GitHub spells them) that can be used in a user search. */
export const GITHUB_LANGUAGES = [
  "Python", "JavaScript", "TypeScript", "Java", "Go", "Rust", "C++", "C#", "C", "Ruby", "PHP", "Kotlin", "Swift",
  "Scala", "Dart", "R", "Elixir", "Haskell", "Clojure", "Shell", "Objective-C", "Lua", "Perl", "Julia", "Solidity",
  "HCL", "Jupyter Notebook", "MATLAB", "Groovy", "F#", "Erlang", "OCaml", "Zig", "Vue", "PowerShell",
];

/** Frameworks that imply a GitHub language. */
const FRAMEWORK_LANGUAGE: Record<string, string> = {
  django: "Python", flask: "Python", fastapi: "Python", pandas: "Python", numpy: "Python", pytorch: "Python",
  tensorflow: "Python", "scikit-learn": "Python", sqlalchemy: "Python", celery: "Python",
  react: "JavaScript", "node.js": "JavaScript", express: "JavaScript", angular: "TypeScript", "next.js": "TypeScript", nestjs: "TypeScript",
  vue: "JavaScript", spring: "Java", "spring boot": "Java", hibernate: "Java",
  rails: "Ruby", "ruby on rails": "Ruby", laravel: "PHP", symfony: "PHP", ".net": "C#", "asp.net": "C#",
  flutter: "Dart", android: "Kotlin", ios: "Swift", swiftui: "Swift", gin: "Go",
};

/** Common technical skills recognised in JDs when the AI is not available. */
const TECH_TERMS = [
  ...GITHUB_LANGUAGES.filter((language) => !["C", "R", "Vue"].includes(language)),
  "React", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI",
  "Spring Boot", "Spring", "Hibernate", "Rails", "Laravel", "Symfony", ".NET", "ASP.NET", "Flutter", "React Native",
  "Android", "iOS", "SwiftUI", "GraphQL", "REST API", "gRPC", "Kafka", "RabbitMQ", "Redis", "PostgreSQL", "MySQL",
  "MongoDB", "Elasticsearch", "Cassandra", "DynamoDB", "SQLite", "Snowflake", "BigQuery", "Spark", "Hadoop", "Airflow",
  "dbt", "Pandas", "NumPy", "PyTorch", "TensorFlow", "scikit-learn", "Machine Learning", "Deep Learning", "NLP",
  "Computer Vision", "LLM", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Linux", "CI/CD",
  "Git", "Microservices", "SQLAlchemy", "Celery", "Alembic", "Tailwind", "HTML", "CSS", "SQL", "Figma", "Jest",
  "Cypress", "Selenium", "Playwright", "Prometheus", "Grafana", "Datadog", "Power BI", "Tableau", "Excel", "Salesforce",
  "SAP", "Jira", "Agile", "Scrum",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-token test, so "R" does not match every word but "C++" and "Node.js" still work. */
export function hasTerm(text: string, term: string): boolean {
  const cleaned = term.trim();
  if (!cleaned) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(cleaned)}(?![a-z0-9])`, "i").test(text);
}

/** All spellings that count as evidence for a skill. */
export function aliasesOf(skill: string, options: { umbrella?: boolean } = {}): string[] {
  const key = skill.trim().toLowerCase().replace(/^apache\s+/, "");
  const symmetric = SYNONYMS[key] ?? Object.entries(SYNONYMS).find(([, list]) => list.includes(key))?.[1] ?? [];
  const umbrella = options.umbrella === false ? [] : (UMBRELLAS[key] ?? []);
  const fromMap = [...symmetric, ...umbrella, ...(key !== skill.trim().toLowerCase() ? [key] : [])];
  // Very short aliases ("ts", "ml", "ai", "go") are too ambiguous on their own unless they ARE the skill.
  const safe = fromMap.filter((alias) => alias.length > 2 || alias === key);
  return [...new Set([skill.trim(), ...safe])];
}

/** True when the text shows the skill (or a known synonym). */
export function textHasSkill(text: string, skill: string, options: { umbrella?: boolean } = {}): boolean {
  return aliasesOf(skill, options).some((alias) => hasTerm(text, alias));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ---------------------------------------------------------------------------------------------
// Candidate scoring: multi-dimensional, weighted, fully offline (no AI, no cost)
//
//   40%  Semantic skill match      must-haves weigh 3x nice-to-haves; related skills earn partial credit
//   30%  Experience & tenure       skills used in RECENT roles count more; years fit; job-title fit
//   15%  Competency & impact       action verbs and metric-driven achievements ("cut latency 40%")
//   15%  Industry alignment        domain relevance (SaaS vs. e-commerce vs. fintech ...)
//
// Quality gate: a candidate who shows less than half of the must-have skills can never reach Tier 1 (>80),
// however good the rest looks. This is what keeps the "absolute best fits" list honest.
// ---------------------------------------------------------------------------------------------

/** The four dimensions and their weights. They add up to 1. */
export const SCORE_WEIGHTS = { skills: 0.4, experience: 0.3, impact: 0.15, industry: 0.15 } as const;

/** A score ABOVE this is Tier 1 (the shortlist-quality band). Paid enrichment has its own, lower line: ENRICHMENT_MIN_SCORE. */
export const TIER1_THRESHOLD = 80;

/** Without evidence for at least half of the must-haves a candidate is capped below Tier 1. */
const MUST_HAVE_GATE = 0.5;
const GATED_SCORE_CAP = 70; // below the 75% enrichment line, so gated candidates never cost credits
const NO_MUST_HAVE_SCORE_CAP = 45;

const SKILL_WEIGHT = { required: 3, language: 2, preferred: 1 } as const;
const RELATED_CREDIT = 0.4;

/** What the scorer needs to know about a job. JobTextInput plus optional extras that JobDetails already carries. */
export interface ScoringJob extends JobTextInput {
  experienceYears?: number | null;
  seniority?: string | null;
}

/** Each dimension as 0-100 (before weighting), so the UI / logs can explain a score. */
export interface ScoreBreakdown {
  skills: number;
  experience: number;
  impact: number;
  industry: number;
}

export interface HeuristicMatch {
  score: number;
  /** Skills with direct evidence (the skill itself or a known synonym). */
  matchedSkills: string[];
  /** Skills without direct evidence. A related skill (e.g. MySQL for PostgreSQL) earns partial score but is still listed here. */
  missingSkills: string[];
  model: string;
  breakdown: ScoreBreakdown;
  /** 0-1: how much of the must-have list is evidenced. Drives the Tier 1 quality gate. */
  mustHaveCoverage: number;
}

/**
 * Skills that are evidence of a neighbouring skill, but not the same thing. Directional where it matters
 * (Next.js says a lot about React; React says less about Next.js, but still counts). Keys are lower case.
 */
const RELATED_SKILLS: Record<string, string[]> = {
  react: ["next.js", "redux", "react native", "gatsby"],
  "next.js": ["react"],
  "react native": ["react", "flutter"],
  vue: ["nuxt", "react", "angular"],
  angular: ["rxjs", "typescript"],
  javascript: ["typescript", "node.js", "react"],
  typescript: ["javascript", "angular", "nestjs"],
  "node.js": ["express", "nestjs", "javascript"],
  python: ["django", "flask", "fastapi", "pandas"],
  django: ["python", "flask"],
  flask: ["python", "django", "fastapi"],
  fastapi: ["python", "flask", "django"],
  java: ["spring boot", "spring", "hibernate", "kotlin"],
  "spring boot": ["java", "spring", "hibernate"],
  spring: ["java", "spring boot"],
  kotlin: ["java", "android"],
  go: ["rust"],
  "c#": [".net", "asp.net"],
  ".net": ["c#", "asp.net"],
  postgresql: ["mysql", "sql server", "oracle", "sql"],
  mysql: ["postgresql", "mariadb", "sql server", "sql"],
  sql: ["postgresql", "mysql", "oracle", "snowflake", "bigquery"],
  mongodb: ["dynamodb", "couchdb", "cassandra"],
  redis: ["memcached"],
  elasticsearch: ["opensearch", "solr"],
  kafka: ["rabbitmq", "kinesis", "pulsar"],
  rabbitmq: ["kafka", "sqs", "activemq"],
  aws: ["gcp", "azure"],
  gcp: ["aws", "azure"],
  azure: ["aws", "gcp"],
  docker: ["kubernetes", "podman"],
  kubernetes: ["docker", "openshift", "helm", "eks", "gke"],
  terraform: ["cloudformation", "pulumi", "ansible"],
  "ci/cd": ["jenkins", "github actions", "gitlab ci", "circleci"],
  graphql: ["rest api", "apollo"],
  "rest api": ["graphql", "microservices"],
  microservices: ["rest api", "kafka"],
  "machine learning": ["deep learning", "data science", "pytorch", "tensorflow", "scikit-learn"],
  "deep learning": ["pytorch", "tensorflow", "machine learning"],
  pytorch: ["tensorflow", "deep learning"],
  tensorflow: ["pytorch", "keras", "deep learning"],
  nlp: ["llm", "machine learning"],
  llm: ["nlp", "machine learning"],
  spark: ["hadoop", "databricks", "flink"],
  airflow: ["dagster", "prefect", "luigi"],
  tableau: ["power bi", "looker"],
  "power bi": ["tableau", "looker"],
  selenium: ["cypress", "playwright"],
  cypress: ["selenium", "playwright"],
};

// ---- industry / domain lexicon (generic words plus the employers that signal a domain in India) ----

interface Domain {
  keywords: string[];
  /** Neighbouring domains: experience there earns half credit. */
  adjacent: string[];
}

const DOMAINS: Record<string, Domain> = {
  saas: {
    keywords: ["saas", "b2b software", "cloud software", "subscription software", "freshworks", "zoho", "chargebee", "postman", "browserstack", "clevertap", "whatfix", "druva", "salesforce", "servicenow", "atlassian"],
    adjacent: ["enterprise", "fintech"],
  },
  ecommerce: {
    keywords: ["e-commerce", "ecommerce", "e commerce", "marketplace", "retail", "d2c", "flipkart", "amazon", "myntra", "meesho", "nykaa", "snapdeal", "bigbasket", "ajio", "shopify"],
    adjacent: ["logistics", "mobility"],
  },
  fintech: {
    keywords: ["fintech", "payments", "payment gateway", "upi", "lending", "neobank", "wallet", "razorpay", "paytm", "phonepe", "cred", "zerodha", "groww", "bharatpe", "pine labs", "juspay"],
    adjacent: ["banking", "saas"],
  },
  banking: {
    keywords: ["banking", "bfsi", "insurance", "capital markets", "hdfc", "icici", "axis bank", "kotak", "sbi", "jpmorgan", "goldman sachs", "citi", "barclays"],
    adjacent: ["fintech"],
  },
  healthcare: {
    keywords: ["healthcare", "healthtech", "health tech", "pharma", "hospital", "clinical", "medical", "biotech", "practo", "1mg", "pharmeasy", "ehr"],
    adjacent: [],
  },
  edtech: {
    keywords: ["edtech", "ed-tech", "e-learning", "education", "lms", "byju", "unacademy", "upgrad", "vedantu", "physics wallah"],
    adjacent: [],
  },
  logistics: {
    keywords: ["logistics", "supply chain", "warehouse", "fleet", "last mile", "delhivery", "shiprocket", "ecom express", "blue dart"],
    adjacent: ["ecommerce", "mobility"],
  },
  mobility: {
    keywords: ["mobility", "ride hailing", "ride-hailing", "ola", "uber", "rapido", "travel", "airline", "hospitality", "makemytrip", "cleartrip"],
    adjacent: ["logistics", "ecommerce"],
  },
  telecom: {
    keywords: ["telecom", "telecommunications", "5g", "jio", "airtel", "vodafone", "ericsson", "nokia"],
    adjacent: ["enterprise"],
  },
  gaming: {
    keywords: ["gaming", "game development", "esports", "dream11", "mpl", "nazara", "unity"],
    adjacent: ["media"],
  },
  media: {
    keywords: ["adtech", "ad tech", "martech", "advertising", "ott", "streaming", "media", "hotstar", "sharechat", "inmobi"],
    adjacent: ["gaming"],
  },
  itservices: {
    keywords: ["it services", "consulting", "system integrator", "outsourcing", "tcs", "infosys", "wipro", "hcl", "cognizant", "capgemini", "accenture", "tech mahindra", "mphasis", "ltimindtree"],
    adjacent: ["enterprise"],
  },
  enterprise: {
    keywords: ["enterprise", "erp", "crm", "sap", "oracle", "b2b"],
    adjacent: ["saas", "itservices"],
  },
};

/** Domains mentioned in a text, with how strongly (1-3 keyword hits). */
function detectDomains(text: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const [name, domain] of Object.entries(DOMAINS)) {
    let hits = 0;
    for (const keyword of domain.keywords) if (hasTerm(text, keyword)) hits += 1;
    if (hits > 0) found.set(name, Math.min(hits, 3));
  }
  return found;
}

/** Industry fit, 0-1. Neutral (0.5) when the job names no domain, so it neither helps nor hurts. */
function industryFit(job: ScoringJob, candidateText: string): number {
  const wanted = detectDomains(`${job.title}\n${job.description}`);
  if (wanted.size === 0) return 0.5;
  const have = detectDomains(candidateText);

  let got = 0;
  let max = 0;
  for (const [name, weight] of wanted) {
    max += weight;
    if (have.has(name)) got += weight;
    else if (DOMAINS[name]?.adjacent.some((neighbour) => have.has(neighbour))) got += weight * 0.5;
  }
  return max > 0 ? got / max : 0.5;
}

// ---- reading the profile text --------------------------------------------------------------------------------

interface ParsedProfile {
  bio: string;
  location: string;
  languages: Map<string, number>;
  topics: string[];
  /** LinkedIn "Skills:" line (empty for GitHub profiles). */
  skills: string[];
  /** The most recent role: the "Headline:" line, else the first sentence of the bio. */
  headline: string;
  /** "Experience: N years" when the profile text states it. */
  statedYears: number | null;
}

/** Reads back the lines written by buildProfileText / buildLinkedInProfileText / buildSerpProfileText. */
export function parseProfileText(profileText: string): ParsedProfile {
  const lines = profileText.split("\n");
  const value = (prefix: string): string => {
    const line = lines.find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));
    return line ? line.slice(line.indexOf(":") + 1).trim() : "";
  };

  const languages = new Map<string, number>();
  for (const part of value("Languages").split(",")) {
    const match = /^(.*?)\s+(\d+)%$/.exec(part.trim());
    if (match?.[1]) languages.set(match[1].trim(), Number(match[2]) / 100);
  }

  const bio = value("Bio");
  const headline = value("Headline") || (bio.split(/\s[|·•]\s|\.\s/)[0] ?? "").trim();
  const years = /^([\d.]+)\s*years?/i.exec(value("Experience"));

  return {
    bio,
    location: value("Location"),
    languages,
    topics: value("Repository topics").split(",").map((topic) => topic.trim()).filter(Boolean),
    skills: value("Skills").split(",").map((skill) => skill.trim()).filter(Boolean),
    headline: headline.slice(0, 200),
    statedYears: years?.[1] ? Number(years[1]) : null,
  };
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_RANGE = new RegExp(
  `(?:(${MONTHS})[a-z]*\\.?,?\\s+)?((?:19|20)\\d{2})\\s*(?:-|\\u2013|\\u2014|to)\\s*(?:(?:(${MONTHS})[a-z]*\\.?,?\\s+)?((?:19|20)\\d{2})|(present|current|now|till date|ongoing))`,
  "i",
);

const DATE_RANGE_ALL = new RegExp(DATE_RANGE.source, "gi");

const monthIndex = (name: string | undefined): number => (name ? MONTHS.split("|").indexOf(name.slice(0, 3).toLowerCase()) / 12 : 0);

/** A stretch of the profile with how recent it is (1 = current role, lower = older). */
interface Segment {
  text: string;
  recency: number;
  /** Position in years, only for dated segments; used to compute total experience. */
  range?: [number, number];
}

function recencyForEndYear(endYear: number, now: Date): number {
  const age = now.getFullYear() - endYear;
  if (age <= 1) return 1;
  if (age <= 3) return 0.8;
  if (age <= 6) return 0.55;
  return 0.3;
}

/**
 * Splits the profile into segments and tags each one with a recency weight:
 *  - the headline is the current role: 1.0
 *  - a dated block ("Jan 2019 - Present") is weighted by how long ago it ended
 *  - the "Skills:" list has no dates: 0.6
 *  - everything else (summary, snippet) mostly describes current work: 0.8
 */
function segmentProfile(profile: ParsedProfile, text: string, now: Date): Segment[] {
  const segments: Segment[] = [];
  if (profile.headline) segments.push({ text: profile.headline, recency: 1 });

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  let current: Segment | null = null;
  for (const line of lines) {
    if (/^skills\s*:/i.test(line)) {
      current = null;
      segments.push({ text: line, recency: 0.6 });
      continue;
    }

    // A Google snippet is ONE line that can hold several date ranges, so split the line at every range.
    const ranges = [...line.matchAll(DATE_RANGE_ALL)];
    if (ranges.length === 0) {
      if (current && current.text.length < 600) current.text += `\n${line}`; // description lines belong to the role above
      else segments.push({ text: line, recency: 0.8 });
      continue;
    }

    const before = line.slice(0, ranges[0]!.index).trim();
    if (before) segments.push({ text: before, recency: 0.8 });
    for (const [index, range] of ranges.entries()) {
      const start = Number(range[2]) + monthIndex(range[1]);
      const end = range[5] ? now.getFullYear() + now.getMonth() / 12 : Number(range[4]) + monthIndex(range[3]);
      current = {
        text: line.slice(range.index, ranges[index + 1]?.index ?? line.length),
        recency: recencyForEndYear(Math.floor(end), now),
        range: [start, Math.max(start, end)],
      };
      segments.push(current);
    }
  }
  return segments;
}

/** Total years of dated experience, overlapping roles counted once. null when there are no dated roles. */
function yearsFromSegments(segments: Segment[]): number | null {
  const ranges = segments.flatMap((segment) => (segment.range ? [segment.range] : [])).sort((a, b) => a[0] - b[0]);
  if (ranges.length === 0) return null;
  let total = 0;
  let [start, end] = ranges[0]!;
  for (const [nextStart, nextEnd] of ranges.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else {
      total += end - start;
      [start, end] = [nextStart, nextEnd];
    }
  }
  return Math.round((total + (end - start)) * 10) / 10;
}

// ---- 1. skills ------------------------------------------------------------------------------------------

interface SkillEvidence {
  name: string;
  weight: number;
  required: boolean;
  /** 1 = the skill (or a synonym) is shown, RELATED_CREDIT = only a related skill is shown, 0 = nothing. */
  credit: number;
  /** Recency (0-1) of the most recent segment that shows it; 0 when there is no evidence. */
  recency: number;
}

function gatherSkills(job: ScoringJob): Array<{ name: string; weight: number; required: boolean }> {
  const required = dedupe(job.requiredSkills);
  const taken = new Set(required.map((skill) => skill.toLowerCase()));
  const take = (skills: string[]): string[] => dedupe(skills).filter((skill) => !taken.has(skill.toLowerCase()) && taken.add(skill.toLowerCase()));
  const languages = take(job.languages);
  const preferred = take(job.preferredSkills);
  return [
    ...required.map((name) => ({ name, weight: SKILL_WEIGHT.required, required: true })),
    ...languages.map((name) => ({ name, weight: SKILL_WEIGHT.language, required: false })),
    ...preferred.map((name) => ({ name, weight: SKILL_WEIGHT.preferred, required: false })),
  ];
}

function showsSkill(text: string, skill: string): boolean {
  return textHasSkill(text, skill) || textHasSkill(text.replace(/-/g, " "), skill.replace(/\./g, " "));
}

function showsRelated(text: string, skill: string): boolean {
  const key = skill.trim().toLowerCase();
  const related = RELATED_SKILLS[key] ?? [];
  return related.some((neighbour) => showsSkill(text, neighbour));
}

function gatherEvidence(
  job: ScoringJob,
  profile: ParsedProfile,
  segments: Segment[],
): SkillEvidence[] {
  return gatherSkills(job).map((skill) => {
    // GitHub: a language with real code share is hands-on, recent evidence.
    const languageShare = [...profile.languages.entries()].find(([name]) => name.toLowerCase() === skill.name.toLowerCase())?.[1] ?? 0;

    let recency = languageShare > 0 ? 0.8 : 0;
    for (const segment of segments) if (segment.recency > recency && showsSkill(segment.text, skill.name)) recency = segment.recency;
    if (recency > 0) return { ...skill, credit: 1, recency };

    let relatedRecency = 0;
    for (const segment of segments) if (segment.recency > relatedRecency && showsRelated(segment.text, skill.name)) relatedRecency = segment.recency;
    return relatedRecency > 0 ? { ...skill, credit: RELATED_CREDIT, recency: relatedRecency } : { ...skill, credit: 0, recency: 0 };
  });
}

// ---- 2. experience & tenure -----------------------------------------------------------------------------

const LEVELS: Array<[RegExp, number]> = [
  [/\b(intern|trainee|graduate|entry|junior|jr\.?|associate)\b/i, 1],
  [/\b(principal|staff|head|director|vp|architect|manager)\b/i, 4],
  [/\b(lead|tech lead|team lead)\b/i, 4],
  [/\b(senior|sr\.?|sde[\s-]?(?:iii|3))\b/i, 3],
];

/** 1 junior, 2 mid (no marker), 3 senior, 4 lead and above. */
function levelOf(text: string): number {
  for (const [pattern, level] of LEVELS) if (pattern.test(text)) return level;
  return 2;
}

function requiredYears(job: ScoringJob): number | null {
  if (typeof job.experienceYears === "number" && job.experienceYears > 0) return job.experienceYears;
  const fromText = findYears(`${job.title}\n${job.description}`);
  if (fromText !== null) return fromText;
  const level = levelOf(`${job.seniority ?? ""} ${job.title}`);
  return level === 1 ? 1 : level === 3 ? 5 : level === 4 ? 8 : null;
}

/** Years fit, 0-1. Unknown candidate years are scored 0.4: sparse profiles are low-evidence, not bad. */
function yearsFit(candidateYears: number | null, wanted: number | null): number {
  if (candidateYears === null) return 0.4;
  if (wanted === null) return 0.7;
  const ratio = candidateYears / wanted;
  if (ratio >= 1) return ratio > 2.2 ? 0.85 : 1; // far above the ask: probably overqualified / expensive
  return Math.max(0, ratio);
}

const TITLE_STOP = new Set(["and", "the", "of", "for", "in", "at", "with", "a", "an", "to"]);

/** Lower-case title tokens with the spellings people use for the same thing mapped together. */
function titleTokens(title: string): Set<string> {
  const text = title
    .toLowerCase()
    .replace(/full[\s-]?stack/g, "fullstack")
    .replace(/front[\s-]?end/g, "frontend")
    .replace(/back[\s-]?end/g, "backend")
    .replace(/\bnode\.?js\b/g, "node")
    .replace(/\b(software|application)\s+(developer|engineer)\b/g, "engineer");
  const tokens = text
    .split(/[^a-z0-9#+.]+/)
    .filter((token) => token.length > 1 && !TITLE_STOP.has(token))
    .map((token) => (["developer", "programmer", "sde", "swe", "engineer"].includes(token) ? "engineer" : token));
  return new Set(tokens);
}

/** How well the candidate's headline matches the job title and seniority, 0-1. */
function titleFit(job: ScoringJob, headline: string): number {
  if (!headline) return 0.3;
  const wanted = titleTokens(job.title.replace(SENIORITY_TOKENS, " "));
  const have = titleTokens(headline);
  const overlap = wanted.size === 0 ? 0.5 : [...wanted].filter((token) => have.has(token)).length / wanted.size;

  const gap = Math.abs(levelOf(`${job.seniority ?? ""} ${job.title}`) - levelOf(headline));
  const seniority = gap === 0 ? 1 : gap === 1 ? 0.6 : 0.2;
  return 0.7 * overlap + 0.3 * seniority;
}

const SENIORITY_TOKENS = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|head of|intern|graduate)\b/gi;

// ---- 3. competency & impact -----------------------------------------------------------------------------

const ACTION_VERBS = new RegExp(
  "\\b(led|leading|lead(?=\\s+(?:a|the|\\d))|built|building|architect(?:ed|ing)|designed|developed|implemented|delivered|launched|scaled|scaling|" +
    "optimi[sz]ed|migrated|reduced|increased|improved|automated|spearheaded|owned|mentored|drove|shipped|established|streamlined|" +
    "engineered|deployed|managed|created|enhanced|boosted|cut|saved|grew|generated|revamped|refactored|integrated)\\b",
  "gi",
);

const METRICS = [
  /\b\d+(?:\.\d+)?\s?%/g, // 40%
  /\b\d+(?:\.\d+)?\s?x\b/gi, // 3x
  /[₹$€£]\s?\d[\d,.]*\s?(?:k|m|mn|cr|crore|lakh|lakhs|b|bn)?\b/gi, // Rs 5 Cr, $2M
  /\b\d[\d,.]*\+?\s?(?:k|m|mn|million|billion|cr|crore|lakh|lakhs)\+?\s+(?:users|customers|requests|transactions|clients|merchants|orders|records|events|downloads|rps|qps)\b/gi, // 10M users
  /\b\d[\d,]*\+?\s+(?:users|customers|requests|transactions|clients|merchants|orders|engineers|developers|microservices|services|apis)\b/gi, // 50 microservices
];

/** Contact data is removed first so a phone number or an id can never count as a "metric". */
function stripNoise(text: string): string {
  return stripIndianMobiles(text)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\b\d[\d,]*\+?\s+(?:connections|followers)\b/gi, " ");
}

/** Competency & impact, 0-1: half from distinct action verbs, half from distinct quantified results. */
function impactFit(text: string): number {
  const clean = stripNoise(text);
  const verbs = new Set((clean.match(ACTION_VERBS) ?? []).map((verb) => verb.toLowerCase()));
  const metrics = new Set(METRICS.flatMap((pattern) => clean.match(pattern) ?? []).map((metric) => metric.toLowerCase().replace(/\s+/g, "")));
  return 0.5 * Math.min(verbs.size / 5, 1) + 0.5 * Math.min(metrics.size / 3, 1);
}

// ---- putting it together --------------------------------------------------------------------------------

export interface ScoreOptions {
  /** Clock, injectable for tests. */
  now?: Date;
  /** Model label saved with the match. Default "heuristic". */
  model?: string;
}

const percent = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 100);

/**
 * Scores one profile against one job on the four weighted dimensions. Pure and deterministic.
 * `profileText` is the plain text the rest of the app already uses (see buildSerpProfileText for SERP candidates).
 */
export function scoreCandidate(job: ScoringJob, profileText: string, options: ScoreOptions = {}): HeuristicMatch {
  const now = options.now ?? new Date();
  const profile = parseProfileText(profileText);
  const segments = segmentProfile(profile, profileText, now);

  // 1. Skills (40%): weighted credit, must-haves 3x nice-to-haves.
  const evidence = gatherEvidence(job, profile, segments);
  const totalWeight = evidence.reduce((sum, skill) => sum + skill.weight, 0);
  const skillFit = totalWeight > 0 ? evidence.reduce((sum, skill) => sum + skill.weight * skill.credit, 0) / totalWeight : 0.5;

  const must = evidence.filter((skill) => skill.required);
  const mustHaveCoverage = must.length > 0 ? must.reduce((sum, skill) => sum + skill.credit, 0) / must.length : 1;

  // 2. Experience & tenure (30%): recent use of the skills, years fit, title fit.
  const recentUse = totalWeight > 0 ? evidence.reduce((sum, skill) => sum + skill.weight * skill.credit * skill.recency, 0) / totalWeight : 0.5;
  const candidateYears = profile.statedYears ?? yearsFromSegments(segments) ?? findYears(stripNoise(profileText));
  const experienceFit = 0.5 * recentUse + 0.3 * yearsFit(candidateYears, requiredYears(job)) + 0.2 * titleFit(job, profile.headline);

  // 3. Competency & impact (15%) and 4. Industry (15%).
  const impact = impactFit(profileText);
  const industry = industryFit(job, profileText);

  let score = Math.round(
    100 * (SCORE_WEIGHTS.skills * skillFit + SCORE_WEIGHTS.experience * experienceFit + SCORE_WEIGHTS.impact * impact + SCORE_WEIGHTS.industry * industry),
  );
  if (must.length > 0 && mustHaveCoverage === 0) score = Math.min(score, NO_MUST_HAVE_SCORE_CAP);
  else if (must.length > 0 && mustHaveCoverage < MUST_HAVE_GATE) score = Math.min(score, GATED_SCORE_CAP);

  return {
    score: Math.max(0, Math.min(100, score)),
    matchedSkills: evidence.filter((skill) => skill.credit === 1).map((skill) => skill.name).slice(0, 12),
    missingSkills: evidence.filter((skill) => skill.credit < 1).map((skill) => skill.name).slice(0, 12),
    model: options.model ?? HEURISTIC_MODEL,
    breakdown: { skills: percent(skillFit), experience: percent(experienceFit), impact: percent(impact), industry: percent(industry) },
    mustHaveCoverage: Math.round(mustHaveCoverage * 100) / 100,
  };
}

/** Offline score used as the AI fallback and for GitHub profiles. Same weighted model as scoreCandidate. */
export function heuristicMatch(job: ScoringJob, profileText: string): HeuristicMatch {
  return scoreCandidate(job, profileText);
}

// ---------------------------------------------------------------------------------------------
// JD parsing without AI
// ---------------------------------------------------------------------------------------------

export interface ExtractedJd {
  title: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  technologies: string[];
  handsOn: string[];
  languages: string[];
  locations: string[];
  remoteAllowed: boolean;
  experienceYears: number | null;
  seniority: string | null;
  workMode: string | null;
  employmentType: string | null;
}

const COUNTRIES = new Set([
  "india", "usa", "us", "united states", "uk", "united kingdom", "germany", "netherlands", "canada", "australia",
  "singapore", "uae", "united arab emirates", "france", "spain", "ireland", "poland", "sweden", "switzerland", "europe",
]);

const PREFERRED_HEADING = /(nice[- ]to[- ]have|preferred|good to have|bonus|plus points?|desirable|optional)/i;

/** Maps skills / frameworks to the GitHub languages to search. */
export function languagesFromSkills(skills: string[]): string[] {
  const found: string[] = [];
  for (const skill of skills) {
    const key = skill.trim().toLowerCase();
    const language = GITHUB_LANGUAGES.find((name) => name.toLowerCase() === key) ?? FRAMEWORK_LANGUAGE[key];
    if (language) found.push(language);
  }
  return dedupe(found);
}

function findYears(text: string): number | null {
  // "5+ years", "3-5 yrs", "7 plus years": digits must not be the tail of a longer number (phone numbers!).
  const match = /(?<![\d.])(\d{1,2})(?:[ \t]*(?:\+|plus))?(?:[ \t]*(?:-|to|–)[ \t]*\d{1,2})?[ \t]*\+?[ \t]*(?:years|yrs)\b/i.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

function findLabel(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = new RegExp(`^\\s*${label}\\s*[:\\-–]\\s*(.+)$`, "im").exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

/** Best-effort structured JD from free text, with no AI. */
export function heuristicExtractJd(text: string): ExtractedJd {
  const clean = text.replace(/\r/g, "");
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);

  const title =
    findLabel(clean, ["job title", "title", "position", "role", "designation"]) ||
    lines.find((line) => line.length >= 4 && line.length <= 90 && !/[:.]$/.test(line)) ||
    "Imported job";

  // Split the text into "required" and "preferred" parts at the first nice-to-have heading.
  const cut = clean.search(PREFERRED_HEADING);
  const requiredPart = cut > 0 ? clean.slice(0, cut) : clean;
  const preferredPart = cut > 0 ? clean.slice(cut) : "";

  // Literal reading of the JD: "PostgreSQL" in a JD must not add "SQL" as a separate requirement.
  const inPart = (part: string) => TECH_TERMS.filter((term) => textHasSkill(part, term, { umbrella: false }));
  const requiredSkills = dedupe(inPart(requiredPart)).slice(0, 20);
  const preferredSkills = dedupe(inPart(preferredPart)).filter(
    (skill) => !requiredSkills.some((r) => r.toLowerCase() === skill.toLowerCase()),
  ).slice(0, 15);

  // Languages to SEARCH GitHub with (HCL / Shell are tooling, not a developer's main language).
  const languageNames = GITHUB_LANGUAGES.filter((language) => language.length > 1 && !["HCL", "Shell", "PowerShell"].includes(language) && hasTerm(clean, language));
  const languages = dedupe([...languageNames, ...languagesFromSkills([...requiredSkills, ...preferredSkills])]).slice(0, 4);

  const locationText = findLabel(clean, ["location", "job location", "work location", "based in", "city"]);
  const parts = locationText
    ? dedupe(locationText.split(/[,/|;]| or /i).map((part) => part.replace(/\(.*?\)/g, "").trim())).filter(
        (part) => part.length > 1 && part.length < 40 && !/remote|hybrid|on-?site/i.test(part),
      )
    : [];
  // "Bengaluru, India" -> search the city only (a whole-country search is far too broad).
  const cities = parts.filter((part) => !COUNTRIES.has(part.toLowerCase()));
  const locations = (cities.length > 0 ? cities : parts).slice(0, 3);

  const remoteAllowed = /\bremote\b|work from home|\bwfh\b/i.test(clean);
  const workMode = /\bhybrid\b/i.test(clean) ? "Hybrid" : remoteAllowed ? "Remote" : /on-?site|in office/i.test(clean) ? "On-site" : null;
  const employmentType = /\bcontract\b/i.test(clean)
    ? "Contract"
    : /\bintern(ship)?\b/i.test(clean)
      ? "Internship"
      : /part[- ]time/i.test(clean)
        ? "Part-time"
        : /full[- ]time|permanent/i.test(clean)
          ? "Full-time"
          : null;
  const seniority = /\b(principal|staff)\b/i.test(title)
    ? "Lead"
    : /\b(lead|head|manager)\b/i.test(title)
      ? "Lead"
      : /\b(senior|sr\.?)\b/i.test(title)
        ? "Senior"
        : /\b(junior|jr\.?|graduate|entry)\b/i.test(title)
          ? "Junior"
          : null;

  return {
    title: title.slice(0, 120),
    description: clean.slice(0, 4000),
    requiredSkills,
    preferredSkills,
    technologies: [],
    handsOn: [],
    languages,
    locations,
    remoteAllowed,
    experienceYears: findYears(clean),
    seniority,
    workMode,
    employmentType,
  };
}

// ---------------------------------------------------------------------------------------------
// Resume analysis without AI
// ---------------------------------------------------------------------------------------------

export interface JdSkill {
  name: string;
  type: "required" | "preferred" | "other";
  handsOn?: boolean;
}

export interface SkillVerdict extends JdSkill {
  status: "matched" | "partial" | "missing";
  evidence: string;
  handsOnShown?: boolean;
}

/** Returns the sentence of the text around the first mention of the skill (max ~14 words). */
function evidenceFor(text: string, skill: string): string {
  for (const alias of aliasesOf(skill)) {
    const match = new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, "i").exec(text);
    if (match) {
      const start = Math.max(0, text.lastIndexOf("\n", match.index) + 1);
      const end = text.indexOf("\n", match.index);
      const sentence = text.slice(start, end === -1 ? undefined : end).trim();
      return sentence.split(/\s+/).slice(0, 14).join(" ");
    }
  }
  return "";
}

/** Guesses a person's name from the first lines of a resume. */
export function guessName(text: string): string | null {
  for (const line of text.split("\n").slice(0, 6)) {
    const cleaned = line.replace(/^(name|resume|curriculum vitae|cv)\s*[:\-]?\s*/i, "").trim();
    if (/^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(cleaned) && cleaned.length <= 40) return cleaned;
  }
  return null;
}

export function heuristicResumeAnalysis(skills: JdSkill[], resumeText: string) {
  const verdicts: SkillVerdict[] = skills.map((skill) => {
    const found = textHasSkill(resumeText, skill.name);
    const evidence = found ? evidenceFor(resumeText, skill.name) : "";
    return {
      ...skill,
      status: found ? "matched" : "missing",
      evidence,
      ...(skill.handsOn ? { handsOnShown: found && /built|developed|implemented|designed|deployed|created|worked on|using/i.test(evidence) } : {}),
    };
  });

  return {
    candidate: guessName(resumeText),
    candidateYears: findYears(resumeText),
    summary: `Keyword check: ${verdicts.filter((v) => v.status === "matched").length} of ${verdicts.length} JD skills appear in the resume.`,
    skills: verdicts,
  };
}

// ---------------------------------------------------------------------------------------------
// Masking without AI (regex redaction)
// ---------------------------------------------------------------------------------------------

export function heuristicMask(text: string, code: string, name: string | null): string {
  let masked = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    // Phone numbers have 9+ digits; this keeps date ranges like "2020-2025" intact.
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => (match.replace(/\D/g, "").length >= 9 ? "[phone removed]" : match))
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link removed]")
    .replace(/\b(linkedin|github)\.com\/\S*/gi, "[profile removed]");
  if (name) {
    masked = masked.replace(new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, "gi"), code);
    for (const part of name.split(/\s+/).filter((piece) => piece.length > 1)) {
      masked = masked.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, "gi"), code);
    }
    masked = masked.replace(new RegExp(`(${escapeRegExp(code)})(\\s+${escapeRegExp(code)})+`, "g"), "$1");
  }
  return `@ Anonymized profile\n# RESUME\n${masked}`;
}
