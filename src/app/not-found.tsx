import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
      <p className="text-5xl font-semibold text-accent">404</p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <Link href="/pipeline" className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
        Back to the pipeline
      </Link>
    </div>
  );
}
