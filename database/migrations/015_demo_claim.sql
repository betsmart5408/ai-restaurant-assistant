-- Token per il link "Attiva la tua demo": il ristoratore apre
-- /attiva?attiva=<slug>&token=<token>, sceglie email e password, e la demo
-- diventa il suo account (is_demo passa a false, parte il trial).
-- Quando la demo viene attivata il token si azzera: il link vale una volta.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS demo_claim_token TEXT;
CREATE INDEX IF NOT EXISTS idx_restaurants_claim
  ON restaurants(demo_claim_token) WHERE demo_claim_token IS NOT NULL;
