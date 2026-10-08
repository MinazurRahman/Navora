# CLAUDE.md — Navora engineering instructions

Permanent instructions for Claude Code sessions in this repository. The code is the source
of truth: if this file and the code disagree, trust the code, then fix this file.
Human-facing docs: [backend/README.md](backend/README.md), [CONTRIBUTING.md](CONTRIBUTING.md),
API contract [backend/docs/openapi.yaml](backend/docs/openapi.yaml).

## 1. Project purpose

Navora is a City Explore & Travel Planning Platform. The backend (`backend/`) is a REST API
for: places (community-submitted, moderated), reviews, rule-based recommendations, saved
trips, feasibility-checked multi-day itineraries, and route optimisation. Default timezone
for "today" and opening hours: `Asia/Dhaka`; default currency `BDT`.

## 2. Stack

Node.js (ESM, `"type": "module"`) · Express 5 · PostgreSQL + PostGIS via Knex (`pg`) ·
Upstash Redis (REST client) + `@upstash/ratelimit` · zod 4 · pino / pino-http · helmet · cors ·
jsonwebtoken (HS256) · argon2 (argon2id) · Vitest + supertest · ajv + swagger-parser (contract tests).
Optional routing provider: OpenRouteService (`fetch`, no SDK).

## 3. Node.js version

`engines.node >= 22.12` (CI runs Node 22, the oldest supported; developed on 24). Uses
`process.loadEnvFile()`, `AbortSignal.timeout`, global `fetch` — no `dotenv`, no `node-fetch`.

## 4. Architecture

- **Modular monolith**, manual dependency injection with factory functions (`createXModule`,
  `createXService`, `createXRepository`). No DI container, no classes except errors.
- **Composition root**: `backend/src/server.js` builds real dependencies (db, redis, cache,
  rate limiter, map service, AI service) and calls `createApp(deps)`.
- `backend/src/app.js` `createApp({ config, lifecycle, repositories, rateLimiter, cache, mapService, aiService })`
  wires modules and middleware **without listening** — tests build it with fakes.
- `backend/src/repositories.js` is the **only** code that receives the Knex instance.
- **Stateless**: no shared per-user state in process memory; the app runs as N instances
  behind a load balancer. Shared state lives in PostgreSQL or Redis.
- Graceful shutdown in `src/shutdown.js`; `/health` (liveness) and `/ready` (readiness).

## 5. Module structure

```text
backend/src/
├── config/        env.js (validated env), database, redis, cache TTLs, rateLimits,
│                  planning.js, recommendation.js (tunable rules)
├── middleware/    requestContext, httpLogger, security (helmet/CORS), auth, rateLimit,
│                  validate, notFound, error
├── modules/<name>/ index.js (router + zod schemas, exports createXModule),
│                  [<name>.controller.js], <name>.service.js, <name>.repository.js,
│                  [<name>.schemas.js], [<name>.mapper.js], pure helpers
├── integrations/  redis/ (cache, rateLimiter), maps/ (mapService, providers/, errors)
├── routes/v1.js   mounts module routers under /api/v1
├── shared/        errors/AppError.js, logger, requestContext, http/response, auth/,
│                  validation/common.schemas.js, withTimeout, lifecycle
├── app.js, server.js, shutdown.js, repositories.js
backend/migrations/  backend/seeds/  backend/scripts/  backend/tests/  backend/docs/
```

Modules: health, auth, users, categories (+ tags), places, reviews, recommendations,
trips, itineraries, routing.

## 6. Request lifecycle (order in `app.js` matters)

1. `requestContextMiddleware` — request ID (`X-Request-Id`, reused only if safe), AsyncLocalStorage
2. `httpLoggerMiddleware` — pino-http; logs path only (no query strings)
3. `helmet` → CORS allow-list (`CORS_ORIGINS`) → `express.json({ limit })`
4. Health router (`/health`, `/ready`) — outside `/api/v1`, never rate limited or authenticated
5. `/api/v1` → `rateLimit('general')` → module router
6. Per route: `authenticate`/`optionalAuth`/`requireRole` → `rateLimit('<policy>')` → `validate({...})` → handler
7. Handler → service → repository / integration → `sendSuccess` / `sendCreated`
8. `notFoundMiddleware` → `errorMiddleware`

Response envelopes (`shared/http/response.js`, `middleware/error.middleware.js`):
`{ success: true, data, meta? }` and `{ success: false, error: { code, message, details?, requestId } }`.

## 7. Database architecture

- PostgreSQL 15+ with PostGIS; extensions `postgis`, `pg_trgm`, `citext`.
  Local: `docker compose up -d` in `backend/` (PostGIS 17, host port 5433).
- Tables: users, refresh_tokens, categories, tags, places, place_tags, place_opening_hours,
  place_moderation_events, reviews, trips, trip_interests, trip_preferred_categories,
  trip_selected_places, itineraries, itinerary_days, itinerary_stops.
- Locations are `geography` points; distance/radius/ordering is done in PostGIS, not JS.
- `places.avg_rating` / `review_count` are maintained by a DB trigger on review changes.
- Itineraries are **versioned**: one `is_current` per trip (partial unique index); each
  version stores a `generation_params` jsonb snapshot and `warnings` jsonb.
- DATE columns are parsed as plain `"YYYY-MM-DD"` strings (`config/database.js`).
- Statement timeout and pool size come from env. Multi-step writes use
  `repositories.transaction(work)`; repository methods take the `trx` as their last argument.

## 8. Migration rules

- Location `backend/migrations/`, name `YYYYMMDDHHMMSS_short_description.js`
  (enforced by `tests/unit/migrations.test.js`).
- **ESM**: `export async function up(knex)` / `export async function down(knex)` — both
  required. Do not use `knex migrate:make` (generates CommonJS); copy an existing migration.
- Raw SQL via `knex.raw` is the norm (PostGIS, enums, triggers, checks).
- **Never edit a migration that is on `main`** — add a new one.
- Every `down` must work; verify with `migrate:latest` → `migrate:rollback` → `migrate:latest`.
- Migrations run as a separate deploy step, never on app start.
- Do not create migrations or change the schema unless the task explicitly requires it.

## 9. Layer responsibilities

- **Router (`index.js` / `*.routes.js`)**: middleware chain + zod schemas only.
- **Controller / inline handler**: reads only `req.validated` and `req.user`, calls one
  service method, sends the envelope. No business logic, never raw `req.body` / `req.query`.
- **Service**: business rules, permission/ownership checks, transactions, cache invalidation,
  DTO mapping. Throws `AppError` subclasses.
- **Repository**: SQL only, parameterised (`?` bindings / Knex builder). Returns rows.
- **Cross-module**: modules call each other's **services**, never another module's
  repository. Pure helper modules (e.g. `recommendations/scoring.js`, `schedule.js`,
  `itineraries/planner.js`, `feasibility.js`, `routing/optimizer.js`) are imported directly.

## 10. Authentication rules

- Access token: HS256 JWT, algorithm pinned, issuer/audience checked, default 15 min.
  Verified locally (no DB/Redis) → `req.user = { id, role }`. Roles: `user`, `moderator`, `admin`.
- Refresh token: opaque 32 random bytes; only its SHA-256 hash is stored; single use,
  rotated on refresh; reuse of a used token revokes the whole family.
- `optionalAuth` still rejects an *invalid* token (never silently anonymous).
- `user_id` always comes from `req.user`, never from the request body.
- Other users' private resources answer **404, not 403** (trips, itineraries, non-approved places).
- Passwords: argon2id (OWASP params); unknown emails burn an equal-time hash check.
- Do not change auth code unless the task is explicitly about auth.

## 11. Validation rules

- Every input (params, query, body) is validated with zod via `validate({ params, query, body })`;
  parsed values land on `req.validated`.
- Reuse `shared/validation/common.schemas.js` (`idParamSchema`, `paginationQuerySchema`,
  `queryNumber`, coordinate schemas). Page ≤ 1000, limit ≤ 50.
- PATCH schemas have **no defaults** (a default would overwrite saved data).
- Cross-entity checks (slugs exist, places approved and visible) happen in services and
  throw `ValidationError` with `details: [{ location, path, message }]`.
- Environment is validated by the zod schema in `config/env.js`; the app refuses to start on bad config.

## 12. Error handling rules

- Throw classes from `shared/errors/AppError.js`: `ValidationError` (400), `UnauthorizedError`
  (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409),
  `UnprocessableError` (422), `RateLimitError` (429), `ServiceUnavailableError` (503).
- Every client error has a **stable machine-readable `code`** (clients branch on `code`, not
  `message`). New codes must be documented in `openapi.yaml`.
- Never expose stack traces, SQL or internal details. Unknown errors → 500 `INTERNAL_ERROR`.
- `error.middleware.js` translates known PostgreSQL codes (23505, 23503, 23514, 22P02, 57014).
- Express 5 forwards thrown/rejected errors from async handlers; no try/catch wrappers needed.
- Programming errors (e.g. an itinerary failing final validation) are plain `Error` → 500, logged.

## 13. Redis / cache rules

- Cache-aside in `integrations/redis/cache.js` (`get`, `set`, `del`, `getOrSet`, `bumpVersion`, `hashKey`).
- Redis is **never** the source of truth; every entry has a TTL (`config/cache.js`).
- Every cache call is timed out (500 ms); cache failures are logged and **never fail a request**.
- Cache **only public data** (approved places, lists, recommendations, real routing results).
  Never cache per-user/private data or estimated routing results.
- Keys: `hashKey` over **normalised** params (sorted arrays, rounded coordinates, lower-cased text).
- Any write changing public place data (place create/update/archive/moderate, review
  create/update/delete) must call `placesService.invalidateCache()` (bumps the `places`
  namespace) **after** the transaction commits. Recommendations live in that namespace.

## 14. Rate limiting rules

- All policies live in `config/rateLimits.js`: sliding window, `failOpen` per policy.
  `general` 600/15m (open) · `authIp` 100/15m (closed) · `authAccount` 10/15m per IP+email
  (closed) · `submissions` 20/day (open) · `reviews` 30/day (open) · `recommendations` 20/min
  (open) · `routing` 10/min (closed) · `assistant` 10/min (closed) · `assistantDaily` 100/day (closed) ·
  `assistantGlobal` 60/min, one bucket for all users (closed).
- Use `rateLimit('<policy>', identify?)`; default identity is the user (valid token) else IP.
- **Costly or paid-API endpoints must use a fail-closed policy** (503 `RATE_LIMIT_UNAVAILABLE`).
- Our own 1 s timeout is used; Upstash's built-in timeout is disabled on purpose (it fails open).
- Identifiers are SHA-256 hashed before being sent to Upstash.

## 15. Maps / routing rules

- All road data goes through `integrations/maps` `mapService` (`getDistanceMatrix`, `getRoute`,
  `getTravelTime`). Nothing else may know which provider is used.
- Providers: `estimate` (default, no external calls) and `openrouteservice` (`MAP_API_KEY`;
  car/walking/cycling only). Adding a provider = one adapter in `providers/` + one case in `index.js`.
- Every result carries `provider`, `estimated`, and `fallbackReason` when relevant.
  Provider failures (timeout, rate limit, outage, invalid route, missing data, unsupported
  mode) fall back to **flagged estimates**, or 503 `ROUTING_UNAVAILABLE` when
  `MAP_FALLBACK_TO_ESTIMATE=false`.
- Adapter rules: `AbortSignal.timeout`, one retry only for `UNAVAILABLE`, max 50 points per call.
- Never log coordinates: provider error text goes through `maskCoordinates`.
- Route ordering is a heuristic (nearest neighbour + 2-opt); `globallyOptimal` is always `false`.
  `POST /routing/optimize` never drops user-chosen places; infeasible days return `feasible: false`.

## 16. Recommendation engine rules

- Deterministic and rule-based: `modules/recommendations/scoring.js` (pure, unit-tested);
  weights and constants in `config/recommendation.js`.
- **Hard constraints first** (`HARD_CONSTRAINTS`): search radius; pet/parking/wheelchair only
  when explicitly `YES` (`NO` and `UNKNOWN` fail); `minimumRating` (unrated fails); closed for
  the whole trip when hours are known. Then **soft scoring**: interest, category, proximity,
  budget, Bayesian rating, popularity, schedule → score 0–100 with `breakdown`, `reasons`, `warnings`.
- **"Unknown is unknown"**: unknown fee/rating/hours score `unknownScore` and appear in
  `warnings`; never treated as positive.
- `reasons` state only facts present in the data.
- **Requirements are never relaxed automatically**; `meta.suggestions` names the limiting ones.
- Ranking is deterministic (score, then distance, then id). Results are cached in the places namespace.

## 17. Itinerary generation rules

- Flow (`itineraries.service.js#generate`): owned trip → context → selected places must be
  approved and pass hard constraints (radius excepted) → candidates (PostGIS) → hard
  constraints → `rankPlaces` → `planTrip` (allocation with fast estimates, config in
  `config/planning.js`, max 6 stops/day) → `refineDay` with `mapService` matrix (may drop the
  lowest-ranked **non-selected** stop, with `STOP_REMOVED_AFTER_ROUTING`) → polylines →
  empty day ⇒ 422 `INSUFFICIENT_MATCHING_PLACES` → `validateItinerary` → save new current version.
- `validation.js` is an **independent final check**; an itinerary that fails is **never saved**.
- Selected places are mandatory: include them or fail with 422 `SELECTED_PLACES_NOT_FEASIBLE`.
- Edits replace listed days; only the current version is editable (409 `ITINERARY_NOT_CURRENT`);
  places must meet the trip's requirements (422 `PLACE_VIOLATES_REQUIREMENTS`); infeasible days
  422 `ITINERARY_DAY_INFEASIBLE`; a failed edit changes nothing; the row is locked during save.
- Warnings use codes: `TRAVEL_TIMES_ESTIMATED`, `STOP_REMOVED_AFTER_ROUTING`,
  `START_DATE_ASSUMED`, `OPENING_HOURS_UNVERIFIED`, `ENTRY_FEE_UNKNOWN`.

## 18. Testing rules

- Run from `backend/`: `npm test` (Vitest, `fileParallelism: false`). CI
  (`.github/workflows/backend-ci.yml`) runs `npm ci`, `npm audit --omit=dev --audit-level=high`,
  `npm test` against a PostGIS service on every PR and push to `main`, with no secrets.
- `tests/unit` — pure logic, no DB. `tests/api` — HTTP via `buildTestApp()` with in-memory
  fakes (`tests/helpers/testApp.js`). `tests/integration` — real app on `TEST_DATABASE_URL`
  (wiped; must differ from `DATABASE_URL`), skipped when unset. `tests/contract` — OpenAPI.
- External services are always injectable and faked in tests (in-memory Redis/rate limiter,
  fake map provider via `createIntegrationApp({ mapProvider })`). Tests needing real external
  credentials must `skipIf` unconfigured (see `tests/integration/upstash.test.js`).
- New behaviour needs tests for business rules, permissions and error cases, not just the happy path.
- Tests must pass before a change is considered done.

## 19. OpenAPI contract rules

- `backend/docs/openapi.yaml` (OpenAPI 3.1) is the authoritative frontend contract.
- `tests/contract/openapi.contract.test.js` enforces: valid spec; examples match schemas;
  every operation has a summary, a 2xx, a 429 (under `/api/v1`) and a 401 if it requires auth;
  **route parity** both ways; live responses match schemas (undocumented fields fail).
- Adding/removing/changing an endpoint, field, status or error code ⇒ update the spec in the
  same change. A new router file must be added to `MOUNTS`, and the expected route count
  (`expect(inCode.size).toBe(...)`) updated.

## 20. Environment variable rules

- All settings come from env vars validated in `backend/src/config/env.js` and exposed as a
  frozen, nested config object. Add every new variable to `env.js` **and** `backend/.env.example`
  (name and safe default only, never a real value).
- `.env` is loaded only outside tests; tests get values from `vitest.config.js` / `buildTestConfig()`.
- Risky-but-valid production settings belong in `productionWarnings()`.
- Required now: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`. `MAP_API_KEY` required when `MAP_PROVIDER` ≠ `estimate`.

## 21. Security rules

- Never commit or print secrets; `.env`, `.env.*` (except `.env.example`), keys and certs are gitignored.
- Never log passwords, tokens, emails or users' locations. Use `getLogger()`; pino redacts
  auth headers and token/password fields.
- SQL is always parameterised; never interpolate user input into SQL.
- CORS is an explicit allow-list; tokens travel in `Authorization`, not cookies (`credentials: false`).
- Auth responses send `Cache-Control: no-store`.
- Community text (place names, descriptions, reviews) is untrusted user input.
- `npm audit` (prod deps, high) runs in CI; avoid adding dependencies without need.

## 22. Coding conventions

- ESM `import`/`export`, named exports, `.js` extensions in relative imports.
- 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.
- Factory functions returning plain objects; closures over injected dependencies.
- camelCase in JS/API, snake_case in SQL; mappers (`toPlaceDto`, `toTripDto`, …) convert rows to
  DTOs and pg numeric strings to numbers.
- Pure logic (scoring, planning, feasibility, optimisation) has no I/O and takes config as a parameter.
- Tunable numbers live in `config/*.js` as `Object.freeze` constants with explanatory comments.
- Comments explain **why** (constraints, trade-offs), not what. Match the existing density.
- No `console.log` in `src/` — use `getLogger()`.
- Express 5 async handlers throw; no manual error forwarding.
- No linter/formatter config is present; follow the surrounding code.

## 23. Adding a new module

1. Create `backend/src/modules/<name>/` following the layers above; `index.js` exports
   `create<Name>Module(deps)` returning `{ router, <name>Service? }` and re-exports its repository factory.
2. Register the repository in `src/repositories.js` (if it needs the DB).
3. Wire it in `src/app.js` (inject services, `authenticate`, `rateLimit`, `cache`, …) and mount
   it in `src/routes/v1.js`.
4. Validate every input with zod; choose or add a rate-limit policy in `config/rateLimits.js`.
5. Document all routes in `openapi.yaml`; add the router to `MOUNTS` and update the route count.
6. Add unit/API/integration tests; update `backend/README.md` endpoint tables.
7. Do not modify unrelated modules.

## 24. Adding a third-party integration

Follow the `integrations/maps` pattern:
- Lives in `backend/src/integrations/<name>/`; the rest of the app sees only a provider-neutral
  service interface. Provider-specific URLs/shapes stay in one adapter file in `providers/`.
- Created in `server.js` from config and **injected** into `createApp` so tests can pass fakes;
  `buildTestApp` / `createIntegrationApp` get a default fake.
- A no-external-call default provider so the app and CI run without keys.
- Every call has a timeout (`AbortSignal.timeout` / `withTimeout`), bounded retries (transient only),
  typed error kinds, and a defined failure policy (flagged fallback or 503 with a stable code).
- Credentials only via env vars; mask user data (coordinates, emails) in logs.
- Cache only non-personal, deterministic results, with a TTL.
- Paid or quota-limited calls sit behind a fail-closed rate-limit policy.

## 25. AI integration rules

The AI Trip Assistant (`POST /api/v1/ai/trip-assistant`, `GET /api/v1/ai/trip-assistant/status`)
is the reference implementation: provider abstraction in `src/integrations/ai/` (`disabled`
default, `ollama`), feature module in `src/modules/assistant/` (`context.js` builds the only data
the model sees, `taskContext.js` reduces it to what each task needs, `budget.js` fits it to the
model's window, `prompt.js` holds the system prompt, `output.js` grounds and bounds the reply,
`assistant.service.js` orchestrates). Partial data must be explicit in the context (e.g.
`itinerary.cost.totalIsComplete`: a sum of known fees is never presented as a total).
Every AI feature must follow these rules:

- **AI must never replace deterministic business logic without explicit approval.** Hard
  constraints, scoring, planning, feasibility, routing and validation stay rule-based.
- **AI must be isolated behind a service/provider abstraction** (`src/integrations/ai/` per
  §24, consumed by a dedicated module). No provider SDK calls from routers, controllers,
  repositories or existing modules.
- **AI-generated output is never authoritative business data.** It must not be written into
  place, trip or itinerary records as fact, must not satisfy a requirement, and must not
  invent facts (hours, fees, facilities, ratings). Treat it as untrusted input; label it as AI-generated.
- **Existing validation remains authoritative.** Anything derived from AI output (e.g. trip
  fields parsed from natural language) must pass the existing zod schemas and service checks
  before use.
- **Existing recommendation and itinerary algorithms remain authoritative.** AI may explain or
  summarise their output (grounded in the structured `reasons`, `warnings`, `breakdown`), not
  re-rank, re-order, drop or add results.
- **Secrets are never hardcoded**: keys/URLs/model names via `config/env.js` + `.env.example`.
- **AI requests must be validated**: zod-validated endpoint input; prompt size within the
  model's context window (`AI_CONTEXT_WINDOW_TOKENS`, sent as `num_ctx`; trim like
  `assistant/budget.js`, refuse when it cannot fit); only approved, public data in prompts unless
  explicitly approved; community text treated as untrusted (prompt-injection risk) and included
  only where the task needs it.
- **AI responses must be bounded and sanitised**: request timeout, max output tokens/length,
  response body size limit, schema-validated structured output where applicable; links, emails
  and phone numbers removed from AI text on a best-effort, heuristic basis (Navora data has none).
- **AI load must be bounded**: per-user and global fail-closed rate limits plus a per-instance
  concurrency cap (`AI_MAX_CONCURRENT`).
- **AI failures must degrade gracefully**: core features keep working without AI; failures are
  logged (without prompts containing personal data or locations) and surface as a flagged
  fallback or a 503 with a stable error code, never a 500.
- **AI functionality must be covered by tests**, using an injected fake provider; CI must pass
  with no AI credentials.
- **Do not introduce paid AI APIs unless explicitly requested.**
- **Prefer local/open-source AI resources** (e.g. a locally hosted open-weight model) with a
  no-op/disabled default provider.
- Use a dedicated **fail-closed** rate-limit policy for AI endpoints; do not put AI calls inside
  DB transactions or in the anonymous, fail-open `recommendations` path.
- Do not add AI fields to existing responses without updating the OpenAPI contract.
- **Do not modify unrelated modules.**

## Working rules for Claude sessions

- Inspect the code before recommending or changing anything; do not assume architecture.
- Keep changes minimal and scoped; do not refactor unrelated code.
- Do not change the schema, add migrations or install packages unless the task requires it.
- Never push to `main`; never commit or push unless asked. Branch names: `feature/…`,
  `fix/…`, `docs/…`, `chore/…`; imperative commit messages.
