-- Persisted per-user density preference: how many aircraft to show on the map.
alter table public.user_preferences
  add column if not exists flight_density integer not null default 500;

notify pgrst, 'reload schema';
