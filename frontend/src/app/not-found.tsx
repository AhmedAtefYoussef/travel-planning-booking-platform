import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="border-border bg-surface mx-auto max-w-lg rounded-lg border p-8 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted mt-2">
        The page you asked for does not exist or you do not have access to it.
      </p>
      <Link
        href="/"
        className="bg-primary text-primary-foreground hover:bg-primary-hover mt-6 inline-block rounded-md px-4 py-2 text-sm font-medium"
      >
        Back to home
      </Link>
    </section>
  );
}
