-- Dove si trova il ristorante e come si racconta.
-- Serve all'assistente per dare l'ora giusta, il meteo giusto e non inventare
-- storie sul locale. La colonna timezone esiste gia' dalla migrazione 001.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS country      TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS latitude     DECIMAL(9,5);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS longitude    DECIMAL(9,5);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisine_type TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS about        TEXT;
