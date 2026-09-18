-- Carattere della pagina cliente, scelto dal ristoratore fra quelli proposti.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS font_family TEXT DEFAULT 'system';
