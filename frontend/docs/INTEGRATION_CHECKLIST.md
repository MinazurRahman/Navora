# Frontend integration checklist

Automated tests run against fakes (`npm test`, `npm run test:e2e`). Before a release, check the
app against the real backend with this list. Each line is one thing to do and what you should see.

## Setup

1. Start the backend (`backend/README.md`): database migrated (`npm run migrate:latest`), seeded
   (`npm run seed`, optionally `npm run seed:demo`), `CORS_ORIGINS` includes `http://localhost:5173`.
2. `frontend/.env`: `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Run `npm run dev`.
3. Have two accounts: a normal user, and a moderator (set `role = 'moderator'` in the `users` table,
   then sign in again so the token carries it).

## Accounts and sessions

- [ ] Register a new account: you are signed in and returned to the page you came from (`?next=`).
- [ ] Wrong password: "The email or password is incorrect." Duplicate email: message under the email field.
- [ ] Reload a private page: it stays signed in (session in `sessionStorage`).
- [ ] Wait more than 15 minutes, then act: the access token refreshes silently (one `POST /auth/refresh`).
- [ ] Duplicate the tab, wait 15+ minutes, use both tabs: both stay signed in (no second refresh).
- [ ] Sign out: back to the home page; the backend revoked the refresh token; Back does not show private data.
- [ ] Revoke the session (delete its `refresh_tokens` rows), wait for expiry: "Your session has ended" banner.

## Places

- [ ] Home: categories, Recently added; Rated 4 stars appears only once a place is rated 4 or more.
- [ ] Explore: text search, each filter, Near me (allow location), Search this area, pagination, Clear filters.
- [ ] Explore filters in the URL: copy the URL into a new tab and get the same results.
- [ ] Place page: unknown fee, hours and facilities say so ("Entry fee unknown", "Not verified").
- [ ] Save a place, see it under Saved, remove it. Save is idempotent (double click is harmless).
- [ ] Write, edit and delete a review; the place rating updates.

## Trips and itineraries

- [ ] Plan a trip through all six steps; Back keeps answers; the review step matches what you chose.
- [ ] A trip with impossible requirements (for example parking within 2 km): the reasons and
      suggestions appear; changing a step and retrying updates the same trip (no duplicate in My trips).
- [ ] Trip page: day switching, times, travel legs, warnings in the backend's words, map route.
- [ ] Edit a day (move a stop, remove a stop, optimise order): times are recalculated, "Edited by you".
- [ ] An edit that cannot fit (remove nothing, but move many stops into one day): reason shown, nothing changes.
- [ ] Regenerate: Version 2. Change trip settings: the wizard is pre-filled; saving makes a new version.
- [ ] Delete a trip from the trip page and from My trips (confirmation each time).

## AI trip assistant (backend `AI_ENABLED=true`)

- [ ] The panel appears on a trip page only when the assistant is available.
- [ ] Each button and a typed question return an answer labelled AI-generated, with the disclaimer.
- [ ] Stop Ollama (or use a wrong key): a clear "not available" message; the itinerary still works.

## Community and moderation

- [ ] Submit a place (map pick, Free fee, known hours with a split range, Parking Yes): it is Pending.
- [ ] Edit it while Pending: stays Pending. Withdraw another submission: Archived.
- [ ] As moderator: reject with a reason. As the submitter: the reason shows; Edit and resubmit makes it Pending.
- [ ] As moderator: approve it; it appears in Explore and Community. A submitter cannot edit it any more.
- [ ] A normal user opening `/moderation` sees "You do not have access to this page".

## Resilience

- [ ] Stop the backend: pages show "Could not reach NAVORA" with Try again; nothing goes blank.
- [ ] Go offline in DevTools: the offline banner appears and disappears when back online.
- [ ] Hit a rate limit (for example many sign-in attempts): the wait time from `Retry-After` is shown.

## Layout and accessibility (spot checks; `npm run test:e2e` covers overflow)

- [ ] 390 px wide (DevTools device mode): menu, Explore list/map toggle, wizard, trip page.
- [ ] Keyboard only: Tab to "Skip to content", through a form, open and close a dialog with Escape.
- [ ] Operating system "reduce motion" on: no animated transitions or map zoom animations.
