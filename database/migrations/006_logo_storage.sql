-- Il logo del ristorante salvato nel database.
-- Su Vercel il disco del server e' di sola lettura e sparisce a ogni richiesta,
-- quindi i file caricati devono stare qui.
CREATE TABLE IF NOT EXISTS restaurant_logos (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  mime          TEXT NOT NULL,
  data          BYTEA NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Colori del locale, per personalizzare la pagina di ogni cliente
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#e94560';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS base_lang     TEXT DEFAULT 'es';
