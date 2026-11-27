/**
 * Content for the public landing page.
 * NOTE: the candidates below are fictional demo records. The customer stories and compliance badges are SAMPLE copy:
 * replace them with real customers and only keep a badge once the certification is actually held.
 */

export type SourceId = "naukri" | "linkedin" | "cutshort" | "github";

export const SOURCE_LABEL: Record<SourceId, string> = { naukri: "Naukri", linkedin: "LinkedIn", cutshort: "Cutshort", github: "GitHub" };

/** Default weights of the seven evaluation dimensions (src/server/hunt/rubric.ts DEFAULT_WEIGHTS). Recruiters can edit them per job. */
export const DEFAULT_WEIGHTS = { skills: 30, experience: 20, compensation: 10, availability: 10, location: 10, education: 5, career: 15 } as const;
export const DIMENSION_NAMES = ["Skills", "Experience", "Compensation", "Availability", "Location", "Education", "Career background"] as const;

export const DEMO_HREF = "mailto:demo@xs-hunt.com?subject=XS-Hunt%20demo";
export const APP_HREF = "/dashboard";

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
  "Reading the job description and building the rubric",
  "Searching and reading profiles that fit",
  "Saving every candidate to the role pool",
  "Scoring each candidate on seven dimensions",
  "Ranking them and waiting for your approval",
];

export const FAQS: Array<{ q: string; a: string }> = [
  { q: "What is XS-Hunt?", a: "An AI recruiting workspace. You describe the role in plain English; agents build the rubric, search for matching profiles, score each one and rank them. You review the shortlist and decide who moves forward." },
  { q: "Does anything happen without my approval?", a: "No. Agents do the groundwork, but opening a full profile, downloading a resume and moving a candidate between stages are your calls. Anything that may use credits asks you to confirm first." },
  { q: "How are candidates scored?", a: "On a rubric of seven dimensions: skills, experience, compensation, availability, location, education and career background, plus optional custom criteria. Weights are editable per job and every version is kept." },
  { q: "Where do resumes and profiles go?", a: "Into your XS-Hunt workspace, tied to the candidate and visible only to your organisation. Every view and download is written to an audit log." },
  { q: "Can sourcing and AI scoring run separately?", a: "Yes. Sourcing and AI analysis each have their own Start, Pause, Resume and Stop. Collect candidates without spending any AI, score the ones you already have, or run both together." },
  { q: "Is outreach, interviewing or scheduling included?", a: "Not yet. Those are on the roadmap and marked Coming soon on this page. Today XS-Hunt covers brief, search, scoring, shortlist, pipeline and resume vault." },
];
