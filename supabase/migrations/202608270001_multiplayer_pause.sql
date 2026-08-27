alter table public.rooms
  add column paused_at timestamptz,
  add column paused_ms integer not null default 0 check (paused_ms >= 0);
