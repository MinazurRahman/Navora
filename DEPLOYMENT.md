# Deploying NAVORA on Vercel

NAVORA is two Vercel projects from the same Git repository:

| Project | Root directory | What it is |
|---|---|---|
| `navora-api` | `backend` | The Express API, run as one Vercel Function (`backend/api/index.js`, routed by `backend/vercel.json`) |
| `navora-web` | `frontend` | The React app, built by Vite into static files (`frontend/vercel.json` sends every path to `index.html`) |

The API also needs a PostgreSQL database with PostGIS and an Upstash Redis database. Both have
free tiers.

## 1. Create the services

1. **Database:** create a PostgreSQL database with the PostGIS extension available, for example
   on [Neon](https://neon.tech) (PostGIS, `pg_trgm` and `citext` are supported). Copy the **pooled**
   connection string and make sure it ends with `?sslmode=require`.
2. **Redis:** create a database on [Upstash](https://upstash.com) and copy its REST URL and REST
   token.

## 2. Prepare the database (from your computer)

Run these once from `backend/`, pointing `DATABASE_URL` at the new database. A value set in the
shell overrides the one in `backend/.env`.

```powershell
# PowerShell (Windows)
$env:DATABASE_URL = "postgresql://...neon.tech/navora?sslmode=require"
npm run migrate:latest   # creates the tables and extensions
npm run seed             # categories and tags
npm run seed:demo        # optional: the 82 demo places with descriptions and photos
```

```bash
# macOS / Linux
DATABASE_URL="postgresql://...?sslmode=require" npm run migrate:latest
```

Run `npm run migrate:latest` the same way after any future change that adds a migration, before
deploying the code that needs it.

## 3. Deploy the API

1. In Vercel: **Add New → Project**, import the GitHub repository, set **Root Directory** to
   `backend`, and leave the framework preset as **Other** (`backend/vercel.json` sets it).
2. Add the environment variables (Settings → Environment Variables), then deploy:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the pooled connection string from step 1 |
| `DB_POOL_MAX` | `3` (each function instance keeps its own small pool) |
| `JWT_SECRET` | a random string of at least 32 characters (for example `openssl rand -base64 48`) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from step 1 |
| `TRUST_PROXY` | `1` |
| `CORS_ORIGINS` | the web app's address, for example `https://navora-web.vercel.app` (no trailing slash) |
| `APP_BASE_URL` | the same web address (used in password reset links) |
| `GOOGLE_CLIENT_ID` | optional: your Google OAuth client ID |
| `AI_ENABLED`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY` | optional: `true`, `https://ollama.com`, a cloud model, and your Ollama key. A local Ollama cannot be reached from Vercel |

Everything else has working defaults (see `backend/.env.example`). Check the deployment with
`https://<api-address>/health` and `https://<api-address>/ready` (the second also checks the
database).

## 4. Deploy the web app

1. **Add New → Project** again, the same repository, **Root Directory** `frontend`. Vercel detects
   Vite (build `npm run build`, output `dist`).
2. Environment variables:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<api-address>/api/v1` |
| `VITE_GOOGLE_CLIENT_ID` | optional: the same Google client ID as the API |

These are built into the app, so **redeploy the web app after changing them**.

3. If the web app's final address differs from what you put in `CORS_ORIGINS` and `APP_BASE_URL`,
   update those on the API project and redeploy it.

## 5. After the first deployment

- **Google sign-in:** in Google Cloud Console, add the web app's address (for example
  `https://navora-web.vercel.app`) to the OAuth client's **Authorized JavaScript origins**.
- **Moderators:** register the account on the live site, then from `backend/` run
  `npm run set-role -- person@example.com moderator` with `DATABASE_URL` pointing at the live
  database (as in step 2). They see **Moderation** in the menu after signing in again.
- **Password reset email:** only the `log` mail provider exists so far, which writes reset links
  to the function logs (Vercel → project → Logs) instead of sending mail.

## Notes and limits

- Every push to the main branch redeploys both projects; other branches get preview deployments.
  Preview web apps call whatever API `VITE_API_BASE_URL` points to, and that API only accepts
  origins listed in `CORS_ORIGINS`.
- Vercel runs the API as a function: there is no long-running process, so `/health` uptime resets
  and the graceful-shutdown code in `src/server.js` is not used there.
- Migrations never run on deploy; run them yourself (step 2).
