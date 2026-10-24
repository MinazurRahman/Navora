# Navora frontend

The web app for Navora, the City Explore & Travel Planning Platform. React 19 + TypeScript,
built with Vite, talking to the backend in `../backend` through its documented REST API
(`../backend/docs/openapi.yaml`).

**First time? Follow [SETUP.md](SETUP.md)**: it runs the backend and this app together.

```bash
npm install
npm run dev        # http://localhost:5173 (backend must be running on :3000)
```

## What is in it

| Screen | Route | Backend endpoints |
|---|---|---|
| Discover: nearby, newest, search, filters, map | `/` | `GET /places/nearby`, `/places`, `/places/search`, `/categories` |
| Place details, facilities, hours, reviews | `/places/:id` | `GET /places/:id`, reviews CRUD |
| Sign in / create account | `/login`, `/register` | `/auth/*` |
| Trip planner (Flow A picks + Flow B requirements), recommendations preview | `/plan`, `/trips/:id/edit` | `POST /recommendations`, `POST/PATCH /trips` |
| My trips | `/trips` | `GET /trips`, `GET /itineraries?current=true` |
| Itinerary: day tabs, route ribbon, map, warnings, edit stops, versions, rebuild | `/trips/:id` | `/itineraries/*` |
| Add or fix a place | `/contribute`, `/contribute/:id` | `POST/PATCH /places` |
| My submissions with moderator notes | `/my-places` | `GET /places/mine`, `/places/:id/moderation-events` |
| Moderation queue (moderators) | `/moderation` | `/places/moderation`, approve, reject |
| Account | `/account` | `GET /auth/me` |

Not included yet: the AI Trip Assistant (off by default in the backend; post-MVP in the PRD),
place photos and profile editing (the API does not support them yet), automated tests.

## Stack

| Need | Library |
|---|---|
| UI | React 19 |
| Language | TypeScript (strict) |
| Build / dev server | Vite |
| Routing | React Router 7 |
| Server data | TanStack Query 5 |
| Map | Leaflet + react-leaflet, OpenStreetMap tiles |

No CSS framework: design tokens live in `src/styles/tokens.css` (light and dark themes).
