-- Colore di sfondo della pagina cliente, scelto dal titolare
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS background_color TEXT DEFAULT '#0f0f1a';
