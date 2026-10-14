# Umsatzbuch

Zahlungen mit Zahlungsart (Amazon Gutschein, Paysafe, Überweisung) eintragen und den Monat auf einen Blick sehen: Umsatz, Kunden, Durchschnitt pro Kunde, Umsatz je Zahlungsart, Monatsziel mit Hochrechnung, Umsatz nach Wochentag.

Die Seite läuft auf GitHub Pages. Die Daten liegen in einem eigenen Supabase-Projekt, getrennt von allen anderen Projekten.

## Einrichtung

1. In Supabase ein neues Projekt anlegen (z. B. "umsatzbuch").
2. Im SQL Editor nacheinander `supabase/schema.sql` und `supabase/02_zahlungen.sql` ausführen.
3. Unter Authentication > Providers > Email die Option "Allow new users to sign up" ausschalten.
4. Unter Authentication > Users mit "Add user" das Konto für die Nutzerin anlegen (E-Mail und Passwort).
5. In `config.js` die Project URL und den anon-Key aus Project Settings > API eintragen.
6. In GitHub unter Settings > Pages als Quelle den Branch `main` und den Ordner `/ (root)` wählen.

## Dateien

- `index.html`: die Seite
- `config.js`: Verbindung zu Supabase
- `supabase/schema.sql`: Monatsziele und Zugriffsregeln (RLS)
- `supabase/02_zahlungen.sql`: Tabelle für Zahlungen mit Zahlungsart

## Daten aus Excel übernehmen

Auf der Seite "Aus Excel einfügen" öffnen, in Excel die Spalten Datum, Zahlungsart, Betrag und Kunden kopieren und einfügen.
