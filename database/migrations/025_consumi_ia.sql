-- Quanto consuma l'IA, per ristorante e per giorno: chiamate, token e costo.
-- Una riga per fornitore/modello, cosi' si vede quanto e' andato sui piani
-- gratuiti e quanto su quelli a pagamento.
CREATE TABLE IF NOT EXISTS consumi_ia (
  giorno        DATE NOT NULL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  fornitore     TEXT NOT NULL,
  modello       TEXT NOT NULL,
  chiamate      INTEGER NOT NULL DEFAULT 0,
  token_in      BIGINT NOT NULL DEFAULT 0,
  token_out     BIGINT NOT NULL DEFAULT 0,
  costo_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (giorno, restaurant_id, fornitore, modello)
);

CREATE INDEX IF NOT EXISTS idx_consumi_ia_ristorante ON consumi_ia (restaurant_id, giorno);

-- Limite giornaliero di domande all'IA per un singolo ristorante.
-- NULL = il limite generale (LIMITE_IA_GIORNO, o LIMITE_IA_DEMO_GIORNO per le demo).
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS limite_ia_giorno INTEGER;
