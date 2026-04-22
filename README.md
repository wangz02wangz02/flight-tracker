# Flight Tracker

Real-time global flight tracker. Railway worker polls OpenSky → writes to
Supabase → Next.js on Vercel subscribes via Realtime.

See [CLAUDE.md](./CLAUDE.md) for the full architecture.

## Quick start

```bash
# 1. Install (uses npm workspaces)
npm install

# 2. Copy env templates
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env

# 3. Apply schema in Supabase
#    Paste supabase/migrations/0001_init.sql into the SQL editor,
#    then enable Clerk as a Third-party auth provider
#    (see supabase/README.md).

# 4. Run both services
npm run dev:worker   # polls OpenSky, upserts flights
npm run dev:web      # http://localhost:3000
```

## Deploy

- **Web** → Vercel. Project root: `apps/web`. Env vars: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
  `CLERK_SECRET_KEY`.
- **Worker** → Railway. Project root: `apps/worker`. Env vars: `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, optional `OPENSKY_USERNAME` / `OPENSKY_PASSWORD` /
  `OPENSKY_BBOX`, `POLL_INTERVAL_MS`.

## Features

- Live world map of every flight OpenSky reports (Leaflet + dark CARTO tiles)
- Per-user **favorites** and **country filter**, protected by Supabase RLS
- Realtime updates via Supabase — no browser polling, no page refresh
- Clerk authentication, wired to Supabase as a third-party auth provider so
  RLS policies using `auth.jwt()->>'sub'` work end to end
