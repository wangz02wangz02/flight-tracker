-- Track transponder squawk so the UI can flag emergency codes (7500/7600/7700).
alter table public.flights
  add column if not exists squawk text;

notify pgrst, 'reload schema';
