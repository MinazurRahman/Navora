# Deploying Navora for free

Goal: a public link your team can open, with the real backend and database behind it.
Everything below uses free plans. Free plans change: check each provider's pricing page if
something looks different from this guide.

```text
Visitor ──► Vercel (frontend, static files)      https://navora-<name>.vercel.app
               │  API calls (HTTPS, CORS allow-listed)
               ▼
            Render (backend, free web service)    https://navora-api-<name>.onrender.com
               ├──► Neon (PostgreSQL + PostGIS, free)
               └──► Upstash (Redis, free)
```

| Piece | Provider | Free-plan behaviour to know |
|---|---|---|
| Frontend | [Vercel](https://vercel.com) Hobby | Personal, non-commercial projects. Rebuilds on every push |
| Backend | [Render](https://render.com) free web service | Sleeps after 15 min without visitors; the next visit waits about a minute. The app shows a notice meanwhile |
| Database | [Neon](https://neon.com) Free | 1 GB storage per project; pauses after 5 min idle and wakes quickly. Supports PostGIS |
| Cache / rate limits | [Upstash](https://upstash.com) Free | You already use it locally; make a separate one for production |

Why not Render's own database: its free Postgres is deleted 30 days after you create it.

Pick **Singapore** as the region everywhere it is offered: it is the closest to Dhaka and keeps the
three services close to each other.

Do the steps **in this order**: each one needs a value from the step before.

---

## Before you start

1. The frontend is merged into `main` on GitHub (your pull request). Vercel and Render deploy
   from `main`.
2. Locally, `npm run build` in `frontend/` succeeds. If it fails on your machine, it fails on Vercel too.
3. Keep a private note (not in Git!) to collect: Neon connection string, Upstash URL + token,
   a new JWT secret, the Render URL, the Vercel URL.

## Step 1. Database on Neon

1. Sign up at [neon.com](https://neon.com) (GitHub login works) → **Create project**.
   Name `navora`, Postgres version 17, region **AWS Asia Pacific (Singapore)**.
2. On the project dashboard click **Connect**. Turn **Connection pooling off** and copy the
   connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   Keep `?sslmode=require` at the end (the connection must be encrypted).

   Use the direct (non-pooled) string: the backend sets a per-connection statement timeout,
   which pooled connections may refuse.

3. Create the tables and load data **from your own computer**, pointing at Neon for this one
   PowerShell window only (your `backend/.env` stays unchanged):

   ```powershell
   cd E:\Navora\backend
   $env:DATABASE_URL = "postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
   npm run migrate:latest
   npm run seed
   npm run seed:demo
   Remove-Item Env:DATABASE_URL     # back to your local database
   ```

   Values already set in the window win over `.env`, so these three commands go to Neon.
   If `migrate:latest` fails with a permission error on `CREATE EXTENSION`, open Neon's
   **SQL Editor** and run, then try again:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS citext;
   ```

## Step 2. Redis on Upstash

Create a **new** Redis database for production (region Singapore) and copy its
**UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**. Keeping it separate from your
local one means local testing never uses up the live site's rate limits.

## Step 3. Backend on Render

1. Generate a **new** JWT secret for production (never reuse your local one):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. Sign up at [render.com](https://render.com) with GitHub → **New → Web Service** → pick the
   Navora repository (grant Render access to it if asked).
3. Settings:

   | Field | Value |
   |---|---|
   | Name | `navora-api` (becomes part of the URL) |
   | Region | Singapore |
   | Branch | `main` |
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

4. **Environment variables** (Advanced → Add Environment Variable):

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `DATABASE_URL` | the Neon string from step 1 |
   | `DB_POOL_MAX` | `5` |
   | `JWT_SECRET` | the new secret |
   | `UPSTASH_REDIS_REST_URL` | from step 2 |
   | `UPSTASH_REDIS_REST_TOKEN` | from step 2 |
   | `TRUST_PROXY` | `1` (see the note below) |
   | `CORS_ORIGINS` | leave **empty for now**; filled in step 5 |
   | `MAP_PROVIDER` | `estimate` (or `openrouteservice` + `MAP_API_KEY`) |
   | `LOG_LEVEL` | `info` |

   Do **not** set `PORT`: Render provides it.

   **About `TRUST_PROXY`.** It tells the backend how many proxies sit in front of it, so that
   rate limits count each visitor separately. Render does not document that number (one user
   who tested it found 3). `1` is the safe choice: visitors cannot fake their address, but on
   Render several visitors may share one rate-limit bucket, which is fine for a team demo. A
   too-high value would let visitors dodge rate limits. Ask your backend team to confirm the
   right number before real users arrive.

5. Advanced → **Health Check Path**: `/ready`.
6. **Create Web Service**. The first deploy takes a few minutes. When it says *Live*, open
   `https://navora-api-<name>.onrender.com/ready` → you should see `"status":"ready"`.
   Copy this base URL (without `/ready`).

The log shows a warning about `MAP_PROVIDER=estimate` and maybe `SHUTDOWN_DRAIN_MS`. They are
reminders, not errors.

## Step 4. Frontend on Vercel

1. Sign up at [vercel.com](https://vercel.com) with GitHub → **Add New → Project** → import Navora.
2. Settings:

   | Field | Value |
   |---|---|
   | Root Directory | `frontend` (click Edit) |
   | Framework Preset | Vite (detected) |
   | Build Command | `npm run build` (default) |
   | Output Directory | `dist` (default) |

3. **Environment Variables**: `VITE_API_BASE_URL` = your Render URL, e.g.
   `https://navora-api-abcd.onrender.com` (no `/api`, no trailing slash).
4. **Deploy**. When it finishes you get `https://navora-<name>.vercel.app`. Copy it.

`frontend/vercel.json` sends every page address (like `/trips/123`) to the app, so refreshing
any page works instead of showing Vercel's 404.

`VITE_` values are built into the files: after changing one, use **Deployments → ⋯ → Redeploy**.

## Step 5. Let the frontend talk to the backend (CORS)

Back in Render → your service → **Environment** → set
`CORS_ORIGINS` = `https://navora-<name>.vercel.app` (exactly, no trailing slash) → **Save**.
Render restarts the service.

Several addresses are allowed by separating them with commas, e.g. to keep local
development working against the live API:
`https://navora-<name>.vercel.app,http://localhost:5173`

## Step 6. Check it

Open the Vercel link and run the checklist from `SETUP.md` section 5 (discover, create an
account, review, plan a trip, build, edit). The first request after a quiet period shows
“Still working…” for up to a minute while Render wakes up. That is the free plan, not a bug.

Make yourself a moderator in Neon's **SQL Editor**, then sign out and in:
```sql
UPDATE users SET role = 'moderator' WHERE email = 'you@example.com';
```

## Updating the live site

Merge a pull request into `main` → Vercel and Render both redeploy automatically.
If a pull request adds a **migration**, run step 1.3 (`migrate:latest` against Neon) **before**
merging, so the new code finds the new tables.

Vercel also builds every pull request at its own preview address. Those previews cannot
call the API unless their address is in `CORS_ORIGINS`, so use them to review layout, and the
main link to test features.

## When something goes wrong

| Symptom | Fix |
|---|---|
| Every page says “Could not reach the Navora server” | `VITE_API_BASE_URL` is wrong or missing (redeploy after fixing), or the Render service failed: check its **Logs** |
| Browser console shows a CORS error | `CORS_ORIGINS` on Render does not exactly match the Vercel address (https, no trailing slash) |
| Render log: `Invalid environment configuration` | A required variable is missing; the log names it |
| Render log: `type "geography" does not exist` | Migrations did not run on Neon: redo step 1.3 |
| Render deploy stuck on health check | Check `DATABASE_URL` (non-pooled, with `?sslmode=require`) and that Neon migrations ran |
| Sign-in or build itinerary answers “briefly unavailable” | Upstash URL/token on Render are wrong |
| Refreshing `/trips/...` shows 404 | `frontend/vercel.json` is missing from the deployed branch |
| Map shows no streets | OpenStreetMap's public tiles are for light use; for heavier traffic set `VITE_MAP_TILE_URL` to a tile provider |

## Keep secrets secret

Connection strings, tokens and the JWT secret live only in the Render and Vercel dashboards
and your private note. Never put them in Git, screenshots or chat. If one leaks, create a new
one (Neon: reset password; Upstash: rotate token; JWT: new secret, everyone signs in again).
