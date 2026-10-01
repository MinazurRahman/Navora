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

### Authentication

- Send `Authorization: Bearer <accessToken>`. Access tokens are JWTs valid for 15 minutes.
- When a request returns `401 TOKEN_EXPIRED`, call `/auth/refresh` with the refresh token
  and retry. Each refresh token works **once**; always store the newly returned one.
- Replaying an already-used refresh token is treated as theft and ends that whole session.
- Logout revokes the session's refresh tokens. The current access token keeps working
  until it expires (≤ 15 min); the client should discard it immediately.
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
