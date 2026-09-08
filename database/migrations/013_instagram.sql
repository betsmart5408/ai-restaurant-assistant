-- Link Instagram del ristorante. Usato dal chat cliente per l'invito a
-- seguire la pagina (popup dopo 2 minuti). Vuoto = nessun invito.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS instagram_url TEXT;
