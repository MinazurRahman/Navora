# Contributing to Navora

Welcome! This guide gets you from a fresh clone to your first merged pull request.
Backend details (architecture, endpoints, configuration) are in
[backend/README.md](backend/README.md). The API contract is
[backend/docs/openapi.yaml](backend/docs/openapi.yaml).

## Ground rules

1. **Never commit or share secrets.** No `.env` files, keys, tokens or passwords in Git,
   chat, email or screenshots. `.gitignore` already excludes `.env`; only `.env.example`
   (variable names, no values) is tracked. Everyone uses **their own** database, Upstash
   database and API keys.
2. **Never push to `main` directly.** All changes go through a pull request with at least
   one approving review.
3. **Tests must pass** before you open a pull request (`npm test`).
4. **Never edit a migration that is already on `main`.** Add a new one instead.
5. **Keep the API contract true.** If you add, remove or change an endpoint, update
   `backend/docs/openapi.yaml` in the same pull request — the contract tests fail until
   the spec and the code match.

If you think a secret was exposed (committed, pasted, screenshotted), tell the team
immediately so it can be rotated. Deleting the commit is not enough.

---

## Backend setup

### Prerequisites
- **Node.js 22.12+** (`node --version`)
- **PostgreSQL 15+ with the PostGIS extension**
  - Windows: install PostgreSQL, then *Application Stack Builder → Spatial Extensions → PostGIS*
  - or Docker: `docker compose up -d` in `backend/` (PostgreSQL + PostGIS on port 5433)
- A free **Upstash Redis** database (https://upstash.com): copy its *REST URL* and *REST token*
- Optional: a free **OpenRouteService** key (https://openrouteservice.org) for real road
  travel times. Without one, use `MAP_PROVIDER=estimate`.

### 1. Clone and install
```bash
git clone https://github.com/MinazurRahman/Navora.git
cd Navora/backend
npm ci
```
Use `npm ci` (not `npm install`): it installs exactly the versions in `package-lock.json`.

### 2. Create two databases
One for development and a **separate, disposable** one for tests (the tests wipe it):
```sql
CREATE DATABASE navora;
CREATE DATABASE navora_test;
```
The database user must be allowed to create extensions (`postgis`, `pg_trgm`, `citext`).
Locally, a superuser is simplest; never do that in production.

### 3. Create your `.env`
```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Fill in `.env`:

| Variable | Value |
|---|---|
| `JWT_SECRET` | the generated value above (your own, never shared) |
| `DATABASE_URL` | `postgres://USER:PASSWORD@localhost:PORT/navora` |
| `TEST_DATABASE_URL` | `postgres://USER:PASSWORD@localhost:PORT/navora_test` — must differ from `DATABASE_URL` |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from your Upstash console |
| `MAP_PROVIDER` / `MAP_API_KEY` | `estimate` (no key), or `openrouteservice` + your key |

Passwords containing `@ : / #` must be URL-encoded in the connection strings (`@` → `%40`).

### 4. Migrate, seed, test, run
```bash
npm run migrate:latest
npm run seed
npm test
npm run dev                     # http://localhost:3000/ready should say "ready"
```

### Useful scripts
| Script | Purpose |
|---|---|
| `npm run dev` | Start with auto-restart |
| `npm test` / `npm run test:watch` | Run tests once / on every change |
| `npm run migrate:latest` / `migrate:rollback` / `migrate:status` | Database migrations |
| `npm run seed` | Load categories and interest tags (safe to re-run) |

---

## Daily workflow

```bash
git checkout main
git pull
git checkout -b feature/review-photos        # one branch per task
# … work, commit …
npm test
git push -u origin feature/review-photos     # then open a pull request on GitHub
```

- **Branch names**: `feature/…`, `fix/…`, `docs/…`, `chore/…`
- **Commit messages**: imperative and specific — `Add photo upload to reviews`, not `changes`.
- **Pull requests**: small and focused. Describe *what* changed, *why*, and *how you tested it*.
- **Reviews**: review within a day if you can; ask questions rather than guessing.
- After merging, delete the branch and pull `main` before starting the next task.

### Pull request checklist
- [ ] `npm test` passes locally
- [ ] New behaviour has tests (business rules, permissions and error cases — not just the happy path)
- [ ] `backend/docs/openapi.yaml` updated if any endpoint, field, status code or error code changed
- [ ] New database changes are in a **new** migration file
- [ ] New settings are added to `src/config/env.js` **and** `.env.example` (name only, no real value)
- [ ] No secrets, personal data or `console.log` left in the code

---

## Backend conventions

The backend is a modular monolith (Node.js ESM, Express 5, PostgreSQL + PostGIS via Knex,
Upstash Redis). Please follow the existing patterns; look at a similar module before
writing a new one.

- **Layers**: `routes → controller → service → repository`.
  - Controllers only read `req.validated` / `req.user` and send the response.
  - Business rules and permission checks live in **services**.
  - SQL lives only in **repositories** (`src/repositories.js` wires them up).
  - Modules talk to each other through services, never through another module's repository.
- **Validation**: every input is validated with **zod** at the route (`validate({ body, query, params })`).
  Never read raw `req.body` / `req.query` in controllers.
- **Errors**: throw the classes in `src/shared/errors/AppError.js` with a stable `code`.
  Never send stack traces, SQL or internal details to clients.
- **SQL**: always parameterised (`?` bindings). Never build SQL from user input with template strings.
  Geographic work (distance, radius, ordering) stays in PostGIS, not in JavaScript.
- **Privacy & permissions**: other users' private resources answer **404**, not 403.
  `user_id` always comes from the verified token (`req.user`), never from the request body.
- **Unknown is unknown**: facility values are `YES` / `NO` / `UNKNOWN`. `UNKNOWN` never satisfies
  a requirement, and missing fees, ratings or opening hours are never treated as positive.
- **Configuration**: all settings come from environment variables validated in `src/config/env.js`.
  No hard-coded secrets, URLs or keys.
- **Stateless**: never keep shared state in process memory — the app runs as several instances.
  Shared state belongs in PostgreSQL or Redis.
- **Logging**: use `getLogger()` (it carries the request ID). Never log passwords, tokens,
  emails or users' locations.
- **Caching**: only public data, always with a TTL; any write that changes public place data
  must invalidate the cache (see `places.service.js`).

### Migrations
- Location: `backend/migrations/`, file name `YYYYMMDDHHMMSS_short_description.js`
  (a test enforces this format).
- Copy an existing migration as a template (they are ESM: `export async function up / down`);
  `knex migrate:make` generates the wrong (CommonJS) format.
- Every `up` needs a working `down`. Run `npm run migrate:latest`, then
  `npm run migrate:rollback` and `migrate:latest` again to check both directions.

### Tests
- `tests/unit` — pure logic (scoring, planning, validation…), no database.
- `tests/api` — HTTP behaviour with in-memory fakes.
- `tests/integration` — the real app against your `TEST_DATABASE_URL` (PostGIS).
- `tests/contract` — `docs/openapi.yaml` must match the code: every route documented,
  every response matching its schema.

---

## Frontend team

- **API contract**: [backend/docs/openapi.yaml](backend/docs/openapi.yaml). Open it at
  https://editor.swagger.io or with the *OpenAPI (Swagger) Editor* VS Code extension.
  Postman can import it; `openapi-typescript` can generate TypeScript types from it.
  Read its introduction first — it explains the rules that cause most integration bugs:
  - branch on the error `code`, not on `message`;
  - access tokens last 15 minutes; on `401 TOKEN_EXPIRED` call `POST /api/v1/auth/refresh`;
  - each refresh token works **once** — always store the new one, and share a single
    refresh call between browser tabs;
  - other users' private resources answer `404`, not `403`.
- **Running the backend locally**: follow *Backend setup* above (`MAP_PROVIDER=estimate`
  and your own free Upstash database are enough).
- **CORS**: your dev server's origin must be listed in the backend's `CORS_ORIGINS`
  (`http://localhost:5173` and `http://localhost:3000` are in `.env.example`).
- **Found a mismatch** between the contract and the real API? That is a backend bug —
  open an issue with the request, the response and its `X-Request-Id` header.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid environment configuration` at startup | A required variable in `.env` is missing or malformed; the message names it |
| `type "geography" does not exist` | PostGIS is not installed or the migrations have not run |
| `password authentication failed` | Check user and password in `DATABASE_URL` (URL-encode special characters) |
| Database tests are skipped | `TEST_DATABASE_URL` is not set in `.env` |
| `TEST_DATABASE_URL must not equal DATABASE_URL` | Use a separate test database — the tests wipe it |
| Browser shows a CORS error | Add your frontend origin to `CORS_ORIGINS` and restart the backend |
| `429 RATE_LIMITED` while developing | Wait for `Retry-After` seconds; limits are in `src/config/rateLimits.js` |
