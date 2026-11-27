import { JobWorkspace } from "@/components/hunt/JobWorkspace";

type PageProps = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: PageProps) {
  return <JobWorkspace jobId={(await params).id} />;
}
