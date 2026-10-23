# NAVORA frontend

React + Vite (JavaScript, ESM) web app for the NAVORA API in `../backend`.

## Setup

1. Start the backend (see `../backend/README.md`). Its `CORS_ORIGINS` must include `http://localhost:5173`.
2. `cp .env.example .env` and adjust `VITE_API_BASE_URL` if the API is not at `http://localhost:3000/api/v1`.
3. `npm install`, then `npm run dev` and open http://localhost:5173.

| Script | What it does |
|---|---|
| `npm run dev` | Development server (also serves `/style-guide`, the design-system reference) |
| `npm test` | Vitest unit and component tests |
| `npm run lint` | oxlint |
| `npm run build` / `npm run preview` | Production build and a local preview of it |

## Where things live

- `src/api/` – the only code that calls the API: `client.js` (envelope, errors, token refresh) and `session.js` (tokens in sessionStorage)

Sessions live in `sessionStorage` (per tab, gone when the tab closes). Access tokens are refreshed
once on `401 TOKEN_EXPIRED`; refresh tokens are single use, so duplicated tabs (which copy
`sessionStorage`) serialise refreshes with a Web Lock and share the new tokens over a
`BroadcastChannel`. When the server ends a session, the app says so and offers to sign in again.
- `src/features/<feature>/` – pages, components and endpoint functions (`api.js`) per feature
- `src/components/` – shared UI built on the tokens in `src/styles/tokens.css`
- `src/routes.jsx` – every route

The API contract is `../backend/docs/openapi.yaml`. Rules worth knowing: branch on error `code`,
never on `message`; unknown facility values, fees, ratings and opening hours are shown as unknown,
never as yes; no emoji anywhere (enforced by `src/test/noEmoji.test.js`).

## Deployment

The app is a static build (`dist/`). The web server must answer unknown paths with `index.html`
so links such as `/trips/123` work when opened directly.
