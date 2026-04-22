-- Add per-favorite free-text notes.
alter table public.user_favorites
  add column if not exists notes text;
