# Frontend design system (GEN-17)

A short guide to the shared look and feel of the Next.js frontend. See it live at the `/design-system` route (served by [`page.tsx`](../../frontend/src/app/design-system/page.tsx), not indexed by search engines).

## Principles

- **Semantic tokens only.** Use `bg-primary`, `text-muted-foreground`, `text-destructive` and friends. Never use raw Tailwind palette colours such as `text-red-600` or hex values.
- **Shared components first.** Check [`src/shared/ui`](../../frontend/src/shared/ui/) before building a new button, field, dialog or state.
- **Dark mode is automatic.** Tokens are redefined under `.dark` in [`globals.css`](../../frontend/src/app/globals.css); components need no `dark:` variants for colour.
- **Accessible by default.** Text and background token pairs meet WCAG AA (4.5:1), enforced by [`tokens.test.ts`](../../frontend/src/shared/ui/tokens.test.ts).
- **Layer rule.** `src/shared/**` must not import from `@/features` or `@/app` (ESLint enforced).

## Tokens

Defined in [`globals.css`](../../frontend/src/app/globals.css) as OKLCH values; Tailwind utilities are `bg-*`, `text-*` and `border-*`.

| Token                                          | Use                                 |
| ---------------------------------------------- | ----------------------------------- |
| `background` / `foreground`                    | Page background and default text    |
| `card` / `card-foreground`                     | Cards and panels                    |
| `popover` / `popover-foreground`               | Dialogs, menus, popovers            |
| `primary` / `primary-foreground`               | Main actions, links                 |
| `secondary` / `secondary-foreground`           | Secondary actions and surfaces      |
| `accent` / `accent-foreground`                 | Highlights and hover surfaces       |
| `muted` / `muted-foreground`                   | Subtle surfaces and secondary text  |
| `destructive`                                  | Errors and destructive actions      |
| `success`, `warning`, `info` (+ `-foreground`) | Status colours, validation, toasts  |
| `border`, `input`, `ring`                      | Borders, input outlines, focus ring |
| `chart-1` to `chart-5`                         | Data visualisation                  |

## Component catalogue

All components live in [`frontend/src/shared/ui`](../../frontend/src/shared/ui/).

| Component            | File                                                                             | When to use                                 | Requirement |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- | ----------- |
| `FormField`          | [form-field.tsx](../../frontend/src/shared/ui/form-field.tsx)                    | Any labelled input with hint and error      | GEN-02      |
| `ConfirmDialog`      | [confirm-dialog.tsx](../../frontend/src/shared/ui/confirm-dialog.tsx)            | Confirm destructive or irreversible actions | GEN-03      |
| `EmptyState`         | [empty-state.tsx](../../frontend/src/shared/ui/empty-state.tsx)                  | A list or page with no data                 | GEN-04      |
| `ErrorState`         | [error-state.tsx](../../frontend/src/shared/ui/error-state.tsx)                  | A failed load, with optional retry          | GEN-16      |
| `FormAlert`          | [form-alert.tsx](../../frontend/src/shared/ui/form-alert.tsx)                    | A form error that belongs to no field       | GEN-16      |
| `RouteError`         | [route-error.tsx](../../frontend/src/shared/ui/route-error.tsx)                  | The body of every `error.tsx` boundary      | GEN-16      |
| `DateRangeFields`    | [date-range-fields.tsx](../../frontend/src/shared/ui/date-range-fields.tsx)      | Stay or window dates with linked limits     | GEN-16      |
| `Spinner`            | [spinner.tsx](../../frontend/src/shared/ui/spinner.tsx)                          | Short inline loading indicator              | GEN-04      |
| `PageHeader`         | [page-header.tsx](../../frontend/src/shared/ui/page-header.tsx)                  | The `<h1>`, description and page actions    | GEN-17      |
| `Pagination`         | [pagination.tsx](../../frontend/src/shared/ui/pagination.tsx)                    | Link-based paging of lists                  | GEN-05      |
| `StatusBadge`        | [status-badge.tsx](../../frontend/src/shared/ui/status-badge.tsx)                | Booking status pills                        | GEN-11      |
| shadcn/ui primitives | [button, input, select, card, table, dialog, ...](../../frontend/src/shared/ui/) | Building blocks for everything else         | GEN-17      |

## Form pattern (GEN-02)

Wrap every control in `FormField`. It generates the id, links the label, and wires hint and error into `aria-describedby`. Map API `fieldErrors` onto the `error` prop of the matching field.

```tsx
<FormField label="Email" required error={fieldErrors.email?.[0]}>
  {(control) => <Input type="email" {...control} />}
</FormField>
```

For controls whose trigger is not the input itself (for example `Select`), pass `id` and the aria props to the trigger.

## Confirm pattern (GEN-03)

Use `ConfirmDialog` for deletions, cancellations and anything irreversible. `onConfirm` may be async: the dialog stays open with a spinner, closes on success, and shows the error message if it rejects.

```tsx
<ConfirmDialog
  trigger={<Button variant="destructive">Cancel booking</Button>}
  title="Cancel this booking?"
  description="This cannot be undone."
  confirmLabel="Cancel booking"
  destructive
  onConfirm={() => cancelBooking(id)}
/>
```

## Empty, loading and error states (GEN-04, GEN-16)

- **Empty:** `EmptyState` with an icon, a title, a short description and a call-to-action.
- **Loading:** `Skeleton` for page-shaped content, `Spinner` for short inline waits. Always give the loading indicator an accessible label.
- **Error:** `ErrorState` with a human message; pass `onRetry` (client components only) when retrying makes sense.

## Feedback after an action (GEN-16)

Every write shows its outcome, and every error says how to recover.

- **Saving a form:** `useSave(setError, fields)` from [`shared/forms/use-save.ts`](../../frontend/src/shared/forms/use-save.ts). `save(call, 'Saved')` toasts success and refreshes the server page; on failure it puts the API's `fieldErrors` on the inputs and returns the rest as `formError` for a `FormAlert` above the form.
- **Wording an error:** `describeApiError(error)` from [`shared/api/describe-error.ts`](../../frontend/src/shared/api/describe-error.ts) returns `{ title, message, hint, recovery, retryable }`. It switches on the API `code`/status, never on message text: offline and 5xx offer a retry, 401 asks to sign in again, 409 keeps the server's message (it names what clashed) and suggests a refresh, 429 says how long to wait.
- **A failed page:** add an `error.tsx` to the route segment that renders `<RouteError error={error} retry={retry} backHref={...} />`. Next 16's `retry()` re-fetches the segment.
- **Preventing input errors:** `DateRangeFields` keeps the end date after the start and within the longest allowed range, and `validateStay()` from [`shared/lib/dates.ts`](../../frontend/src/shared/lib/dates.ts) mirrors the API's stay rules before sending. Dates stay `YYYY-MM-DD` strings in the provider's calendar (`todayIn(timeZone)`), so nights never shift with the visitor's time zone.

## Pagination (GEN-05)

Paging is by `page` only, with a fixed page size of 10. Keep the page in the URL (`?page=N`) and render `Pagination` with `hrefFor`. It renders nothing when there is one page or fewer.

```tsx
<Pagination
  page={page}
  totalPages={totalPages}
  hrefFor={(p) => `/bookings?page=${p}`}
/>
```

## Adding a shadcn component

From `frontend/`, run `npx shadcn add <name>`. The component lands in `src/shared/ui` (see [`components.json`](../../frontend/components.json)). Review the generated file: switch any raw colours to semantic tokens, then add it to the showcase page if it is meant for reuse.
