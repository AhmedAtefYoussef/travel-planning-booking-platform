import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        Plan, book and share your trips
      </h1>
      <p className="max-w-2xl text-lg opacity-80">
        Search flights and hotels, build a day-by-day itinerary with a budget,
        and read travel stories from the community.
      </p>
      <nav aria-label="Get started" className="flex flex-wrap gap-4 underline">
        <Link href="/api/docs" prefetch={false}>
          API documentation
        </Link>
      </nav>
    </main>
  );
}
