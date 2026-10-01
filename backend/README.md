# Navora Backend

REST API for the City Explore & Travel Planning Platform.
Node.js (ESM) · Express 5 · PostgreSQL + PostGIS · Knex · pino · zod · Vitest.

## Requirements

- Node.js 22.12+ (developed on 24)
- PostgreSQL 15+ **with the PostGIS extension available** (`docker compose up -d` provides one)

## Setup

```bash
npm install
cp .env.example .env          # adjust values; never commit .env
docker compose up -d          # PostgreSQL 17 + PostGIS on localhost:5433
npm run migrate:latest
npm run seed                  # categories and interest tags
npm run dev                   # http://localhost:3000
```

Without Docker: install PostGIS for your PostgreSQL (Windows: Application Stack Builder →
Spatial Extensions), create a database, and set `DATABASE_URL`. The database user needs
permission to `CREATE EXTENSION` for the first migration (or create `postgis`, `pg_trgm`
and `citext` beforehand as a superuser).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start with auto-restart on file changes |
| `npm start` | Start (production) |
| `npm test` | Run all tests |
| `npm run migrate:latest` / `migrate:rollback` / `migrate:status` | Database migrations |
| `npm run seed` | Load reference data (idempotent) |

Run migrations as a **separate deploy step**, never on application start, so multiple
instances do not race each other.

## Tests

```bash
npm test
```

Unit and API tests need no database. Schema tests in `tests/integration/` run only when
`TEST_DATABASE_URL` points at a **disposable** PostGIS database (they wipe it):

```bash
TEST_DATABASE_URL=postgres://navora:navora_dev_password@localhost:5433/navora_test npm test
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | Liveness: process is up (no dependency checks) |
| GET | `/ready` | – | Readiness: database reachable and instance not shutting down; 503 otherwise |
| GET | `/api/v1` | – | API version info |
| POST | `/api/v1/auth/register` | – | `{ name, email, password }` → 201 `{ user, tokens }` |
| POST | `/api/v1/auth/login` | – | `{ email, password }` → `{ user, tokens }` |
| POST | `/api/v1/auth/refresh` | – | `{ refreshToken }` → new `{ user, tokens }`; the old refresh token stops working |
| POST | `/api/v1/auth/logout` | – | `{ refreshToken }` → revokes that login session |
| GET | `/api/v1/auth/me` | Bearer | Current user |
| GET | `/api/v1/categories` | – | Category slugs and names |
| GET | `/api/v1/places` | – | Approved places, newest first. Filters below |
| GET | `/api/v1/places/nearby` | – | `latitude`, `longitude`, `radiusKm` (≤ 50, default 5); closest first, with `distanceMeters` |
| GET | `/api/v1/places/search` | – | `q` (full-text + typo-tolerant name match); best match first |
| GET | `/api/v1/places/:id` | optional | Approved: anyone. Pending/rejected/archived: submitter and moderators only (404 otherwise) |
| POST | `/api/v1/places` | Bearer | Submit a place → `PENDING` (moderators: `APPROVED`) |
| PATCH | `/api/v1/places/:id` | Bearer | Submitter: own `PENDING`/`REJECTED` (rejected → `PENDING`). Moderators: any |
| DELETE | `/api/v1/places/:id` | Bearer | Archives the place (same permissions as PATCH) |
| GET | `/api/v1/places/mine` | Bearer | My submissions, any status (`?status=` filter) |
| GET | `/api/v1/places/:id/moderation-events` | Bearer | Status history incl. rejection reasons (submitter, moderators) |
| GET | `/api/v1/places/moderation` | Moderator | Queue, oldest first (`?status=`, default `PENDING`) |
| POST | `/api/v1/places/:id/approve` | Moderator | `{ note? }` — PENDING → APPROVED |
| POST | `/api/v1/places/:id/reject` | Moderator | `{ reason }` — PENDING → REJECTED (submitter can then edit → PENDING) |
| GET | `/api/v1/places/:id/reviews` | – | Reviews, newest first, paginated |
| POST | `/api/v1/places/:id/reviews` | Bearer | `{ rating: 1–5 integer, comment? }`; one per user per approved place |
| PATCH | `/api/v1/reviews/:id` | Bearer | Author only |
| DELETE | `/api/v1/reviews/:id` | Bearer | Author, or a moderator |

A place's `rating: { average, count }` is maintained by a database trigger on every review
change, so reading or filtering by it needs no extra query.

### Caching

Upstash Redis, cache-aside (`src/integrations/redis/cache.js`); PostgreSQL stays the source
of truth and every entry has a TTL (`src/config/cache.js`). Cached: approved place details
(5 min) and place list / nearby / search results (2 min). Never cached: non-approved places,
"my submissions", moderation data, anything per-user. Keys are a stable hash of the
validated query (parameter order, category order and search-text case do not matter);
nearby coordinates are rounded to ~110 m for both the key and the query. Any write that
changes public place data — place create/update/archive/approve/reject and review
create/update/delete — invalidates all place entries by bumping a namespace version. If
Redis is unreachable, requests are served from PostgreSQL.

Place list endpoints accept `category` (comma-separated slugs), `maxEntryFee`, `minRating`,
`page`, `limit` (≤ 50) and return `meta: { page, limit, total, totalPages }`. Places whose
fee is unknown or that have no rating yet are excluded by `maxEntryFee` / `minRating`.
Place bodies use `location: { latitude, longitude }` and `category: "<slug>"`.

### Authentication

- Send `Authorization: Bearer <accessToken>`. Access tokens are JWTs valid for 15 minutes.
- When a request returns `401 TOKEN_EXPIRED`, call `/auth/refresh` with the refresh token
  and retry. Each refresh token works **once**; always store the newly returned one.
- Replaying an already-used refresh token is treated as theft and ends that whole session.
- Logout revokes the session's refresh tokens. The current access token keeps working
  until it expires (≤ 15 min); the client should discard it immediately.
### Rate limiting

Redis-backed (Upstash), so limits hold across all instances. Policies live in
`src/config/rateLimits.js`. API responses carry `RateLimit-Limit`, `RateLimit-Remaining`
and `RateLimit-Reset` (seconds); a blocked request gets `429 RATE_LIMITED` with `Retry-After`.

| Policy | Applies to | Limit | Redis down |
|---|---|---|---|
| `general` | all `/api/v1`, per user (valid token) or IP | 600 / 15 min | allow |
| `authIp` | login, register, per IP | 100 / 15 min | 503 `RATE_LIMIT_UNAVAILABLE` |
| `authAccount` | login, register, per IP + email | 10 / 15 min | 503 `RATE_LIMIT_UNAVAILABLE` |
| `submissions` | `POST /places`, per user | 20 / day | allow |
| `reviews` | `POST /places/:id/reviews`, per user | 30 / day | allow |
| `recommendations` | recommendation endpoint (when built), per user or IP | 20 / min | allow |
| `routing` | itinerary generation / route optimization (when built), per user | 10 / min | 503 `RATE_LIMIT_UNAVAILABLE` |

- Auth error codes: `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`,
  `INVALID_REFRESH_TOKEN`, `EMAIL_ALREADY_REGISTERED` (409), `FORBIDDEN` (403).

Every response carries an `X-Request-Id` header. Responses use a standard envelope:

```json
{ "success": true, "data": {}, "meta": {} }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [], "requestId": "…" } }
```

## Structure

```text
src/
├── config/       env.js (validated config), database.js (Knex)
├── middleware/   request context, HTTP logging, security/CORS, validation, 404, errors
├── modules/      one folder per feature: routes → controller → service → repository
├── routes/       v1.js mounts module routers under /api/v1
├── shared/       errors, logger, response helpers, common validation schemas
├── app.js        createApp(deps): builds the Express app (no listen; used by tests)
├── server.js     composition root: real dependencies, listen, signal handling
└── shutdown.js   graceful shutdown sequence
migrations/       Knex migrations (ESM), raw SQL for PostGIS/enums/triggers
seeds/            reference data
tests/            unit/, api/, integration/
```

## Running behind a load balancer

The app keeps no per-user state in memory, so any number of instances can run behind a
load balancer without sticky sessions.

- Set `TRUST_PROXY` to the number of proxy hops so `req.ip` is the real client.
- Point the load balancer's health check at `/ready`.
- On `SIGTERM` the instance reports not-ready, waits `SHUTDOWN_DRAIN_MS`, finishes
  in-flight requests, closes the database pool, then exits.
- Keep `HTTP_KEEP_ALIVE_TIMEOUT_MS` above the load balancer's idle timeout.
- Keep `instances × DB_POOL_MAX` below PostgreSQL's `max_connections`.
