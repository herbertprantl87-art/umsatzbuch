-- Umsatzbuch: Tabellen und Zugriffsregeln
-- Im eigenen Supabase-Projekt unter SQL Editor einmal komplett ausführen.

create table if not exists public.umsatz_tage (
  user_id    uuid          not null default auth.uid() references auth.users(id) on delete cascade,
  datum      date          not null,
  umsatz     numeric(12,2) not null check (umsatz >= 0),
  kunden     integer       not null check (kunden >= 0),
  notiz      text,
  geaendert  timestamptz   not null default now(),
  primary key (user_id, datum)
);

create table if not exists public.monatsziele (
  user_id  uuid          not null default auth.uid() references auth.users(id) on delete cascade,
  monat    text          not null check (monat ~ '^\d{4}-\d{2}$'),
  ziel     numeric(12,2) not null check (ziel >= 0),
  primary key (user_id, monat)
);

-- Zugriff: jede angemeldete Person sieht und ändert nur ihre eigenen Zeilen.
alter table public.umsatz_tage enable row level security;
alter table public.monatsziele enable row level security;

revoke all on public.umsatz_tage from anon;
revoke all on public.monatsziele from anon;
grant select, insert, update, delete on public.umsatz_tage to authenticated;
grant select, insert, update, delete on public.monatsziele to authenticated;

drop policy if exists "eigene Tage" on public.umsatz_tage;
create policy "eigene Tage" on public.umsatz_tage
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "eigene Ziele" on public.monatsziele;
create policy "eigene Ziele" on public.monatsziele
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
