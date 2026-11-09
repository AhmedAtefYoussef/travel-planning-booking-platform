

## Travel Platform — Milestone 1 Engineering
## Plan & Team Workflow
Nov 2, 2026 ·  @Ahmed
## Summary
Milestone 1 (deadline Fri 20 Nov, 18 days from today) is a complete NestJS + MongoDB
Atlas backend of 108 mandatory endpoints (the brief's API tables, optional rows
excluded), evaluated entirely through Swagger UI. The repository is currently empty (no
commits), so the first three days go to a shared foundation that unblocks all seven people
at once.
How the work is split: each member owns one vertical domain end to end (schema,
service, controller, DTOs, Swagger docs, tests). Ahmed owns the foundation, the shared
cross-cutting services, payments, pull-request reviews and releases. Ownership follows
the feature modules the brief names, which keeps merge conflicts low and makes Git
history show clear individual contributions.
Five decisions that shape everything else:
- Short-lived access JWT + refresh token, both in httpOnly, Secure, SameSite cookies
## (ACC-19). A
sessions
collection stores the hashed refresh token and
lastActivityAt
, so logout revokes it and 30 minutes without a request ends the
session (ACC-06). Swagger UI is same-origin, so after
## /api/auth/login
every later
call is authenticated automatically.
- Deny-by-default authorization: a global auth guard, a
@Public()
decorator, a
@Roles()
guard, a provider-scope guard for moderators, and ownership checks inside
services (ACC-11, GEN-13).
- Inventory safety through atomic conditional updates (flight cabins) and a unique
(roomId, date)
index (hotel rooms), never read-then-write. Holds last exactly 10
minutes (FLT-22, HTL-18).
- One booking lifecycle for both types: Pending Payment → Confirmed → Completed,
plus Pending Payment → Expired and Confirmed → Cancelled (GEN-11). Confirmation
only happens after the Stripe webhook verifies the PaymentIntent; the cancellation
tiers are snapshotted onto the booking when policies are accepted.
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 1 of 27

- Booking money uses one platform currency in integer minor units (PAY-04). Only
itinerary budgets are multi-currency, converted with daily-cached FXRatesAPI rates.
All datetimes are stored in UTC and shown in each airport's local time zone (GEN-06).
Inputs received (2 Nov): the reviewed requirements workbook (104 mandatory rows, 11
bonus rows) and the mock reference data (8 countries, cities, airports and attractions).
The rules below quote the workbook directly. Where the workbook and the project
description disagree, the workbook wins, as the brief says.
SDLC approach
We run an iterative, incremental process (lightweight Scrum): one foundation sprint, two
build sprints and a hardening window, each ending in a merge to
develop
that someone
can demo in Swagger. All six classic SDLC phases still happen, but compressed and per
feature rather than once for the whole project.
SDLC phaseWhat it means for us in
## M1
Output (in repo)
## 1. Requirements
analysis
Each owner reads every
workbook row for their
IDs, writes down
business rules and
acceptance criteria, and
confirms them against
the Jira story for that
requirement ID (project
## TRVL)
Jira stories (one per requirement ID,
labelled by ID, owner and module);
docs/requirements/traceability.md
## (ID
→ endpoint → owner → status)
- DesignSchema design and API
contract per module,
reviewed before coding;
architectural decisions
recorded as short ADRs
docs/architecture/erd.md
## ,
docs/architecture/adr-00X-*.md
## ,
module design notes
- ImplementationFeature branches per
requirement ID, small
PRs, Conventional
## Commits
Code under
backend/src/modules/*
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 2 of 27

Definition of Ready (before anyone starts an issue): requirement ID and acceptance
criteria copied from the workbook, schema fields agreed, and any dependency (guard,
service or seed data) is merged or stubbed.
Ceremonies kept light for a student team: a 10-minute async stand-up in the group chat
every day (yesterday / today / blocked), a 30-minute sprint review on 4, 11 and 17 Nov
where everyone demos in Swagger, and the Jira Scrum board (TRVL) with columns To Do
→ In Progress → Done, each issue linking its open pull request while in review.
Backend architecture and technical decisions
One NestJS app, layered as Controller (HTTP + DTO validation + Swagger) → Service
(business rules, ownership, transactions) → Mongoose Model. Controllers never touch
models directly, and modules talk to each other only through exported services.
Folder layout
backend/src/
main.ts                 # global prefix /api, ValidationPipe, cookie-
parser, rawBody, Swagger
app.module.ts
config/                 # env schema + validation (fails fast if
SDLC phaseWhat it means for us in
## M1
Output (in repo)
- TestingUnit tests for business
rules (lockout, refunds,
budget maths); e2e tests
for concurrency and
auth; manual Swagger
walkthrough per module
## *.spec.ts
## ,
test/*.e2e-spec.ts
## ,
Swagger demo script
- ReleaseCode freeze, bug bash,
merge
develop
## →
main
## ,
tag
v1.0.0-m1
Git tag, README, AI_PROMPTS.txt
- MaintenanceBugs found in M2
integration go to
fix/<ID>-...
branches
off
develop
Issue tracker
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 3 of 27

MONGODB_URI etc. missing)
common/
decorators/           # @Public, @Roles, @CurrentUser, @ApiPaginated
guards/               # JwtAuthGuard (global), RolesGuard,
ProviderScopeGuard
filters/              # AllExceptionsFilter -> one error shape
dto/                  # PaginationQueryDto, PaginatedResponseDto
pipes/                # ParseObjectIdPipe
utils/                # money.ts (minor units), dates.ts (UTC/time zones)
modules/
auth/ users/ admin/ audit/ notifications/ uploads/ reports/
reference/            # countries, cities, airports, attractions (seeded)
airlines/ flights/ flight-bookings/
hotels/ hotel-bookings/ reviews/
payments/ currency/
itineraries/ budgets/
blog/                 # posts, comments, likes, tags, authors
database/seeds/         # reference data, admin account, demo providers
test/                     # e2e (supertest)
Cross-cutting decisions
ConcernDecisionRequirement
ValidationGlobal
ValidationPipe({ whitelist:
true, forbidNonWhitelisted: true,
transform: true })
; class-validator
DTOs on every body and query
GEN-13; blocks mass
assignment such as a user
sending
role: "ADMIN"
Error shapeOne
AllExceptionsFilter
## :
## {
statusCode, error, message,
fieldErrors?: [{ field, message }],
path, timestamp }
. Duplicate key →
409, bad ObjectId → 400, ownership miss
## → 404
GEN-02 (field-level
messages the M2 forms can
show), ACC-11
## Pagination
## ?page=
N on every list, fixed page size of
10; response
{ items, page, limit,
total, totalPages }
GEN-05 (page size 10)
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 4 of 27

ConcernDecisionRequirement
Auth cookies
access_token
(15 min JWT:
sub
## ,
role
## ,
sid
## ) +
refresh_token
(random, stored
hashed in
sessions
), both httpOnly,
Secure, SameSite=Lax.
## POST
## /api/auth/refresh
rotates the refresh
token
## ACC-06, ACC-19
Idle timeoutGuard updates
sessions.lastActivityAt
on each
authenticated request; refresh or access
is refused when it is over 30 minutes old
## ACC-06
Passwordsbcrypt (salted); rule ≥ 8 characters with
at least one letter and one digit;
mustChangePassword
flag after an admin
sets a temporary password, which blocks
every endpoint except change-password
and logout
ACC-01, ACC-07a, ACC-13,
## GEN-13
## Lockout
failedLoginCount
## +
lockedUntil
## ; 5
consecutive failures → locked 15 minutes;
success resets the counter. Messages:
generic "invalid email or password",
"account suspended", "account locked"
## ACC-04, ACC-05
## Authorization
JwtAuthGuard
as
## APP_GUARD
## +
@Public()
## ;
RolesGuard
## +
@Roles()
## ;
ProviderScopeGuard
compares a
moderator's
assignedProvider
with
## :id
; services always filter by owner
## ACC-11, ACC-13
## Swagger
addCookieAuth('access_token')
, one
tag per module,
## [ID]
in every
summary
## ,
@ApiProperty
examples,
400/401/403/404/409 documented
Graded through Swagger UI
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 5 of 27

ConcernDecisionRequirement
ConcurrencyFlights: one atomic conditional
## $inc
per
cabin (available = seats − booked − held).
Hotels: insert one
room_nights
doc per
room per night inside a transaction; the
unique
(roomId, date)
index rejects
any overlap, so the whole multi-room
request fails together
## FLT-22, HTL-18
Scheduled jobs
## @nestjs/schedule
, every 30 s: expire
unpaid bookings after 10 min (release
inventory, cancel the PaymentIntent);
mark flights Departed; mark bookings
Completed after departure or check-out;
refresh exchange rates once a day
## FLT-22, HTL-18, FLT-30, GEN-
## 11, HTL-23, ITN-18
PaymentsStripe test mode, PaymentIntent created
by the backend; the card is entered in
Stripe Elements on the M2 frontend, so
card data never reaches us. Confirmation
only in the verified webhook (
rawBody:
true
). We store only the Stripe id,
amount, currency and status
## PAY-01
## Refunds
refund % = tier with the highest
days-before threshold ≤ days
remaining; no tier → 0%
; provider
cancellations 100%; Stripe Refunds API;
status Pending / Refunded / Failed
## FLT-09, HTL-10, PAY-03
CurrencyBookings: one platform currency (e.g.
USD, set in
## .env
). Itinerary budgets: any
supported currency, converted to the
user's preferred currency using rates
fetched once a day from FXRatesAPI,
cached in Mongo with the rate date; if
the API fails, the last cached rates are
used
## PAY-04, ITN-18
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 6 of 27

Data model
The rule we follow: embed bounded data the parent owns and always reads with it;
reference anything shared, independently changing, unbounded, or addressed by its own
top-level endpoint (e.g.
## /api/activities/:id
). Every collection gets
timestamps:
true
; every list filter and sort field gets an index.
ConcernDecisionRequirement
TimeStore UTC; flights are entered and
searched in each airport's local time
(IANA zone from the seed data),
converted with Luxon
## FLT-03, FLT-11, GEN-06
UploadsJPG/PNG only (MIME + file signature
check), ≤ 5 MB each, ≤ 5 images per post,
activity or hotel, 1 logo per airline; stored
on disk under
## /uploads
, served by URL
## GEN-08
## Audit +
notifications
## Shared
AuditService.record()
for
admin actions;
NotificationsService.notify()
for
booking confirmed / cancelled /
refunded, schedule change, account or
provider suspension; unread count +
mark read
## GEN-07, GEN-01
Reference dataThe seed uses the dataset's own keys as
document ids (
cities._id = "cairo"
## ,
airports._id = "CAI"
## ,
countries._id
## = "EG"
), so our records match the
identifiers used in evaluation; the
currency list comes from the countries'
currencies
## GEN-12, FLT-02
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 7 of 27

CollectionOwnerKey fieldsEmbed / referenceKey indexes
users
Abdelrahmanname, email, passwordHash,
phone, preferredCurrency,
termsAcceptedAt, role
## (USER / ADMIN /
## AIRLINE_MOD /
HOTEL_MOD), status
## (ACTIVE / SUSPENDED /
## DEACTIVATED),
mustChangePassword,
failedLoginCount,
lockedUntil,
assignedProvider
## {type,
providerId}
assignedProvider
embedded
unique
email
## ;
## {role,
status}
sessions
AbdelrahmanuserId, refreshTokenHash,
lastActivityAt, expiresAt,
revokedAt
ref usersTTL on
expiresAt
countries
## ,
cities
## ,
airports
## ,
attractions
## ,
currencies
Joudydataset keys as
## _id
## (
## EG
## ,
cairo
## ,
## CAI
## ,
att-1
); airport
name, cityId, countryCode,
timeZone; country currency
refs by dataset key
## _id
; airports
cityId
airlines
Joudyname, code, logoUrl, active,
extraBaggage
{pricePerBag,
maxBagsPerPassenger}
## ,
cancellationTiers[]
{daysBefore,
refundPercent}
embeddedunique code
flights
JoudyairlineId, flightNumber,
fromAirport, toAirport,
departAtUtc, arriveAtUtc,
departLocalDate, status
## (SCHEDULED / CANCELLED
/ DEPARTED), cabins[]
{class: ECONOMY |
## PREMIUM_ECONOMY |
BUSINESS | FIRST, seats,
booked, held, priceMinor,
freeBags, maxKgPerBag}
cabins embedded (≤
4, each class once)
unique
{airlineId,
flightNumber,
departLocalDate}
## ;
{fromAirport,
toAirport, departAtUtc,
status}
flight_bookings
KarimuserId, reference (unique,
set on confirm), segments[]
{flightId, cabinClass,
unitPriceMinor}
(1 or 2),
passengers[]
{fullName,
dob, docNumber, type:
## ADULT | CHILD | INFANT,
extraBags}
, totalMinor,
status (PENDING_PAYMENT
## / CONFIRMED /
## COMPLETED / EXPIRED /
## CANCELLED),
holdExpiresAt,
policySnapshot,
policiesAcceptedAt,
paymentId, refundId
embedded
{userId, status}
## ,
unique sparse reference,
## {status,
holdExpiresAt}
## ,
segments.flightId
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 8 of 27

CollectionOwnerKey fieldsEmbed / referenceKey indexes
hotels
Sandraname, address, cityId,
countryCode, description,
photos[] (≤ 5), starClass,
amenities[], checkInTime,
checkOutTime,
cancellationTiers[], active,
ratingAvg, ratingCount
embedded
{cityId, active}
## ,
{countryCode, active}
rooms
SandrahotelId, number, type, beds,
maxOccupancy, priceMinor,
availability[]
{from, to}
(non-overlapping), active,
everReserved
availability
embedded
unique
{hotelId,
number}
room_nights
## Sandra (schema) /
## Karim (booking
use)
roomId, hotelId, date, kind
## (BLOCKED / HELD /
BOOKED), reservationId,
reference, expiresAt
one doc per room per
night
unique
{roomId, date}
hotel_reservations
KarimuserId, hotelId, reference,
checkIn, checkOut, rooms[]
{roomId, adults,
children[ages],
nightlyPriceMinor}
## ,
totalMinor, status (same
lifecycle), holdExpiresAt,
policySnapshot,
policiesAcceptedAt,
paymentId, refundId
embedded
{userId, status}
## ,
{hotelId, checkIn}
reviews
SandrahotelId, reservationId
(unique), userId, rating 1–5,
text ≤ 1000, hidden
refunique reservationId;
{hotelId, createdAt}
payments
## ,
refunds
AhmedbookingType, bookingId,
stripeId, amountMinor,
currency, status (payments:
## REQUIRES_PAYMENT /
## SUCCEEDED / FAILED /
CANCELED; refunds:
## PENDING / REFUNDED /
FAILED), refundPercent
ref bookingsunique stripeId
exchange_rates
Ahmedbase, rates map, rateDate,
fetchedAt
kept, never deleted
## (fallback)
{base, rateDate}
itineraries
SarahownerId, title (≤ 100),
countries[], startDate,
visibility (PRIVATE default /
PUBLIC), hidden, days[]
{_id, cityId, notes}
(array order = day number, ≤
60; dates derived),
clonedFrom
{itineraryId,
authorId, authorName}
days embeddedownerId + updatedAt;
{visibility, hidden,
countries}
; text on title
activities
SarahitineraryId, dayId, name,
description, time?,
costMinor?, currency?,
images[] (≤ 5)
ref (own endpoints)
{itineraryId, dayId}
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 9 of 27

Unique indexes do the heavy lifting: "like at most once" (BLG-06), "one review per
reservation" (HTL-23), "report an item at most once" (GEN-09) and "no overlapping room
bookings" are enforced by the database, so race conditions are impossible even if two
requests arrive at the same millisecond.
Team ownership matrix
Work is split into seven vertical domains of roughly equal effort (count of mandatory
endpoints, weighted by difficulty), with Ahmed carrying fewer endpoints to leave time for
reviewing every PR. Each owner is also the second reviewer for the neighbour listed in the
last column.
CollectionOwnerKey fieldsEmbed / referenceKey indexes
budget_entries
## ,
transport_costs
AbdelrahmanitineraryId, dayId, category
## (FOOD / ACCOMMODATION
## / IN_CITY_TRANSPORT /
ACTIVITIES), amountMinor ≥
0, currency / mode,
fromCityId, toCityId
ref
{itineraryId, dayId}
posts
## ,
comments
## ,
likes
MalakauthorId, title, body, tags[] (≤
5, ≤ 30 chars), images[] (≤ 5),
status (DRAFT /
PUBLISHED), hidden,
likeCount, commentCount;
comment body ≤ 500
likes separateunique
{postId,
userId}
on likes;
{status, hidden,
publishedAt}
; text on
title + tags
reports
MalakreporterId, targetType (POST
## / COMMENT / REVIEW /
ITINERARY), targetId,
reason, status (OPEN /
## DISMISSED / HIDDEN /
DELETED), resolvedBy
refunique
{reporterId,
targetType, targetId}
## ;
## {status}
notifications
KarimuserId, type, title, body, link,
readAt
ref
{userId, readAt}
audit_logs
AhmedactorId, action, targetType,
targetId, metadata
append-only
{createdAt}
, actorId
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 10 of 27

MemberDomain (modules)Workbook IDs
owned
## Brief
endpoints
owned (+
added)
Hardest partPeer reviewer
Ahmed (lead)Foundation &
common layer;
## Payments &
## Refunds;
## Currency
(FXRatesAPI);
Audit log;
Uploads; releases
## PAY-01, 02, 03,
## 04; GEN-02, 05,
## 07, 08, 13; ITN-
## 18 (rates
service)
8 (+2)Webhook-only
confirmation, hold-
expiry
PaymentIntent
cancel, refund
tiers, keeping
develop
green
## Karim
AbdelrahmanAuth, sessions,
users, admin
account &
provider
management;
then itinerary
budgets &
transport costs
## ACC-01, 04, 05,
## 06, 07a, 08, 09,
## 11, 12, 13, 14, 15,
## 16, 18, 19; ITN-14,
## 16, 18
## (summary)
20 (+3)Access + refresh
cookies, 30-min
idle expiry,
lockout, forced
password change,
deactivation rules
## Malak
## Malak
## Hussein
## Blog (posts,
comments, likes,
tags, search,
authors, images);
## Reports &
moderation
BLG-01 to BLG-
## 10, BLG-12;
## GEN-09, 10
18 (+2)Interaction-score
search, hidden-
content visibility
across 4 content
types
## Abdelrahman
Joudy HagarReference data
seeding; airports;
airlines (profile,
extra baggage,
tiers); flights &
cabins; schedule
edits &
cancellation;
search; airline
booking views
## GEN-06, 12;
## FLT-01, 02, 03,
## 04, 05, 06, 08,
## 09, 11, 12, 15, 17,
## 29, 30
15 (+2)Local-time entry
and search, round
trip, passenger
types, edit
restrictions
## Sandra
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 11 of 27

The endpoint column counts the 108 mandatory rows of the brief's API tables (8 + 20 + 18
+ 15 + 11 + 17 + 19 = 108); "+ added" counts endpoints we add that the brief does not list
(refresh, provider deactivation, notifications, currencies, reports, content hide, refund
quotes, countries/cities).
Frontend-only rows go to Milestone 2: ACC-10 (return to the action after login), GEN-03
(confirmation before destructive actions), GEN-04 (empty states) and GEN-14, GEN-15,
GEN-16, GEN-17 (navigation, usability, feedback and responsiveness, visual consistency).
The backend still supports them: field-level errors for GEN-02 and 401 responses for ACC-
## 10.
MemberDomain (modules)Workbook IDs
owned
## Brief
endpoints
owned (+
added)
Hardest partPeer reviewer
KarimBooking engine:
flight bookings &
holds, hotel
reservations &
holds,
cancellations, e-
ticket PDF,
lifecycle jobs;
## Notifications;
admin bookings
view
## FLT-19, 21, 22,
## 23, 25, 26; HTL-
## 16, 17, 18, 20, 21;
## ACC-17; GEN-
## 01, 11
11 (+5)No overselling, all-
or-nothing multi-
room holds,
lifecycle
transitions
## Ahmed
## Sandra
## George
Hotels, rooms,
availability ranges,
blocks, room
status view,
check-in/out,
tiers, search,
reservations view;
## Reviews
## HTL-01, 02, 03,
## 04, 05, 06, 08,
## 09, 10, 11, 12, 15,
## 22, 23, 24
17Search that needs
N rooms free for
the whole stay
with enough
combined
occupancy
## Joudy
## Sarah
## Ibrahim
Itineraries: CRUD,
days (add / delete
/ reorder), city
groups, activities
+ images,
visibility, public
search, clone,
hotel and flight
search from the
itinerary
## ITN-01, 03, 05,
## 07, 08, 09, 10,
## 12, 20, 21, 25, 26
19Renumbering +
date derivation +
city grouping
staying consistent;
deep clone
## Abdelrahman
(owns the
budget side)
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 12 of 27

Optional bonus endpoints are out of scope for M1 (ACC-02, ACC-07, GEN-01-B, FLT-27,
FLT-28, HTL-26, ITN-27, ITN-28, BLG-13, BON-01, BON-02). Each owner may pick up their
own bonus only after every mandatory item in their row is merged and demoed.
The complete endpoint-by-endpoint assignment is in the section below and is mirrored
one-to-one by the Jira stories.
Per-member Milestone 1 task breakdown
Each checklist is ordered by sprint: S0 = 2–4 Nov, S1 = 5–11 Nov, S2 = 12–17 Nov. Every item
maps to a Jira story or task in TRVL and one
feature/<ID>-<slug>
branch.
Ahmed (team leader)
S0: Create MongoDB Atlas cluster, a database user per member, IP access list; share
## MONGODB_URI
privately (never in chat logs or AI tools)
S0: Repo scaffold per brief 10.1:
backend/
(Nest CLI),
frontend/
(placeholder for M2),
docs/requirements/
## ,
docs/api/
## ,
AI_PROMPTS.txt
## ,
README.md
## ,
## .env.example
## ,
## .gitignore
; create
develop
; protect
main
and
develop
(PR + 1 approval)
S0: Common layer: config validation,
## /api
prefix, ValidationPipe, AllExceptionsFilter
with
fieldErrors
, pagination (page size 10), ParseObjectIdPipe, money/date utils,
Swagger with cookie auth, ESLint + Prettier, PR template — GEN-02, GEN-05, GEN-13
## S0: Stub
@Public
## ,
@Roles
## ,
@CurrentUser
and a fake guard so everyone can code
before real auth lands
## S1:
AuditModule
## :
AuditService.record
## ,
GET /api/admin/audit-logs
(filter by
actor, action, date) — GEN-07
## S1:
UploadsModule
: JPG/PNG, ≤ 5 MB, per-entity limits (5, or 1 for an airline logo),
signature check, static serving — GEN-08
## S1:
CurrencyModule
: daily FXRatesAPI fetch into
exchange_rates
, fallback to the last
cached rates,
convert()
## ,
GET /api/currencies
(seeded list) and
## GET
## /api/currencies/rates
with the rate date — ITN-18
## S1:
PaymentsModule
contract (
PayableBooking
interface, see contracts section);
platform currency in config — PAY-04
## S2:
GET /api/bookings/:type/:id/policies
(airline: tiers + baggage; hotel: tiers +
check-in/out),
POST .../accept-policies
(timestamp + snapshot) — PAY-02
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 13 of 27

## Abdelrahman
## S2:
POST /api/payments
(refuses if policies not accepted or hold expired; returns
clientSecret
## ),
POST /api/payments/:id/retry
## ,
GET /api/payments/:id
## ,
## POST
## /api/payments/webhook
(verify signature, confirm on
payment_intent.succeeded
## ,
mark failed on
payment_intent.payment_failed
## ) — PAY-01
## S2:
cancelForExpiredHold(paymentId)
called by Karim's expiry job — PAY-01
S2: Refund engine:
RefundsService.refundFor(type, id, reason)
using the tier
rule, Stripe Refunds API, status Pending / Refunded / Failed via webhook, notification;
GET /api/refunds/:id
## — PAY-03
Ongoing: review every PR within 24 h; merge to
develop
daily; keep README and the
traceability matrix current
18–20 Nov: code freeze, bug bash, release
develop
## →
main
, tag
v1.0.0-m1
## S0:
## User
## +
## Session
schemas; admin seed script, no admin self-registration — ACC-18
## S1:
POST /api/auth/register
(name, unique email, password ≥ 8 with a letter and a
digit, mandatory consent) — ACC-01
## S1:
POST /api/auth/login
(generic failure message, "account suspended", 5 failures →
locked 15 min, sets both cookies, returns role and
mustChangePassword
## ) — ACC-04,
## ACC-05, ACC-19
## S1:
POST /api/auth/refresh
(rotation, 30-min idle check) and
## POST
## /api/auth/logout
(clear cookies, revoke refresh token) — ACC-06
## S1: Real
JwtAuthGuard
(cookie, session, status, idle time,
mustChangePassword
gate),
RolesGuard
## ,
ProviderScopeGuard
— ACC-11 — target merge 6 Nov
## S1:
PATCH /api/auth/change-password
(current + new),
GET /api/auth/me
## ,
## GET
## /api/users/me
## ,
PATCH /api/users/me
(name, phone, preferred currency from the
supported list) — ACC-08, ACC-09, ACC-19
## S1:
DELETE /api/users/me
: blocked with upcoming Confirmed bookings; afterwards
no login, posts and public itineraries hidden, comments/reviews shown as "Deleted
user" — ACC-12
## S1:
POST /api/admin/moderators
(linked to exactly one hotel or airline, temporary
password),
GET /api/admin/accounts
(search name/email, filter role/status,
paginated),
POST /api/admin/users/:id/reset-password
## — ACC-13, ACC-14, ACC-
## 07a
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 14 of 27

## Malak Hussein
## S2:
PATCH /api/admin/accounts/:id/suspend
and
## /reactivate
for users and
moderators;
PATCH /api/admin/providers/:type/:id/deactivate
and
## /reactivate
(listings hidden from search, existing Confirmed bookings stay valid); audit +
notification on each — ACC-15, ACC-16
S2: Budget entries per day:
POST /api/itineraries/:id/days/:dayId/budgets
## ,
PATCH /api/budgets/:id
## ,
DELETE /api/budgets/:id
(non-negative, currency);
transport costs:
POST /api/itineraries/:id/transport-costs
## ,
## PATCH
## /api/transport-costs/:id
## ,
DELETE /api/transport-costs/:id
(mode, from/to city,
amount, currency, day) — ITN-14, ITN-16
## S2:
GET /api/itineraries/:id/budget-summary
: by category, by day, by city group;
includes activity costs and transport; converted to the user's preferred currency with
the rate date — ITN-14, ITN-18
## S0:
## Post
## ,
## Comment
## ,
## Like
## ,
## Report
schemas and hidden/draft visibility rules
## S1:
POST /api/posts
(title, body required; Draft or Published),
GET /api/posts/mine
(with drafts, like and comment counts),
PATCH/DELETE /api/posts/:id
(author only)
## — BLG-01, BLG-03, BLG-04
## S1:
GET /api/posts
(published, not hidden, paginated,
## ?tag=
## ,
## ?q=
keyword in title,
tags or author name, ordered by likes + comments then newest) and
## GET
## /api/posts/:id
## — BLG-02, BLG-09
## S1: Comments:
POST /api/posts/:id/comments
(published posts only, 1–500 chars,
chronological),
PATCH/DELETE /api/comments/:id
## — BLG-05, BLG-07
## S1: Likes:
POST/DELETE /api/posts/:id/like
(once per user, unique index) — BLG-06
S2: Tags ≤ 5 × 30 chars, editable;
GET /api/tags/:tag/posts
## — BLG-08
## S2: Images:
POST /api/posts/:id/images
## ,
DELETE .../images/:imageId
(UploadsModule, ≤ 5) — BLG-10
## S2:
GET /api/authors/:id
(name, join date, published posts, public itineraries via
Sarah's service) — BLG-12
## S2:
POST /api/reports
(post, comment, review or itinerary; reason; once per item),
GET /api/admin/reports
## (open),
PATCH /api/admin/reports/:id
(dismiss / hide /
delete),
PATCH /api/admin/content/:type/:id/hide
## ,
## DELETE
## /api/admin/content/:type/:id
; hidden content visible only to its author and admins;
audit each action — GEN-09, GEN-10
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 15 of 27

## Joudy Hagar
S0: Idempotent seed of the mock data (8 countries, 8 cities, 8 airports, 8 attractions)
using dataset keys as
## _id
, the currency list (EGP, AED, GBP, USD, EUR, JPY, SAR), and
demo airlines, flights and hotels for the team — GEN-12 — target merge 5 Nov
## S1:
GET /api/airports
(read-only; flight creation and search accept only these
airports), plus
GET /api/countries
and
## /api/cities
for Sarah and Sandra — FLT-02
## S1:
POST /api/airlines
## (admin),
GET /api/airlines/:id
## ,
## PATCH
## /api/airlines/:id
(own moderator: name, code, logo) — FLT-01
## S1:
PUT /api/airlines/:id/baggage-policy
(price per extra bag > 0, max extra bags
≥ 0; each extra bag has the cabin's free-bag max weight) and
## PUT
## /api/airlines/:id/cancellation-policy
(tiers with unique thresholds, 0–100%) —
## FLT-08, FLT-09
## S1:
POST /api/flights
(local times → UTC; rejects same airports, arrival not after
departure, past departure, duplicate number on the same date),
## GET
## /api/flights/:id
(local times, duration, cabins with seats remaining, baggage, tiers)
## — FLT-03, FLT-17, GEN-06
## S1:
POST /api/flights/:id/cabins
## ,
PATCH /api/flights/:id/cabins/:cabinId
(fixed classes, once each, seats > 0, price > 0, free bags, max kg) — FLT-04
## S1:
GET /api/flights/search
(from, to, local departure date, passengers by type,
optional cabin, optional return date, min/max price with error if min > max, sort by price
/ duration / departure; only Scheduled flights of active airlines with enough seats) —
## FLT-11, FLT-12, FLT-15
## S2:
PATCH /api/flights/:id
(Scheduled only; airports locked after any booking;
seats ≥ booked + held; price changes never alter existing bookings; time change
notifies Confirmed passengers) — FLT-05
## S2:
POST /api/flights/:id/cancel
(flight Cancelled and hidden from search; Karim
cancels its Confirmed bookings at 100% refund and releases holds; notifications) —
## FLT-06
S2: Flight status job (Departed once departure has passed) — FLT-30
## S2:
GET /api/flights/:id/bookings
(reference, passenger names, cabin, seats,
status, seats remaining) and
GET /api/flights/:id/passengers/export
## (CSV) —
## FLT-29
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 16 of 27

## Karim
S0: Lifecycle doc (GEN-11) +
FlightBooking
## ,
HotelReservation
## ,
## Notification
schemas
## S1:
NotificationsModule
## :
notify()
## ,
GET /api/notifications
(with unread count),
PATCH /api/notifications/:id/read
## ,
PATCH /api/notifications/read-all
## —
## GEN-01
## S1:
POST /api/flight-bookings
validates passengers and baggage and returns a
priced summary without holding anything — FLT-19, FLT-21
## S1:
POST /api/flight-bookings
/hold (segments, passengers with name, DOB,
document; type validated from DOB: adult 12+, child 2–11, infant < 2 at 10% fare and no
seat; ≥ 1 adult; infants ≤ adults; extra bags up to the airline max) → atomically holds
seats on every segment, status Pending Payment,
holdExpiresAt = now + 10 min
## —
## FLT-19, FLT-22, FLT-12
## S1:
GET /api/flight-bookings/:id
shows the held booking (flight, passengers,
baggage, total, hold expiry) on the way to payment — FLT-21
S1: Lifecycle jobs: expire unpaid bookings and release inventory (calls Ahmed to cancel
the PaymentIntent); mark Completed after departure or check-out — GEN-11
## S2:
markConfirmed
: held → booked, unique reference, notification;
GET /api/flight-
bookings/:id/e-ticket
(PDF, e.g. pdfkit) — FLT-23
## S2:
GET /api/flight-bookings?group=upcoming|past|cancelled
## — FLT-25
## S2:
GET /api/flight-bookings/:id/refund-quote
## +
POST .../:id/cancel
(Confirmed, before departure, round trip uses the outbound tier; seats back to
inventory; refund) — FLT-26
## S2:
POST /api/hotel-bookings
(rooms in one hotel, same dates, adults and children
aged 0–17 per room, check-out after check-in and check-in not in the past, occupancy
check, ≥ 1 adult, total = nights × price per room) → transactional
room_nights
holds for
10 min, all or nothing — HTL-16, HTL-18
S2: Confirm (reference, notification);
GET /api/hotel-bookings?
group=upcoming|past|cancelled
## ,
GET /api/hotel-bookings/:id
## ;
GET /api/hotel-
bookings/:id/refund-quote
## +
POST /api/hotel-bookings/:id/cancel
## (whole
reservation, before check-in, tier applied to the full total) — HTL-17, HTL-20, HTL-21
## S2:
GET /api/admin/bookings
(both types; filter by type, status, date range) — ACC-
## 17
S2: Concurrency e2e tests: 20 parallel holds on a 5-seat cabin → exactly 5 succeed; 2
parallel overlapping multi-room requests → exactly 1 succeeds
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 17 of 27

## Sandra George
## Sarah Ibrahim
## S0:
## Hotel
## ,
## Room
## ,
RoomNight
## ,
## Review
schemas; availability model doc
## S1:
POST /api/hotels
## (admin),
PATCH /api/hotels/:id
(own moderator: name,
address, city, country, description, ≤ 5 photos, star class, amenities),
## GET
## /api/hotels/:id
(profile, check-in/out, tiers, rating, free rooms when dates are
passed) — HTL-01, HTL-02
## S1: Rooms:
POST /api/hotels/:id/rooms
(number unique in hotel, type, beds,
occupancy ≥ 1, price > 0),
PATCH .../rooms/:roomId
(beds, occupancy, price,
availability, active; deactivation rejected if it overlaps Confirmed or Pending Payment
reservations),
DELETE .../rooms/:roomId
(only if never reserved) — HTL-03, HTL-05,
## HTL-06
## S1:
POST/PATCH /api/hotels/:id/rooms/:roomId/availability
## (non-overlapping
bookable ranges; cannot remove dates with confirmed reservations) and blocked
ranges (rejected if they overlap Confirmed or Pending Payment) — HTL-04, HTL-05,
## HTL-06
## S1:
GET /api/hotels/:id/availability?from&to
(each room per date: Available /
Booked with reference / Blocked) — HTL-08
## S1:
PUT /api/hotels/:id/policies
(check-in/out times; tiers by days before check-
in) — HTL-09, HTL-10
## S2:
GET /api/hotels/search
(city or country, check-in not past, check-out after
check-in, guests, rooms default 1; active hotels with enough free rooms for the whole
stay whose combined occupancy covers the guests; min/max price of the cheapest
qualifying room; min rating excludes unrated; sort by price or rating) — HTL-11, HTL-12
## S2:
GET /api/hotels/:id/rooms/available
(type, beds, occupancy, nightly and total
price) — HTL-15
## S2:
GET /api/hotels/:id/reservations
(own moderator) — HTL-22
## S2: Reviews:
POST /api/hotel-bookings/:id/review
(Completed, one per
reservation, rating 1–5, text ≤ 1000),
PATCH/DELETE /api/reviews/:id
## ,
## GET
## /api/hotels/:id/reviews
(newest first, paginated, average + count kept current) —
## HTL-23, HTL-24
## S0:
## Itinerary
(embedded days) and
## Activity
schemas; date-derivation, grouping
and move rules written up
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 18 of 27

Cross-module contracts and dependencies
Parallel work only holds together if the interfaces between domains are agreed before the
code. These ten contracts are written as TypeScript interfaces in
backend/src/common/contracts/
during Sprint 0 and merged first. Anyone can code
against a contract with a stub while the real implementation is still in progress.
## S1:
POST /api/itineraries
(title ≤ 100, ≥ 1 country from the list, start date; private by
default),
GET /api/itineraries
(mine, most recently updated first),
GET/PATCH/DELETE /api/itineraries/:id
(owner only; delete leaves other users'
clones untouched) — ITN-01, ITN-03
## S1: Days:
POST /api/itineraries/:id/days
(city required, notes; ≤ 60 days),
## PATCH
/api/itineraries/:id/days/:dayId
## ,
DELETE /api/itineraries/:id/days/:dayId
## ,
PATCH /api/itineraries/:id/days/reorder
(full ordered list of day ids); responses
always return number, derived date and city group — ITN-05, ITN-07, ITN-08, ITN-09
## S1: Activities:
POST .../days/:dayId/activities
(name, description, optional time,
optional cost + currency),
PATCH/DELETE /api/activities/:id
## — ITN-10
S2: Activity images:
POST /api/activities/:id/images
## ,
DELETE .../images/:imageId
## — ITN-12
## S2:
PATCH /api/itineraries/:id
visibility Public / Private (private removes it from
search immediately) — ITN-20
## S2:
GET /api/itineraries/public/search
(keyword in title, country or city; min/max
days; country or city filter),
GET /api/itineraries/public/:id
(read-only with
author, days, activities, budget),
POST /api/itineraries/:id/clone
(private, credits
the author, independent deep copy of days, activities, budgets) — ITN-21
## S2:
GET /api/itineraries/:id/hotels?group=&guests=&rooms=
(check-in = group's
first day, check-out = day after its last day; reuses Sandra's search) — ITN-25
## S2:
GET /api/itineraries/:id/flights?origin&tripType
(to any airport in the first
day's city; outbound = start date, return = last day's date; reuses Joudy's search) —
## ITN-26
#ContractProvider →
consumers
Shape (agreed in S0)Needed
by
1Auth decorators &
guards
## Abdelrahman →
everyone
@Public()
## ,
@Roles(...)
## ,
@CurrentUser()
returning
{ id, role,
assignedProvider }
## Stub 4
Nov, real
## 6 Nov
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 19 of 27

#ContractProvider →
consumers
Shape (agreed in S0)Needed
by
2Reference dataJoudy → Sandra,
## Sarah, Karim,
## Abdelrahman
Dataset keys as ids (
cairo
## ,
## CAI
## ,
## EG
## );
ReferenceService.cityExists()
## ,
airportsInCity()
## ,
supportedCurrencies()
## 5 Nov
## 3
PayableBooking
## Karim → Ahmed
getPayable(type, id) → { userId,
totalMinor, status, holdExpiresAt,
policiesAcceptedAt }
## ;
markConfirmed(type, id, paymentId)
## ;
markPaymentFailed(type, id)
## (stays
Pending Payment so the user can retry until
expiry)
## 12 Nov
4RefundsAhmed → Karim,
## Joudy
RefundsService.quote(policySnapshot,
daysRemaining, totalMinor)
and
refundFor(type, id, reason: 'USER' |
## 'PROVIDER')
(provider = 100%; nothing
issued when the amount is 0)
## 14 Nov
5PoliciesJoudy, Sandra →
## Ahmed, Karim
getPolicies(providerId)
→ airline
## {
tiers, extraBaggage, cabins' free
baggage }
, hotel
{ tiers, checkInTime,
checkOutTime }
## 10 Nov
6Search servicesJoudy, Sandra →
## Sarah
FlightsService.search(dto)
## ,
HotelsService.search(dto)
exported,
same DTOs as the public endpoints
## 12 Nov
7CurrencyAhmed →
## Abdelrahman
CurrencyService.convert(amountMinor,
from, to) → { amountMinor, rate,
rateDate }
; uses the last cached rates if
the API is down;
BadRequest
for an
unsupported code
## 10 Nov
8Audit,
notifications,
uploads
## Ahmed, Karim →
everyone
audit.record({ actorId, action,
targetType, targetId, metadata })
## ;
notify(userId, { type, title, body,
link })
## ;
uploads.saveImages(files, {
max })
## 8 Nov
9Provider active
flag
## Abdelrahman →
## Joudy, Sandra,
## Karim
airline.active
## /
hotel.active
## ;
searches and new bookings exclude
inactive providers; existing Confirmed
bookings are untouched
## 12 Nov
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 20 of 27

Payment and booking flow (the most coupled path)
- User searches (Joudy / Sandra), then
POST /api/flight-bookings
returns a priced
summary (Karim).
- Proceeding to payment:
POST /api/flight-bookings/hold
or
POST /api/hotel-
bookings
(Karim) reserves inventory atomically and creates the booking as Pending
Payment with
holdExpiresAt = now + 10 min
## .
## 3.
GET .../policies
, then
POST .../accept-policies
(Ahmed): tiers and baggage / check-
in rules snapshotted, acceptance timestamp stored. Payment is blocked until this is
done.
## 4.
POST /api/payments
(Ahmed) creates the PaymentIntent in the platform currency
and returns its
clientSecret
. In M2 the card goes into Stripe Elements; in the M1
Swagger demo we confirm it with the Stripe CLI or the Dashboard using a test card.
- Stripe calls
POST /api/payments/webhook
## . On
payment_intent.succeeded
## (signature
verified) →
markConfirmed
(Karim): held → booked, unique reference, notification, e-
ticket available. On failure the user may retry until the hold ends.
- If 10 minutes pass first, Karim's job sets the booking Expired, releases the seats or
room nights, and Ahmed cancels the PaymentIntent.
- Cancel (Karim): refund quote from the snapshot tiers → confirm → Cancelled,
inventory released →
refundFor
(Ahmed) → Stripe refund, status Pending → Refunded
/ Failed, notification.
- After departure or check-out the job marks the booking Completed, which unlocks
hotel reviews.
Critical path
Ahmed's scaffold (3 Nov) → Abdelrahman's guards (6 Nov) and Joudy's seed data (5 Nov)
→ Joudy's flights and Sandra's rooms (11 Nov) → Karim's holds and bookings (14 Nov, flight
holds by 11 Nov) → Ahmed's payments and refunds (16 Nov). Any slip on this chain is raised
#ContractProvider →
consumers
Shape (agreed in S0)Needed
by
10Content visibilityMalak → Sandra,
## Sarah,
## Abdelrahman
hidden
flag on posts, comments, reviews,
itineraries; shared
VisibilityFilter
(visible to author + admins only); author
display falls back to "Deleted user"
## 12 Nov
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 21 of 27

in stand-up the same day, and Ahmed reassigns help from a member who is ahead (Malak
and Sarah have the most self-contained domains).
Timeline to 20 November
Features are frozen on the evening of Tue 17 Nov, leaving two full days for bug fixing,
documentation and a rehearsed Swagger demo before the Fri 20 Nov deadline.
Daily rhythm: stand-up message by 10:00, PRs opened by evening, Ahmed reviews and
merges within 24 hours, and everyone rebases on
develop
each morning.
WindowDatesGoalExit gate (checked at
sprint review)
## Sprint 0:
## Foundation
## Mon 2 –
## Wed 4 Nov
Scaffold, Atlas, conventions,
contracts, schemas, issues
App boots against Atlas
for all 7; Swagger at
## /api/docs
; contracts
merged; every
requirement ID has an
issue and an owner
## Sprint 1: Core
domain
## Thu 5 –
## Wed 11
## Nov
Auth, catalogs (airlines,
flights, hotels, rooms),
search, itinerary + blog
CRUD, shared services
Login works in Swagger;
guards on every route;
seed data loaded;
searches return data;
holds work for flights
## Sprint 2:
Business logic
## Thu 12 –
## Tue 17 Nov
Bookings, payments, refunds,
cancellations and cascades,
budgets + FX, clone,
moderation, reviews
An end-to-end booking →
payment → cancel →
refund passes in Swagger
for flights and hotels;
concurrency test green
HardeningWed 18 –
## Thu 19 Nov
Bug bash (each member tests
a neighbour's module in
Swagger), README,
AI_PROMPTS.txt, docs/api
Zero open P1 bugs;
README setup verified on
a clean clone
ReleaseFri 20 NovMerge
develop
## →
main
, tag
v1.0.0-m1
, submit
Tagged release builds and
runs from the README
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 22 of 27

Git workflow, Definition of Done, documentation
We follow the brief's Gitflow variant exactly:
main
holds releases only,
develop
is the
integration branch, and every change arrives through a reviewed PR from a short-lived
branch.
## Rules
## Branches:
feature/<ID>-<slug>
## (e.g.
feature/FLT-22-seat-hold
## ),
fix/<ID>-
## <slug>
## ,
refactor/<slug>
## ,
docs/<slug>
; always cut from the latest
develop
## .
Keep PRs small: one requirement ID or one tightly related group, aiming for under
about 400 changed lines. Big PRs get slow reviews and cause conflicts.
Commits: Conventional Commits with the ID, e.g.
feat(flights): add round-trip
search [FLT-11]
## . Never
update
## ,
fix
or
final
## .
Branch protection: no direct pushes to
main
or
develop
; 1 approval required (Ahmed,
with the peer reviewer as second reader); squash merge; delete the branch after
merging.
Before opening a PR:
git pull --rebase origin develop
, then
npm run lint &&
npm test && npm run build
passing locally.
## Secrets:
## .env
is gitignored from the first commit;
## .env.example
lists
## MONGODB_URI
## ,
## JWT_SECRET
## ,
## JWT_ACCESS_TTL, JWT_REFRESH_TTL, SESSION_IDLE_MINUTES,
## PLATFORM_CURRENCY
## ,
## COOKIE_SECURE
## ,
## STRIPE_SECRET_KEY
## ,
## STRIPE_WEBHOOK_SECRET
## ,
## FX_API_KEY
## ,
## FX_API_BASE_URL
## ,
## UPLOAD_DIR
## ,
## ADMIN_SEED_EMAIL
## ,
## ADMIN_SEED_PASSWORD
## .
Merge conflicts: the PR author resolves them; Ahmed checks that the resolution
removed no one else's code (brief 10.7).
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 23 of 27

PR template (
## .github/pull_request_template.md
## )
## Requirement IDs
## FLT-22
## What changed
## -
## How to test in Swagger
- Log in as ...
## 2. Call ...
## ## Checklist
- [ ] DTOs validated, Swagger summary includes the ID, error responses
documented
- [ ] Ownership / role checks in the service
- [ ] Tests added or updated
- [ ] No secrets, no .env
- [ ] AI_PROMPTS.txt updated if AI materially helped
Definition of Done (per requirement)
- Endpoint implemented with DTO validation, correct HTTP status codes and the shared
error shape.
- Authorization enforced on the server: role, ownership or provider scope.
- Swagger: tagged,
## [ID]
in the summary, request and response examples,
400/401/403/404/409 documented.
- At least one unit or e2e test for the business rule (concurrency tests are mandatory for
holds and hotel bookings).
- Demoed in Swagger by the author during review; PR approved and merged to
develop
## .
- Traceability row updated and AI_PROMPTS.txt entry added where applicable.
Documentation deliverables (owner in brackets)
README.md
: prerequisites, clone,
## .env
setup,
npm run seed
## ,
npm run start:dev
## ,
Swagger URL, test accounts per role, Stripe CLI webhook forwarding (
stripe listen
--forward-to localhost:3000/api/payments/webhook
) [Ahmed]
docs/architecture/
: ERD, module map, ADRs for auth, concurrency, payments,
money/time [each owner writes their ADR; Ahmed edits]
docs/requirements/traceability.md
: ID → endpoint → owner → PR → status [each
owner keeps their rows]
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 24 of 27

docs/api/
: exported
openapi.json
+ a Swagger demo script listing the call order per
role [Karim + Ahmed]
AI_PROMPTS.txt
: in the brief's format; every member logs their own prompts as they
go, not at the end [everyone]
Risks and open questions
RiskLikelihoodImpactMitigation
Auth guards land
late and block
everyone
MediumHighStub decorators and guard on 4 Nov;
Abdelrahman builds guards before profile
endpoints
Overselling under
concurrent
requests
MediumHighAtomic conditional updates + unique
(roomId, date)
index; mandatory
parallel-request e2e tests
## Webhook-only
confirmation is hard
to demo on
localhost
HighHigh
stripe listen --forward-to
localhost:3000/api/payments/webhook
in the README; rehearse the full pay flow
with the Stripe CLI before 18 Nov
Evaluation uses a
bigger dataset than
the 8-row mock
MediumHighSeed reads the CSV files at runtime (never
hard-coded rows), upserts by dataset key,
and is safe to run twice
FXRatesAPI
unavailable during
the demo
MediumLowDaily cache in Mongo; the last cached
rates are used, with the rate date shown
## (ITN-18)
"Days remaining"
and "date has
passed" computed
in the wrong time
zone
MediumMediumUse the departure airport's zone for flights
and the hotel city's zone (taken from that
city's airport) for hotels; unit-test the tier
boundaries
Schema changes
break other
people's code
MediumMediumSchemas reviewed in S0; later changes go
through a PR that tags the affected
owners
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 25 of 27

Open questions to settle in Sprint 0
Settled by the workbook: hold 10 min, lockout 5 attempts / 15 min, 30-min idle session
expiry, password rules, review eligibility (Completed reservation, one per reservation),
tier selection rule, reportable types (post, comment, review, itinerary), page size 10,
upload limits, single platform currency, and the reference datasets. Still to settle:
## Sources
NestJS docs: Task scheduling
NestJS docs: OpenAPI security (cookie auth)
Stripe docs: Testing (test PaymentMethods such as pm_card_visa, refunds)
Integrating Stripe PaymentIntent in NestJS with webhook handling (rawBody)
MongoDB inventory reservation with atomic updates
Transactions with Mongoose (replica set requirement, session per operation)
NestJS guards for authorization (global guard, roles)
FXRatesAPI overview: endpoints and api_key / Bearer auth
RiskLikelihoodImpactMitigation
## Uneven
contribution in Git
history
MediumHigh
## (graded)
Everyone commits from day 1 on their own
branches; the stand-up flags anyone
without a PR for 2 days
Pick the platform currency (PAY-04); USD is the safe choice for Stripe test mode
Ask the TAs whether confirming a PaymentIntent with the Stripe CLI is acceptable in
the Swagger evaluation, or whether a dev-only "test confirm" endpoint (disabled in
production) is preferred
Confirm the extra endpoints we add beyond the brief's table are fine:
## POST
## /api/auth/refresh
## ,
## /api/admin/providers/:type/:id/deactivate|reactivate
## ,
## /api/notifications
## ,
## /api/currencies
## ,
## /api/reports
## ,
## /api/admin/content/:type/:id/hide
, the refund-quote endpoints
The brief cites ACC-03 and BLG-11, which do not exist in the workbook; HTL-09 has no
endpoint in the brief and is served by
PUT /api/hotels/:id/policies
. Map them in
the traceability file
Should the activity cost (ITN-10) carry its own currency? We assume yes, so ITN-18
conversion stays consistent
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 26 of 27

Gitflow for teams: develop, feature branches, PRs
## Travel Platform — Milestone 1 Engineering Plan & Team Workflow
Page 27 of 27