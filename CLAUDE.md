# Flight Tracker — Architecture

Real-time global flight tracker. A Railway-hosted worker polls the OpenSky
Network, writes into Supabase, and a Next.js frontend on Vercel subscribes via
Supabase Realtime so the map and favorites update live — no browser polling, no
page refresh.

## Services

```
 OpenSky /states/all
         │   (HTTP GET, every 30s)
         ▼
 ┌──────────────────────┐
 │ apps/worker (Railway)│  Node 22 + TypeScript
 │  - fetch states      │  SUPABASE_SERVICE_ROLE_KEY → bypasses RLS by design
 │  - upsert flights    │
 └────────┬─────────────┘
          │ Postgres
          ▼
 ┌──────────────────────┐
 │ Supabase             │  public.flights, public.user_preferences,
 │  - Row Level Security│  public.user_favorites
 │  - Realtime publishes│  Clerk configured as third-party auth provider
 │    changes on        │  → auth.jwt()->>'sub' resolves to Clerk user id
 │    flights + favs    │
 └────────┬─────────────┘
          │ websocket (Realtime) + REST (reads)
          ▼
 ┌──────────────────────┐
 │ apps/web (Vercel)    │  Next.js 16 + Tailwind v4 + Clerk
 │  - Clerk auth        │  Browser Supabase client sends Clerk JWT on every
 │  - Leaflet map       │   request via `accessToken` callback.
 │  - Realtime channel  │
 └──────────────────────┘
```

## Data flow

1. Worker calls `https://opensky-network.org/api/states/all` every 30 s.
2. Each aircraft is normalized into a `flights` row and **upserted** on
   `icao24` (the transponder address), updating position/altitude/velocity.
3. Supabase Realtime publishes INSERT/UPDATE events on `public.flights` and
   `public.user_favorites`.
4. The browser opens one channel and patches a local `Map<icao24, flight>` in
   React state. Markers re-render; the map never reloads.

## Tables

| table              | owner      | purpose                                                            |
|--------------------|------------|--------------------------------------------------------------------|
| `flights`          | worker     | Latest state per aircraft. Keyed by `icao24`.                      |
| `user_preferences` | user       | Map center, zoom, country filter. PK = Clerk user id.              |
| `user_favorites`   | user       | Saved aircraft. Unique `(user_id, icao24)`; FK → `flights.icao24`. |

Schema lives in `supabase/migrations/0001_init.sql`.

## Auth + RLS (the important bit)

- **Auth**: Clerk is configured in Supabase → Authentication → Third-party auth
  as a trusted provider. The frontend uses `@clerk/nextjs` for sessions.
- **Token path**: The Supabase browser client is created with an `accessToken`
  callback that reads the current Clerk session token on every request
  (`apps/web/src/lib/supabase-browser.ts`). Supabase verifies it and populates
  `auth.jwt()`.
- **RLS**:
  - `flights`: any `authenticated` role may SELECT; no client writes at all.
    The worker uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS — which is
    the correct pattern for trusted server-side ingestion.
  - `user_preferences` and `user_favorites`: all four policies require
    `user_id = auth.jwt()->>'sub'`. A signed-in user can only see, insert,
    update, or delete their own rows.

This closes the gap from the previous assignment, where RLS was disabled and
the app relied on server-route scoping. With Clerk wired as a third-party auth
provider and policies keyed on `auth.jwt()->>'sub'`, protection lives at the
database, not at the app.

## Personalization

- Per-user **country filter** (`user_preferences.filter_country`) — stored and
  read through RLS-protected rows.
- Per-user **favorites** (`user_favorites`) — toggled from the map popup,
  listed on `/favorites`, live-updated as positions change.
- Per-user **map center + zoom** — stored with preferences for future use.

## Environment variables

- Root `.env.example` documents every variable.
- `apps/web/.env.example` — browser + Clerk + Supabase public keys.
- `apps/worker/.env.example` — Supabase service role key + OpenSky bounding box.
- Same values must also be set in the Vercel and Railway project dashboards.

## Deploy

- **Web (Vercel)**: import the repo, set project root to `apps/web`, set env
  vars, deploy. Framework autodetects Next.js.
- **Worker (Railway)**: new service → connect repo → root directory
  `apps/worker`. Build/start commands are in `apps/worker/railway.json`. Set
  env vars (Supabase URL + service role, optional OpenSky creds + bbox,
  `POLL_INTERVAL_MS`).

## Supabase MCP

Configured via:

```
claude mcp add --transport http supabase https://mcp.supabase.com/mcp
```

Used to apply `supabase/migrations/0001_init.sql` against the linked project and
to verify RLS by running SELECTs impersonating different users.

## Repository layout

```
.
├── apps/
│   ├── web/           # Next.js 16 + Tailwind v4 + Clerk + Leaflet
│   │   ├── src/app/          # routes: /, /map, /favorites
│   │   ├── src/components/   # MapClient, FlightMap, FavoriteButton, …
│   │   ├── src/lib/          # supabase-browser, use-supabase, types
│   │   └── src/middleware.ts # Clerk route protection
│   └── worker/        # OpenSky poller → Supabase upsert
│       └── src/index.ts
├── supabase/
│   ├── migrations/0001_init.sql
│   └── README.md      # Clerk third-party auth setup steps
├── CLAUDE.md          # (this file)
└── package.json       # npm workspaces root
```
