import { SITE_NAME } from '@/lib/seo';

export function SiteFooter() {
  return (
    <footer className="border-border bg-surface border-t">
      <div className="text-muted mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm sm:flex-row sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} {SITE_NAME}. GIU Software Project I.
        </p>
        <p>Prices are shown in the platform currency.</p>
      </div>
    </footer>
  );
}
