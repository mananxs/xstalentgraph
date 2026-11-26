/**
 * Content for the public landing page.
 * NOTE: the candidates below are fictional demo records. The customer stories and compliance badges are SAMPLE copy:
 * replace them with real customers and only keep a badge once the certification is actually held.
 */

export type SourceId = "naukri" | "linkedin" | "cutshort" | "github";

export const SOURCE_LABEL: Record<SourceId, string> = { naukri: "Naukri", linkedin: "LinkedIn", cutshort: "Cutshort", github: "GitHub" };

/** The platform's real standard weighting (src/server/ai/heuristic.ts SCORE_WEIGHTS), shown on the page and used by the demo. */
export const STANDARD_WEIGHTS = { skills: 40, experience: 30, impact: 15, industry: 15 } as const;
export const WEIGHTS_LABEL = `skills ${STANDARD_WEIGHTS.skills}, experience ${STANDARD_WEIGHTS.experience}, impact ${STANDARD_WEIGHTS.impact}, industry ${STANDARD_WEIGHTS.industry}`;

export const DEMO_HREF = "mailto:demo@talentgraph.dev?subject=TalentGraph%20demo";
export const APP_HREF = "/pipeline";

export interface DemoCandidate {
  id: string;
  name: string;
  title: string;
  company: string;
  city: string;
  years: number;
  skills: string[];
  source: SourceId;
  notice: string;
}

export const DEMO_CANDIDATES: DemoCandidate[] = [
  { id: "c1", name: "Ananya Iyer", title: "Site Reliability Engineer", company: "Razorpay", city: "Bengaluru", years: 7, skills: ["kubernetes", "go", "aws", "terraform", "prometheus", "linux"], source: "linkedin", notice: "60 days" },
  { id: "c2", name: "Rohit Menon", title: "Senior DevOps Engineer", company: "Aptly Tech", city: "Hyderabad", years: 7, skills: ["kubernetes", "aws", "terraform", "ansible", "jenkins", "python"], source: "naukri", notice: "30 days" },
  { id: "c3", name: "Divya Nambiar", title: "Platform Engineer", company: "Freshworks", city: "Chennai", years: 6, skills: ["go", "kubernetes", "gcp", "grafana", "linux", "terraform"], source: "cutshort", notice: "45 days" },
  { id: "c4", name: "Karthik Rao", title: "Backend Engineer", company: "Swiggy", city: "Bengaluru", years: 5, skills: ["python", "django", "postgresql", "redis", "aws", "docker"], source: "linkedin", notice: "60 days" },
  { id: "c5", name: "Sneha Kulkarni", title: "Data Engineer", company: "PhonePe", city: "Pune", years: 6, skills: ["spark", "airflow", "python", "sql", "aws", "kafka"], source: "naukri", notice: "30 days" },
  { id: "c6", name: "Aditya Verma", title: "Senior Backend Developer", company: "Zoho", city: "Chennai", years: 8, skills: ["java", "spring", "postgresql", "kafka", "docker", "aws"], source: "naukri", notice: "90 days" },
  { id: "c7", name: "Meera Joshi", title: "Frontend Engineer", company: "Meesho", city: "Bengaluru", years: 4, skills: ["react", "typescript", "next.js", "tailwind", "graphql"], source: "linkedin", notice: "30 days" },
  { id: "c8", name: "Imran Sheikh", title: "DevOps Engineer", company: "Capgemini", city: "Hyderabad", years: 5, skills: ["kubernetes", "aws", "linux", "jenkins", "docker", "go"], source: "naukri", notice: "30 days" },
  { id: "c9", name: "Pooja Nair", title: "Machine Learning Engineer", company: "Ola", city: "Bengaluru", years: 5, skills: ["python", "pytorch", "aws", "docker", "sql", "airflow"], source: "cutshort", notice: "60 days" },
  { id: "c10", name: "Vikram Deshpande", title: "Staff Data Engineer", company: "Flipkart", city: "Bengaluru", years: 10, skills: ["spark", "kafka", "airflow", "scala", "gcp", "sql"], source: "linkedin", notice: "90 days" },
  { id: "c11", name: "Harini Subramanian", title: "Full Stack Developer", company: "Zomato", city: "Gurugram", years: 4, skills: ["react", "node.js", "typescript", "mongodb", "aws", "docker"], source: "github", notice: "30 days" },
  { id: "c12", name: "Siddharth Bose", title: "Backend Engineer", company: "Postman", city: "Bengaluru", years: 6, skills: ["go", "postgresql", "kubernetes", "redis", "grpc", "docker"], source: "github", notice: "45 days" },
  { id: "c13", name: "Nikhil Agarwal", title: "Python Developer", company: "InfoEdge", city: "Noida", years: 5, skills: ["python", "django", "postgresql", "celery", "docker", "aws"], source: "naukri", notice: "30 days" },
  { id: "c14", name: "Lavanya Reddy", title: "Cloud Engineer", company: "Deloitte", city: "Hyderabad", years: 6, skills: ["aws", "terraform", "kubernetes", "python", "linux", "ansible"], source: "cutshort", notice: "60 days" },
];

/** Words the demo understands. Key = what a recruiter might type, value = canonical skill. */
export const SKILL_ALIASES: Record<string, string> = {
  k8s: "kubernetes", kubernetes: "kubernetes", go: "go", golang: "go", aws: "aws", gcp: "gcp", terraform: "terraform", ansible: "ansible",
  jenkins: "jenkins", python: "python", django: "django", postgres: "postgresql", postgresql: "postgresql", redis: "redis", docker: "docker",
  spark: "spark", airflow: "airflow", kafka: "kafka", sql: "sql", java: "java", spring: "spring", react: "react", typescript: "typescript",
  "next.js": "next.js", nextjs: "next.js", tailwind: "tailwind", graphql: "graphql", linux: "linux", prometheus: "prometheus", grafana: "grafana",
  pytorch: "pytorch", scala: "scala", "node.js": "node.js", node: "node.js", mongodb: "mongodb", celery: "celery", grpc: "grpc",
};

export const CITIES = ["bengaluru", "bangalore", "hyderabad", "chennai", "pune", "mumbai", "gurugram", "gurgaon", "noida", "delhi"];

export const SAMPLE_PROMPTS = [
  "Senior SRE, Kubernetes + Go + AWS, Hyderabad, 5+ years",
  "Backend engineer: Python, Django, PostgreSQL, Bengaluru, 4+ years",
  "Data engineer with Spark, Airflow and Kafka, Pune or Bengaluru",
  "React + TypeScript frontend developer, Bengaluru, 4 years",
];

export const AGENT_STEPS = [
  "Reading the requirement and extracting must-have skills",
  `Calibrating weights: ${WEIGHTS_LABEL}`,
  "Searching Naukri, LinkedIn, Cutshort and GitHub",
  "Scoring every profile and removing duplicates",
  "Ranking the top 5 and storing their resumes",
];

export interface Story {
  org: string;
  kind: string;
  headline: string;
  metric: string;
  metricLabel: string;
  quote: string;
  person: string;
  role: string;
}

export const STORIES: Story[] = [
  {
    org: "Northbridge Staffing",
    kind: "IT staffing, 40 recruiters",
    headline: "Cut shortlist time from two days to forty minutes",
    metric: "92%",
    metricLabel: "less screening time",
    quote: "We stopped opening every Resdex profile. The ranked list tells us who is worth a CV view, and the resume is already attached when we call.",
    person: "Kavitha Raghunathan",
    role: "Head of Delivery",
  },
  {
    org: "Lattice Works",
    kind: "Product company, 600 people",
    headline: "Filled four platform roles without a single agency fee",
    metric: "4 of 4",
    metricLabel: "roles closed in-house",
    quote: "LinkedIn, Naukri and GitHub candidates finally sit in one ranking. Our hiring managers review one list instead of three spreadsheets.",
    person: "Arjun Malhotra",
    role: "Talent Acquisition Lead",
  },
  {
    org: "Crestline Consulting",
    kind: "Boutique search firm",
    headline: "Stopped losing resumes to expired Naukri links",
    metric: "0",
    metricLabel: "dead resume links",
    quote: "Every shortlisted CV is stored the moment we save the card. Nobody has to hunt for a download again.",
    person: "Neha Bhattacharya",
    role: "Founder",
  },
];

export const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "How does Naukri work with our premium account?",
    a: "The XS-NaukriAI extension runs inside your own logged-in Resdex session. It reads the result cards you can already see, scores them against your job, and only opens a profile when you decide it is worth a CV view. Nothing is scraped in the background and no credentials leave your browser.",
  },
  {
    q: "Where do the resumes go?",
    a: "When you save a card to the shortlist, the extension downloads the CV with your session and uploads it to TalentGraph. The file is stored in your workspace, so it opens from the platform even after the Naukri link expires. If a file cannot be downloaded, the CV text is kept and you are told exactly what is missing.",
  },
  {
    q: "Can every recruiter score candidates differently?",
    a: `No, on purpose. Scoring is standardised (${WEIGHTS_LABEL}), applied the same way to every job. Recruiters compare like with like, and hiring managers trust the ranking.`,
  },
  {
    q: "Which sources can I search?",
    a: "Naukri (through the extension), LinkedIn (Google X-Ray search), Cutshort and GitHub. They land in one pipeline, are de-duplicated, and are ranked together against the same job description.",
  },
  {
    q: "Do I have to start scoring manually?",
    a: "Yes. The extension has a clear start and stop control: red means idle, green means scoring is running. Nothing is analysed until you press start, and you can stop at any moment to protect your CV quota.",
  },
  {
    q: "How is candidate data protected?",
    a: "Contact details are never sent to the AI model. Resumes are stored in your own database, and the extension API is closed unless you set a private key.",
  },
];
