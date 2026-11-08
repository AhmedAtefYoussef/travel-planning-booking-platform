# Requirements traceability matrix (TRVL-134)

Requirement ID -> endpoint(s) -> owner -> Jira -> PR -> status, for all 115 workbook IDs
(104 mandatory, 11 bonus).
**Update the row in the same PR that implements or changes a requirement** (the pr-governance check
enforces this when `backend/src/modules/**` changes). CI also fails if a workbook ID is missing here.

Status values: `Not started`, `In progress`, `In review`, `Done`, `Partial: ...`. List every PR that implements
or changes the requirement in the PR column (e.g. `#12, #18`).

## Notes on the brief vs the workbook
- The brief cites **ACC-03** (`POST /api/auth/register`) and **BLG-11** (`GET /api/posts`, `GET /api/tags/:tag/posts`); neither ID exists in the workbook. Those endpoints are traced to ACC-01 and BLG-02/BLG-08/BLG-09.
- **HTL-09** (check-in/check-out times) is served by `PUT /api/hotels/:id/policies`; the brief maps that endpoint to HTL-08.
- `GET /api/itineraries/:id/hotels` serves **ITN-25** (TRVL-83); the brief maps it to ITN-09.
- Brief section 5.1 seeds attractions while GEN-12 lists currencies: both are seeded.
- The `airlines` and `flights` schemas (TRVL-138, Jira setup task, not a workbook ID) back FLT-01, FLT-03, FLT-04, FLT-08, FLT-09, FLT-22 and FLT-30. Each of those rows changes status when its own endpoints land.

## Accounts & Admin

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| ACC-01 | Mandatory | POST /api/auth/register | Abdelrahman | TRVL-13 | - | Not started |
| ACC-04 | Mandatory | POST /api/auth/login; GET /api/auth/me | Abdelrahman | TRVL-14 | - | Not started |
| ACC-05 | Mandatory | POST /api/auth/login | Abdelrahman | TRVL-15 | - | Not started |
| ACC-06 | Mandatory | POST /api/auth/logout | Abdelrahman | TRVL-16 | - | Not started |
| ACC-07a | Mandatory | POST /api/admin/users/:id/reset-password | Abdelrahman | TRVL-17 | - | Not started |
| ACC-08 | Mandatory | PATCH /api/auth/change-password | Abdelrahman | TRVL-18 | - | Not started |
| ACC-09 | Mandatory | PATCH /api/users/me | Abdelrahman | TRVL-19 | - | Not started |
| ACC-10 | Mandatory | (frontend, Milestone 2) | Abdelrahman | TRVL-20 | - | Not started |
| ACC-11 | Mandatory | GET /api/auth/me; GET /api/users/me; global guards | Abdelrahman | TRVL-21 | #3 | Partial: guards + access helpers; real auth guard pending |
| ACC-12 | Mandatory | DELETE /api/users/me | Abdelrahman | TRVL-22 | - | Not started |
| ACC-13 | Mandatory | POST /api/admin/moderators | Abdelrahman | TRVL-23 | - | Not started |
| ACC-14 | Mandatory | GET /api/admin/accounts | Abdelrahman | TRVL-24 | - | Not started |
| ACC-15 | Mandatory | PATCH /api/admin/accounts/:id/suspend\|reactivate; provider deactivate/reactivate | Karim | TRVL-25 | - | Not started |
| ACC-16 | Mandatory | PATCH /api/admin/accounts/:id/suspend\|reactivate | Karim | TRVL-26 | - | Not started |
| ACC-17 | Mandatory | GET /api/admin/bookings | Karim | TRVL-27 | - | Not started |
| ACC-18 | Mandatory | admin seed script | Abdelrahman | TRVL-108 | - | Not started |
| ACC-02 | Bonus | GET /api/auth/verify-email | Team | TRVL-117 | - | Not started |
| ACC-07 | Bonus | POST /api/auth/forgot-password; POST /api/auth/reset-password | Team | TRVL-118 | - | Not started |
| BON-01 | Bonus | admin analytics (bonus) | Team | TRVL-126 | - | Not started |

## Flights

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| FLT-01 | Mandatory | POST /api/airlines; GET\|PATCH /api/airlines/:id | Joudy | TRVL-28 | #9 | In review |
| FLT-02 | Mandatory | GET /api/airports | Joudy | TRVL-29 | #7 | In review |
| FLT-03 | Mandatory | POST /api/flights; GET /api/airports | Joudy | TRVL-30 | #10 | In review |
| FLT-04 | Mandatory | POST /api/flights/:id/cabins; PATCH /api/flights/:id/cabins/:cabinId; PUT /api/airlines/:id/baggage-policy | Joudy | TRVL-31 | #11 | In review (baggage-policy endpoint comes with FLT-08) |
| FLT-05 | Mandatory | PATCH /api/flights/:id; PATCH /api/flights/:id/cabins/:cabinId | Joudy | TRVL-32 | - | Not started |
| FLT-06 | Mandatory | POST /api/flights/:id/cancel | Karim | TRVL-33 | - | Not started |
| FLT-08 | Mandatory | PUT /api/airlines/:id/baggage-policy | Joudy | TRVL-34 | - | In review |
| FLT-09 | Mandatory | PUT /api/airlines/:id/cancellation-policy | Joudy | TRVL-35 | #4 | Partial: tier rule |
| FLT-11 | Mandatory | GET /api/flights/search; GET /api/airports | Joudy | TRVL-36 | - | In review |
| FLT-12 | Mandatory | GET /api/flights/search | Ahmed | TRVL-37 | - | Not started |
| FLT-15 | Mandatory | GET /api/flights/search | Joudy | TRVL-38 | - | Not started |
| FLT-17 | Mandatory | GET /api/flights/:id | Joudy | TRVL-39 | - | Not started |
| FLT-19 | Mandatory | POST /api/flight-bookings | Karim | TRVL-40 | - | Not started |
| FLT-21 | Mandatory | POST /api/flight-bookings | Karim | TRVL-41 | - | Not started |
| FLT-22 | Mandatory | POST /api/flight-bookings/hold | Ahmed | TRVL-42 | - | Not started |
| FLT-23 | Mandatory | GET /api/flight-bookings/:id/e-ticket; payment webhook | Ahmed | TRVL-43 | - | Not started |
| FLT-25 | Mandatory | GET /api/flight-bookings; GET /api/flight-bookings/:id | Karim | TRVL-44 | - | Not started |
| FLT-26 | Mandatory | POST /api/flight-bookings/:id/cancel | Karim | TRVL-45 | - | Not started |
| FLT-29 | Mandatory | GET /api/flights/:id/bookings; GET /api/flights/:id/passengers/export | Karim | TRVL-46 | - | Not started |
| FLT-30 | Mandatory | flight status lifecycle (scheduled job + FLT-06) | Joudy | TRVL-107 | - | Not started |
| FLT-27 | Bonus | PATCH /api/flight-bookings/:id/change-flight | Team | TRVL-120 | - | Not started |
| FLT-28 | Bonus | PATCH /api/flight-bookings/:id/seat | Team | TRVL-121 | - | Not started |

## Hotels

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| HTL-01 | Mandatory | POST /api/hotels; PATCH /api/hotels/:id | Sandra | TRVL-47 | - | Not started |
| HTL-02 | Mandatory | GET /api/hotels/:id | Sandra | TRVL-48 | - | Not started |
| HTL-03 | Mandatory | POST /api/hotels/:id/rooms | Sandra | TRVL-49 | - | Not started |
| HTL-04 | Mandatory | POST /api/hotels/:id/rooms/:roomId/availability | Sandra | TRVL-50 | - | Not started |
| HTL-05 | Mandatory | PATCH /api/hotels/:id/rooms/:roomId; PATCH .../availability | Sandra | TRVL-51 | - | Not started |
| HTL-06 | Mandatory | DELETE /api/hotels/:id/rooms/:roomId; PATCH .../availability | Sandra | TRVL-52 | - | Not started |
| HTL-08 | Mandatory | GET /api/hotels/:id/availability | Sandra | TRVL-53 | - | Not started |
| HTL-09 | Mandatory | PUT /api/hotels/:id/policies (brief maps it to HTL-08) | Sandra | TRVL-54 | - | Not started |
| HTL-10 | Mandatory | PUT /api/hotels/:id/policies | Sandra | TRVL-55 | #4 | Partial: tier rule |
| HTL-11 | Mandatory | GET /api/hotels/search | Sandra | TRVL-56 | - | Not started |
| HTL-12 | Mandatory | GET /api/hotels/search | Sandra | TRVL-57 | - | Not started |
| HTL-15 | Mandatory | GET /api/hotels/:id/rooms/available | Sandra | TRVL-58 | - | Not started |
| HTL-16 | Mandatory | POST /api/hotel-bookings | Ahmed | TRVL-59 | - | Not started |
| HTL-17 | Mandatory | payment webhook -> hotel reservation confirmed | Ahmed | TRVL-60 | - | Not started |
| HTL-18 | Mandatory | POST /api/hotel-bookings | Ahmed | TRVL-61 | - | Not started |
| HTL-20 | Mandatory | GET /api/hotel-bookings; GET /api/hotel-bookings/:id | Karim | TRVL-62 | - | Not started |
| HTL-21 | Mandatory | POST /api/hotel-bookings/:id/cancel | Karim | TRVL-63 | - | Not started |
| HTL-22 | Mandatory | GET /api/hotels/:id/reservations | Karim | TRVL-64 | - | Not started |
| HTL-23 | Mandatory | POST /api/hotel-bookings/:id/review; PATCH\|DELETE /api/reviews/:id | Karim | TRVL-65 | - | Not started |
| HTL-24 | Mandatory | GET /api/hotels/:id/reviews | Karim | TRVL-66 | - | Not started |
| HTL-26 | Bonus | POST /api/reviews/:id/reply | Team | TRVL-122 | - | Not started |

## Payments & Policies

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| PAY-01 | Mandatory | POST /api/payments; POST /api/payments/:id/retry; GET /api/payments/:id; POST /api/payments/webhook | Ahmed | TRVL-67 | #4 | Partial: schemas |
| PAY-02 | Mandatory | GET /api/bookings/:type/:id/policies; POST /api/bookings/:type/:id/accept-policies | Ahmed | TRVL-68 | - | Not started |
| PAY-03 | Mandatory | GET /api/refunds/:id | Ahmed | TRVL-69 | #4 | Partial: schemas, refund quote |
| PAY-04 | Mandatory | platform-wide (PLATFORM_CURRENCY, money utils) | Ahmed | TRVL-109 | #2 | Partial: money utils, env |

## Itineraries

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| ITN-01 | Mandatory | POST /api/itineraries; PATCH\|DELETE /api/itineraries/:id | Sarah | TRVL-70 | - | Not started |
| ITN-03 | Mandatory | GET /api/itineraries; GET /api/itineraries/:id | Sarah | TRVL-71 | - | Not started |
| ITN-05 | Mandatory | POST /api/itineraries/:id/days; PATCH /api/itineraries/:id/days/:dayId | Sarah | TRVL-72 | - | Not started |
| ITN-07 | Mandatory | DELETE /api/itineraries/:id/days/:dayId | Sarah | TRVL-73 | - | Not started |
| ITN-08 | Mandatory | PATCH /api/itineraries/:id/days/reorder | Sarah | TRVL-74 | - | Not started |
| ITN-09 | Mandatory | day city + grouping in itinerary responses | Sarah | TRVL-75 | - | Not started |
| ITN-10 | Mandatory | POST /api/itineraries/:id/days/:dayId/activities; PATCH\|DELETE /api/activities/:id | Sarah | TRVL-76 | - | Not started |
| ITN-12 | Mandatory | POST /api/activities/:id/images; DELETE /api/activities/:id/images/:imageId | Sarah | TRVL-77 | - | Not started |
| ITN-14 | Mandatory | POST /api/itineraries/:id/days/:dayId/budgets; PATCH\|DELETE /api/budgets/:id; GET /api/itineraries/:id/budget-summary | Malak | TRVL-78 | - | Not started |
| ITN-16 | Mandatory | POST /api/itineraries/:id/transport-costs; PATCH\|DELETE /api/transport-costs/:id | Malak | TRVL-79 | - | Not started |
| ITN-18 | Mandatory | GET /api/itineraries/:id/budget-summary; GET /api/currencies/rates | Malak | TRVL-80 | - | Not started |
| ITN-20 | Mandatory | PATCH /api/itineraries/:id; GET /api/itineraries/public/search | Sarah | TRVL-81 | - | Not started |
| ITN-21 | Mandatory | GET /api/itineraries/public/search; GET /api/itineraries/public/:id; POST /api/itineraries/:id/clone | Sarah | TRVL-82 | - | Not started |
| ITN-25 | Mandatory | GET /api/itineraries/:id/hotels (brief maps it to ITN-09) | Sarah | TRVL-83 | - | Not started |
| ITN-26 | Mandatory | GET /api/itineraries/:id/flights | Sarah | TRVL-84 | - | Not started |
| ITN-27 | Bonus | POST /api/itineraries/:id/bookings | Team | TRVL-123 | - | Not started |
| ITN-28 | Bonus | GET /api/itineraries/:id/pdf | Team | TRVL-124 | - | Not started |

## Blog

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| BLG-01 | Mandatory | POST /api/posts | Malak | TRVL-85 | - | Not started |
| BLG-02 | Mandatory | GET /api/posts; GET /api/posts/:id | Malak | TRVL-86 | - | Not started |
| BLG-03 | Mandatory | GET /api/posts/mine | Malak | TRVL-87 | - | Not started |
| BLG-04 | Mandatory | PATCH\|DELETE /api/posts/:id | Malak | TRVL-88 | - | Not started |
| BLG-05 | Mandatory | POST /api/posts/:id/comments | Malak | TRVL-89 | - | Not started |
| BLG-06 | Mandatory | POST\|DELETE /api/posts/:id/like | Malak | TRVL-90 | - | Not started |
| BLG-07 | Mandatory | PATCH\|DELETE /api/comments/:id | Malak | TRVL-91 | - | Not started |
| BLG-08 | Mandatory | PATCH /api/posts/:id; GET /api/tags/:tag/posts | Malak | TRVL-92 | - | Not started |
| BLG-09 | Mandatory | GET /api/posts?q= | Malak | TRVL-93 | - | Not started |
| BLG-10 | Mandatory | POST /api/posts/:id/images; DELETE /api/posts/:id/images/:imageId | Malak | TRVL-94 | - | Not started |
| BLG-12 | Mandatory | GET /api/authors/:id | Malak | TRVL-95 | - | Not started |
| BLG-13 | Bonus | PATCH /api/posts/:id/itinerary | Team | TRVL-125 | - | Not started |

## Cross-cutting

| ID | Type | Endpoint(s) | Owner | Jira | PR | Status |
|---|---|---|---|---|---|---|
| GEN-01 | Mandatory | GET /api/notifications; PATCH /api/notifications/:id/read | Karim | TRVL-96 | - | Not started |
| GEN-02 | Mandatory | global ValidationPipe + AllExceptionsFilter (all endpoints); demo: POST /api/diagnostics/validation, /api/diagnostics/records | Ahmed | TRVL-97 | #2, #3 | In review |
| GEN-03 | Mandatory | (frontend, Milestone 2) | Karim | TRVL-98 | - | Not started |
| GEN-04 | Mandatory | (frontend, Milestone 2) | Sarah | TRVL-99 | - | Not started |
| GEN-05 | Mandatory | PaginationQueryDto + global page-size middleware (all lists); demo: GET /api/diagnostics/rows | Ahmed | TRVL-100 | #2, #3 | In review |
| GEN-06 | Mandatory | flight responses (airport-local times): POST /api/flights; later GET /api/flights/search, GET /api/flights/:id | Joudy | TRVL-101 | #10 | Partial: local times in POST /api/flights and GET /api/flights/search; details (FLT-17) pending |
| GEN-07 | Mandatory | GET /api/admin/audit-logs; AUDIT_SERVICE | Ahmed | TRVL-102 | #4 | Partial: AUDIT_SERVICE + schema; endpoint pending |
| GEN-08 | Mandatory | UPLOADS_SERVICE (image endpoints) | Ahmed | TRVL-103 | - | Not started |
| GEN-09 | Mandatory | POST /api/reports | Malak | TRVL-104 | - | Not started |
| GEN-10 | Mandatory | GET /api/admin/reports; PATCH /api/admin/reports/:id; DELETE /api/admin/content/:type/:id | Malak | TRVL-105 | - | Not started |
| GEN-11 | Mandatory | booking lifecycle (BOOKING_TRANSITIONS) | Ahmed | TRVL-106 | #4 | Partial: transition table |
| GEN-12 | Mandatory | npm run seed (countries, cities, airports, attractions, currencies); GET /api/countries; GET /api/cities; GET /api/currencies | Joudy | TRVL-110 | #6 | In review |
| GEN-13 | Mandatory | global guards, ValidationPipe, PasswordService (all endpoints); demo: /api/diagnostics/password-hash, /whoami, /admin-only | Ahmed | TRVL-111 | #2, #3 | In review |
| ACC-19 | Mandatory | auth cookies; GET /api/auth/me | Abdelrahman | TRVL-112 | - | Not started |
| GEN-14 | Mandatory | (frontend, Milestone 2) | Malak | TRVL-113 | - | Not started |
| GEN-15 | Mandatory | (frontend, Milestone 2) | Joudy | TRVL-114 | - | Not started |
| GEN-16 | Mandatory | (frontend, Milestone 2) | Sandra | TRVL-115 | - | Not started |
| GEN-17 | Mandatory | (frontend, Milestone 2) | Ahmed | TRVL-116 | - | Not started |
| GEN-01-B | Bonus | SMTP mailer (bonus) | Team | TRVL-119 | - | Not started |
| BON-02 | Bonus | favourites (bonus) | Team | TRVL-127 | - | Not started |
