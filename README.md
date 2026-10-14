# Umsatzbuch

Tagesumsatz und Kundenzahl eintragen und den Monat auf einen Blick sehen: Umsatz, Kunden, Durchschnitt pro Kunde, Monatsziel mit Hochrechnung, Umsatz nach Wochentag.

Die Seite läuft auf GitHub Pages. Die Daten liegen in einem eigenen Supabase-Projekt, getrennt von allen anderen Projekten.

## Einrichtung

1. In Supabase ein neues Projekt anlegen (z. B. "umsatzbuch").
2. Im SQL Editor den Inhalt von `supabase/schema.sql` ausführen.
3. Unter Authentication > Providers > Email die Option "Allow new users to sign up" ausschalten.
4. Unter Authentication > Users mit "Add user" das Konto für die Nutzerin anlegen (E-Mail und Passwort).
5. In `config.js` die Project URL und den anon-Key aus Project Settings > API eintragen.
6. In GitHub unter Settings > Pages als Quelle den Branch `main` und den Ordner `/ (root)` wählen.

## Dateien

- `index.html`: die Seite
- `config.js`: Verbindung zu Supabase
- `supabase/schema.sql`: Tabellen und Zugriffsregeln (RLS)

## Daten aus Excel übernehmen

Auf der Seite "Aus Excel einfügen" öffnen, in Excel die Spalten Datum, Umsatz und Kunden kopieren und einfügen.
