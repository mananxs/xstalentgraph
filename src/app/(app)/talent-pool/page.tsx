import { TalentPoolView } from "@/components/hunt/TalentPoolView";

type PageProps = { searchParams: Promise<{ tier?: string }> };

export default async function TalentPoolPage({ searchParams }: PageProps) {
  const { tier } = await searchParams;
  return <TalentPoolView initialTier={tier ?? null} />;
}
