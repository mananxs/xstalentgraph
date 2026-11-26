import { Dashboard } from "@/components/Dashboard";

type PageProps = { searchParams: Promise<{ job?: string }> };

/** Pipeline: the candidate dashboard for one job. */
export default async function PipelinePage({ searchParams }: PageProps) {
  const { job } = await searchParams;
  return <Dashboard initialJobId={job ?? null} initialTab="sourced" />;
}
