-- I ristoranti caricati dalla prospezione sono DEMO: servono a far vedere il
-- prodotto a chi non e' ancora cliente. Devono restare riconoscibili e
-- cancellabili in blocco, senza mai rischiare di toccare un cliente vero.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_demo       BOOLEAN DEFAULT FALSE;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_email    TEXT;     -- a chi mandiamo il link
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_sito     TEXT;     -- il loro sito, quello in una lingua sola
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_creata_il TIMESTAMPTZ;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_inviata_il TIMESTAMPTZ;  -- quando abbiamo scritto al ristorante

CREATE INDEX IF NOT EXISTS idx_restaurants_demo ON restaurants(is_demo) WHERE is_demo = TRUE;
