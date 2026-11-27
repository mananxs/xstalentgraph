import { PipelineView } from "@/components/hunt/PipelineView";

type PageProps = { searchParams: Promise<{ job?: string; pending?: string }> };

/** The eleven-stage ATS pipeline. (The earlier GitHub/LinkedIn dashboard is still available at /pipeline/classic.) */
export default async function PipelinePage({ searchParams }: PageProps) {
  const { job, pending } = await searchParams;
  return <PipelineView initialJobId={job ?? null} pending={pending === "1"} />;
}
