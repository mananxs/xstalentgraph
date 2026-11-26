interface ComingSoonProps {
  title: string;
  description: string;
}

/** Simple page for sections that are not built yet. */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-prose text-zinc-600">{description}</p>
    </div>
  );
}
