// Verbindung zum eigenen Supabase-Projekt des Umsatzbuchs.
// Werte stehen in Supabase unter Project Settings > API.
// Der anon-Key darf öffentlich sein. Geschützt sind die Daten über Login und RLS.
window.UMSATZBUCH_CONFIG = {
  supabaseUrl: "https://DEIN-PROJEKT.supabase.co",
  supabaseAnonKey: "DEIN-ANON-KEY"
};
