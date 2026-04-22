-- Flight Tracker schema
-- User IDs come from Clerk (third-party auth in Supabase), so user_id is text.
-- RLS checks use auth.jwt()->>'sub' which resolves to the Clerk user id.

create extension if not exists "pgcrypto";

-- ---------- flights ----------
-- Snapshot of aircraft states pushed by the Railway worker.
-- icao24 is the ICAO 24-bit transponder address — unique per aircraft.
create table if not exists public.flights (
  icao24              text primary key,
  callsign            text,
  origin_country      text,
  longitude           double precision,
  latitude            double precision,
  baro_altitude       double precision,
  velocity            double precision,
  true_track          double precision,
  vertical_rate       double precision,
  on_ground           boolean,
  last_contact        timestamptz,
  updated_at          timestamptz not null default now()
);

create index if not exists flights_updated_at_idx on public.flights (updated_at desc);
create index if not exists flights_origin_country_idx on public.flights (origin_country);
create index if not exists flights_callsign_idx on public.flights (callsign);

-- ---------- user_preferences ----------
create table if not exists public.user_preferences (
  user_id             text primary key,                       -- Clerk user id
  map_center_lat      double precision not null default 40.0,
  map_center_lon      double precision not null default -95.0,
  map_zoom            integer          not null default 4,
  filter_country      text,                                   -- optional: only show this country
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------- user_favorites ----------
create table if not exists public.user_favorites (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null,                          -- Clerk user id
  icao24              text not null references public.flights(icao24) on delete cascade,
  label               text,
  created_at          timestamptz not null default now(),
  unique (user_id, icao24)
);

create index if not exists user_favorites_user_idx on public.user_favorites (user_id);

-- ---------- Row Level Security ----------
alter table public.flights            enable row level security;
alter table public.user_preferences   enable row level security;
alter table public.user_favorites     enable row level security;

-- flights: any authenticated user can read; only service_role writes.
drop policy if exists "flights are readable by authenticated users" on public.flights;
create policy "flights are readable by authenticated users"
  on public.flights for select
  to authenticated
  using (true);

-- user_preferences: owner-only CRUD.
drop policy if exists "prefs select own" on public.user_preferences;
create policy "prefs select own"
  on public.user_preferences for select
  to authenticated
  using (user_id = auth.jwt()->>'sub');

drop policy if exists "prefs insert own" on public.user_preferences;
create policy "prefs insert own"
  on public.user_preferences for insert
  to authenticated
  with check (user_id = auth.jwt()->>'sub');

drop policy if exists "prefs update own" on public.user_preferences;
create policy "prefs update own"
  on public.user_preferences for update
  to authenticated
  using (user_id = auth.jwt()->>'sub')
  with check (user_id = auth.jwt()->>'sub');

drop policy if exists "prefs delete own" on public.user_preferences;
create policy "prefs delete own"
  on public.user_preferences for delete
  to authenticated
  using (user_id = auth.jwt()->>'sub');

-- user_favorites: owner-only CRUD.
drop policy if exists "favs select own" on public.user_favorites;
create policy "favs select own"
  on public.user_favorites for select
  to authenticated
  using (user_id = auth.jwt()->>'sub');

drop policy if exists "favs insert own" on public.user_favorites;
create policy "favs insert own"
  on public.user_favorites for insert
  to authenticated
  with check (user_id = auth.jwt()->>'sub');

drop policy if exists "favs update own" on public.user_favorites;
create policy "favs update own"
  on public.user_favorites for update
  to authenticated
  using (user_id = auth.jwt()->>'sub')
  with check (user_id = auth.jwt()->>'sub');

drop policy if exists "favs delete own" on public.user_favorites;
create policy "favs delete own"
  on public.user_favorites for delete
  to authenticated
  using (user_id = auth.jwt()->>'sub');

-- ---------- Realtime ----------
-- Publish flights so the browser can subscribe to live INSERT/UPDATE events.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'flights'
  ) then
    execute 'alter publication supabase_realtime add table public.flights';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_favorites'
  ) then
    execute 'alter publication supabase_realtime add table public.user_favorites';
  end if;
end $$;
