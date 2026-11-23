/** Temporary landing content for a section whose owner has not shipped its page yet. */
export function PagePlaceholder({
  title,
  story,
}: {
  title: string;
  story: string;
}) {
  return (
    <section className="border-border bg-surface rounded-lg border border-dashed p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted mt-2">This page is delivered by {story}.</p>
    </section>
  );
}
