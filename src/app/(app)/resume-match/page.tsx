import { ResumeMatch } from "@/components/ResumeMatch";

type PageProps = { searchParams: Promise<{ job?: string }> };

/** Resume Match module: score uploaded resumes against a job's JD. */
export default async function ResumeMatchPage({ searchParams }: PageProps) {
  const { job } = await searchParams;
  return <ResumeMatch initialJobId={job ?? null} />;
}
