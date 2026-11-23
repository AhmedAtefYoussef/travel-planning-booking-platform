import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="opacity-80">
        The page does not exist, or you do not have access to it.
      </p>
      <Link href="/" className="w-fit underline">
        Back to the home page
      </Link>
    </main>
  );
}
