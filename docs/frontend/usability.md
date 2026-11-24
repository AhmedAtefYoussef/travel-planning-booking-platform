# Usability checklist (GEN-15)

GEN-15 asks for an *intuitive, easy-to-learn interface with clearly visible actions, understandable labels, and efficient workflows that minimize unnecessary steps*. This page lists the rules the flight pages (FE-06) and the airline dashboard (FE-07) follow, and where each one lives in the code. Use it as a checklist when you build or review a page.

Related cross-cutting rules have their own owners and documents: confirmations (GEN-03), empty states (GEN-04), navigation (GEN-14), feedback and responsive layout (GEN-16), and the design system (GEN-17, [design-system.md](design-system.md)).

## 1. Clearly visible actions

| Rule | Where |
| --- | --- |
| One primary button per screen or form; other actions are `outline`, `ghost` or `secondary`. | Search: **Search flights**. Result card: **Book** (primary) next to **Details**. Dashboard: **New flight**, **Save …** per form. |
| The next step after a task is offered at once. | Creating a flight opens it at **Cabins** (`#cabins`) with the add-cabin form already open. An empty flight list offers **New flight**. |
| Destructive actions are separated and confirmed. | **Cancel flight** sits in its own red section and uses `ConfirmDialog` with **Keep flight** as the safe choice ([`cancel-flight.tsx`](../../frontend/src/features/airline-dashboard/ui/cancel-flight.tsx)). |
| Save buttons are disabled until something changed or while saving, and show a spinner. | All dashboard forms (`formState.isDirty`, `isSubmitting`). |

## 2. Understandable labels

| Rule | Where |
| --- | --- |
| Plain words instead of API names: "Departure date", "Price per extra bag (USD)", "Days before departure, at least". Amounts are typed in normal units, never minor units. | [`search-form.tsx`](../../frontend/src/features/flights/ui/search-form.tsx), [`policy-forms.tsx`](../../frontend/src/features/airline-dashboard/ui/policy-forms.tsx) |
| Every input has a visible label (`FormField`), required fields are marked, and hints explain the unit or rule ("Local time at the departure airport", "Under 2, on a lap, 10% of the fare"). | `@/shared/ui/form-field` |
| Errors say what to do next, appear next to the field, and the API's own field errors are mapped back onto the same inputs (GEN-02). | [`search-params.ts`](../../frontend/src/features/flights/model/search-params.ts) `apiFieldToFormField`; dashboard `useSave` with `applyApiErrors` |
| Times always name their zone: flight times are the airport's local time with its short zone name (GEN-06). Arrivals on another local day are marked `+1 day`. | `formatInZone`, [`duration.ts`](../../frontend/src/features/flights/model/duration.ts) |

## 3. Efficient workflows (fewer steps)

| Rule | Where |
| --- | --- |
| Search criteria live in the URL, so refresh, back/forward, bookmarks and shared links all work. | `toQueryString` / `parseSearch` |
| Sensible defaults: one adult, any cabin, departing tomorrow, return a week later. | `defaultValues` |
| One-click swap of the two airports. | Search form |
| Sort applies at once, price range with one button, without filling the form again; both reset to page 1. | [`results-toolbar.tsx`](../../frontend/src/features/flights/ui/results-toolbar.tsx) |
| One way: **Book** goes straight to checkout with the flight, cabin and passengers filled in. Round trip: pick both legs on one page (a sticky bar shows progress), then **Book round trip**. | [`links.ts`](../../frontend/src/features/flights/model/links.ts) `checkoutHref` |
| The details page keeps the passengers and the other chosen leg, so booking from there still books the whole trip. | `detailsHref` / `parseDetailsQuery` |
| Dashboard tabs (Airline, Flights, Policies) keep every area one click away; list rows link straight to **Manage** and **Bookings**. | [`dashboard-nav.tsx`](../../frontend/src/features/airline-dashboard/ui/dashboard-nav.tsx) |
| Edits send only what changed, so a time change does not touch the airports. | `flightChanges`, `cabinChanges` |
| The refund tier editor previews the rule live ("cancelling 10 days before gets 50% back") before saving. | `TiersForm` |

## 4. Easy to learn

- The same patterns repeat everywhere: status filters are pill links, lists page with the shared `Pagination` (10 per page, GEN-05), forms use the same field layout and save feedback (toast on success, message above the form for errors without a field).
- Rules the API enforces are shown before they bite: "At least 30 (already booked or held)" on the seat count, locked airports once seats are sold, the "Not enough seats" note per cabin.

## 5. Accessibility and keyboard

- Everything works with the keyboard: native links and buttons, Radix selects and dialogs, visible focus rings.
- Passenger steppers are labelled groups with announced counts (`aria-live`), and the − button is disabled at the minimum.
- Current tab, page and filter use `aria-current`; the selected round-trip leg is marked `aria-pressed`.
- Results announce how many flights were found; loading areas are `role="status"` skeletons.

## How to review a page against this list

1. Find the one primary action within two seconds of opening the page.
2. Read every label and error aloud: no API field names, units are clear.
3. Count the clicks for the main task, and remove any step that re-asks for something the page already knows.
4. Use only the keyboard (Tab, Enter, Esc, arrows) for the whole task.
5. Repeat at 375 px, 768 px and 1280 px wide.
