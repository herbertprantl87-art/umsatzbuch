-- Umsatzbuch: Zahlungen mit Zahlungsart (ersetzt die Tageswerte)
-- Im SQL Editor einmal komplett ausführen.

create table if not exists public.zahlungen (
  id           bigint generated always as identity primary key,
  user_id      uuid          not null default auth.uid() references auth.users(id) on delete cascade,
  datum        date          not null,
  zahlungsart  text          not null check (zahlungsart in ('Amazon Gutschein','Paysafe','Überweisung')),
  betrag       numeric(12,2) not null check (betrag >= 0),
  kunden       integer       not null default 1 check (kunden >= 0),
  notiz        text,
  erstellt     timestamptz   not null default now()
);

create index if not exists zahlungen_user_datum on public.zahlungen (user_id, datum);

alter table public.zahlungen enable row level security;

revoke all on public.zahlungen from anon;
grant select, insert, update, delete on public.zahlungen to authenticated;

drop policy if exists "eigene Zahlungen" on public.zahlungen;
create policy "eigene Zahlungen" on public.zahlungen
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
