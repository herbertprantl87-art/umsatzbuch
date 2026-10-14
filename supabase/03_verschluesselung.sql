-- Umsatzbuch: verschlüsselte Ablage
-- Die Seite verschlüsselt alle Einträge im Browser. Hier landet nur Zeichensalat.

-- Pro Nutzerin: Salz und Prüfwert für das Datenkennwort (kein Kennwort, kein Schlüssel)
create table if not exists public.tresor_schluessel (
  user_id      uuid    primary key default auth.uid() references auth.users(id) on delete cascade,
  salz         text    not null,
  iterationen  integer not null,
  pruefwert    text    not null
);

-- Alle Einträge (Zahlungen und Monatsziele), komplett verschlüsselt
create table if not exists public.eintraege (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  daten    text not null
);
create index if not exists eintraege_user on public.eintraege (user_id);

alter table public.tresor_schluessel enable row level security;
alter table public.eintraege enable row level security;

revoke all on public.tresor_schluessel from anon;
revoke all on public.eintraege from anon;
grant select, insert on public.tresor_schluessel to authenticated;
grant select, insert, update, delete on public.eintraege to authenticated;

drop policy if exists "eigener Schluessel" on public.tresor_schluessel;
create policy "eigener Schluessel" on public.tresor_schluessel
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "eigene Eintraege" on public.eintraege;
create policy "eigene Eintraege" on public.eintraege
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
