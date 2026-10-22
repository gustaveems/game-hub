-- Game Hub global leaderboard schema (Neon Postgres + Data API / PostgREST).
--
-- Setup:
--   1. Create a Neon project and enable the Data API on its branch.
--   2. Enable Neon Auth (Better Auth) so the extension can fetch an anonymous JWT.
--   3. Run this file against the database (e.g. the Neon SQL editor).
--   4. Put the Data API URL and Auth URL into lib/global.js.
--
-- Security note: the "anonymous" role below can INSERT/UPDATE, which makes the
-- board self-reported (spoofable). That's intentional for a login-free board.
-- Grant only SELECT to anonymous if you want a read-only public board.

create table if not exists public.leaderboard (
  player_id     text primary key,
  name          text not null,
  streak        integer not null default 0,
  longest       integer not null default 0,
  dailies_today integer not null default 0,
  plays         integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint name_len      check (char_length(name) between 1 and 40),
  constraint streak_range  check (streak >= 0 and streak <= 100000),
  constraint longest_range check (longest >= 0 and longest <= 100000),
  constraint dailies_range check (dailies_today >= 0 and dailies_today <= 1000),
  constraint plays_range   check (plays >= 0 and plays <= 100000000)
);

create index if not exists leaderboard_streak_idx
  on public.leaderboard (streak desc, longest desc);

-- Force updated_at to server time regardless of what the client sends.
create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_set_updated_at
  before insert or update on public.leaderboard
  for each row execute function public.set_updated_at();

-- RLS: readable and upsertable by everyone, never deletable.
alter table public.leaderboard enable row level security;
create policy lb_select on public.leaderboard for select using (true);
create policy lb_insert on public.leaderboard for insert with check (true);
create policy lb_update on public.leaderboard for update using (true) with check (true);

-- Grants for the Data API's anonymous role (unauthenticated requests).
grant usage on schema public to anonymous;
grant select, insert, update on public.leaderboard to anonymous;
revoke delete, truncate on public.leaderboard from anonymous;
