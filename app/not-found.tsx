import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-24">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">Missing page</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">That page isn&apos;t here.</h1>
      <p className="mt-4 text-base text-muted-foreground">The checker is on the homepage.</p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
      >
        Back to the checker
      </Link>
    </div>
  );
}
