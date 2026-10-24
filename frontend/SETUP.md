# Running Navora locally: backend + frontend

This guide takes you from a fresh machine to the Navora web app running in your browser,
talking to your own local backend. Follow the steps in order. Commands are shown for
macOS/Linux; where Windows (PowerShell) differs, it is shown underneath.

How the pieces fit:

```text
Browser ──► http://localhost:5173  (Vite dev server: the React app)
                │  every /api/... request is forwarded (proxied) to ──►
                ▼
            http://localhost:3000  (Navora backend: Express API)
                │
                ├──► PostgreSQL + PostGIS on localhost:5433 (Docker)
                └──► Upstash Redis (your free cloud database: rate limits + cache)
```

Because the dev server forwards `/api`, the browser only ever talks to one address, so
you do not run into CORS errors during development.

---

## 1. Install the tools (once)

| Tool | Why | Check it works |
|---|---|---|
| **Node.js 22.12 or newer** ([nodejs.org](https://nodejs.org), LTS) | Runs both the backend and the frontend tooling | `node --version` → `v22.12` or higher |
| **Git** | Gets the code | `git --version` |
| **Docker Desktop** ([docker.com](https://www.docker.com/products/docker-desktop/)) | Runs PostgreSQL + PostGIS without installing them | `docker --version`, and Docker Desktop is running |
| A free **Upstash** account ([upstash.com](https://upstash.com)) | The backend needs a Redis database for rate limiting and caching | You can log in |

Optional: a free [OpenRouteService](https://openrouteservice.org) key for real road travel
times. Without one, Navora uses distance-based estimates and says so in the itinerary.

## 2. Put the frontend into the repository

The backend repository has no frontend yet. Copy the `frontend/` folder from this delivery
next to `backend/`, so the repository looks like this:

```text
Navora/
├── backend/
├── frontend/      ← this folder
├── CONTRIBUTING.md
└── ...
```

Do this on a branch (the repository rules forbid pushing to `main`):

```bash
cd Navora
git checkout -b feature/frontend-skeleton
```

## 3. Start the backend

All commands in this section run inside `backend/`.

### 3.1 Install dependencies

```bash
cd backend
npm ci
```

### 3.2 Start the database

```bash
docker compose up -d
```

This starts PostgreSQL 17 with PostGIS on **port 5433**. Check it is healthy with
`docker compose ps` (status `healthy`).

### 3.3 Create an Upstash Redis database

1. Log in to [console.upstash.com](https://console.upstash.com) → **Create database** (Redis), any
   nearby region, free plan.
2. Open the database → **REST API** section → copy **UPSTASH_REDIS_REST_URL** and
   **UPSTASH_REDIS_REST_TOKEN**.

Everyone on the team uses their **own** Upstash database. Never share or commit the token.

### 3.4 Create your `.env`

```bash
cp .env.example .env
```
Windows: `Copy-Item .env.example .env`

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Open `backend/.env` and fill in:

| Variable | Value |
|---|---|
| `JWT_SECRET` | the value you just generated |
| `UPSTASH_REDIS_REST_URL` | from step 3.3 |
| `UPSTASH_REDIS_REST_TOKEN` | from step 3.3 |
| `DATABASE_URL` | leave the default: `postgres://navora:navora_dev_password@localhost:5433/navora` |
| `CORS_ORIGINS` | leave the default: it already includes `http://localhost:5173` |
| `MAP_PROVIDER` | `estimate` (or `openrouteservice` + `MAP_API_KEY`) |

### 3.5 Create the tables and load data

```bash
npm run migrate:latest   # creates tables (PostGIS, trigram search, …)
npm run seed             # 16 categories and 14 interests
npm run seed:demo        # ~44 well-known Dhaka places to explore
```

### 3.6 Run the API

```bash
npm run dev
```

Leave this terminal open. In a browser, open **http://localhost:3000/ready**. You should see
`"status":"ready"`. If not, see Troubleshooting at the end.

## 4. Start the frontend

Open a **second terminal**:

```bash
cd Navora/frontend
npm install        # first time only; creates package-lock.json (commit it)
npm run dev
```

Open **http://localhost:5173**. You should see “Find places worth the trip” and a list
of places near central Dhaka.

The frontend needs no `.env` for local development. To point the proxy at a backend on
another port, copy `.env.example` to `.env.local` and change `VITE_DEV_BACKEND_URL`.

## 5. Check that everything works (first-run checklist)

Do these in order. Each one exercises a different part of the backend.

1. **Discover**: the list shows places and the map shows pins. Click a category chip,
   then search for `fort`. *(GET /places/nearby, /places/search)*
2. **Place details**: open Lalbagh Fort. Facilities show **Unknown** with a hatched
   pattern. The demo data deliberately leaves fees, hours and facilities unknown.
3. **Create an account** (top right). You return signed in. *(POST /auth/register)*
4. **Review**: on a place page, give 4 stars and post. The rating under the title updates.
5. **Plan a trip**: pick 2 days, choose an interest, then **Preview matching places**:
   you see scores with reasons. Click **Build my itinerary**. *(POST /trips, POST /itineraries/generate)*
6. **Itinerary**: day tabs, the route ribbon with times, and numbered stops on the map.
   The route is dashed because travel times are estimates (`MAP_PROVIDER=estimate`).
7. **Edit**: click **Edit stops**, remove one stop, then **Save changes**. The day is
   re-timed and the version says “edited by you”. *(PATCH /itineraries/:id)*
8. **See a requirement fail on purpose**: **Change requirements** → turn on
   **I need parking** → save. With demo data no place has confirmed parking, so you get
   a clear “Not enough places match” explanation instead of a silently relaxed plan.
   Turn it off again and rebuild.
9. **Add a place**: **Add a place** → fill the name and category, click the map → **Send for
   review**. It appears under **My submissions** as *Waiting for review*.

### Make yourself a moderator (to see the moderation queue)

There is no API for changing roles, so do it in the database, then sign out and in again:

```bash
cd Navora/backend
docker compose exec postgres psql -U navora -d navora \
  -c "UPDATE users SET role = 'moderator' WHERE email = 'you@example.com';"
```
Windows (PowerShell): put the command on one line.

A **Moderation** link appears in the top bar. Approve or reject the place from step 9.

## 6. Everyday commands

| Where | Command | What it does |
|---|---|---|
| `backend/` | `docker compose up -d` | Start the database (after a reboot) |
| `backend/` | `npm run dev` | Start the API on :3000 |
| `frontend/` | `npm run dev` | Start the app on :5173 with live reload |
| `frontend/` | `npm run typecheck` | Check TypeScript types |
| `frontend/` | `npm run build` | Production build into `frontend/dist/` |
| `frontend/` | `npm run preview` | Serve the production build locally |
| `backend/` | `docker compose down` | Stop the database (data is kept) |

## 7. Troubleshooting

| You see | Cause and fix |
|---|---|
| Frontend shows “Could not reach the Navora server” | The backend is not running. Start it with `npm run dev` in `backend/`, and check http://localhost:3000/ready |
| Backend: `Invalid environment configuration` | A required value in `backend/.env` is missing; the message names it (usually `JWT_SECRET` or the Upstash values) |
| Backend: `type "geography" does not exist` | The database is not PostGIS or migrations did not run. Use `docker compose up -d`, then `npm run migrate:latest` |
| `password authentication failed` | `DATABASE_URL` does not match `docker-compose.yml`; use the default from `.env.example` |
| `/ready` says `fail` | Docker Desktop is not running, or the database container is still starting (`docker compose ps`) |
| Sign-in or itinerary build answers 503 “briefly unavailable” | Rate limiting needs Upstash and cannot reach it. Check the Upstash URL and token in `backend/.env` |
| `Port 5173 is in use` | Another Vite app is running. Stop it; the backend only allows the 5173 origin by default |
| `Too many requests` | You hit a rate limit (building itineraries: 10 per minute). Wait for the time shown |
| Map is grey with no streets | Your network blocks `tile.openstreetmap.org`. Set another tile server in `frontend/.env.local` (`VITE_MAP_TILE_URL`) |
| Every trip says “Not enough places match” | A must-have (pet, parking, wheelchair, minimum rating) is on, and the demo places have those as Unknown. Turn it off, or add places with confirmed facilities |
| Logged out unexpectedly | Normal after 30 days, or if a refresh token was reused. Sign in again |

## 8. Where things live in the frontend

```text
frontend/
├── index.html            Page shell and fonts
├── vite.config.ts        Dev server on 5173 + /api proxy to the backend
├── .env.example          Optional settings (API URL for production, map tiles)
└── src/
    ├── main.tsx          App start: data cache (TanStack Query), router, auth
    ├── App.tsx           All routes (pages) in one place
    ├── api/
    │   ├── types.ts      TypeScript types matching backend/docs/openapi.yaml
    │   ├── client.ts     fetch wrapper: response envelope, ApiError(code), token refresh
    │   ├── session.ts    Tokens in localStorage; ONE refresh shared by all tabs
    │   ├── endpoints.ts  One function per backend endpoint
    │   └── url.ts        Base URL + query strings
    ├── auth/             Sign-in state (useAuth) and page guards
    ├── components/       Layout, MapView (Leaflet), PlaceCard, shared UI pieces
    ├── pages/            One file per screen
    ├── trip/tripDraft.ts Places picked while browsing (PRD Flow A)
    ├── lib/              Formatting (Dhaka time, ৳), error messages, polyline decoding
    └── styles/           tokens.css (colours, type, spacing) and app.css
```

Rules the code follows (from the backend contract):

- Screens branch on `error.code`, never on the message (`lib/errors.ts`).
- `null` and `UNKNOWN` are shown as unknown, never as free, open or yes.
- Community text (reviews, descriptions) is shown as plain text, never as HTML.
- Itinerary order, scores and feasibility come from the backend; the UI does not re-rank.
- Expensive calls (preview, build, rebuild) only run when the user clicks.
