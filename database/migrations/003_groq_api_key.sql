-- Aggiunge chiave API Groq per ogni ristorante (piano gratuito per ristorante)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS groq_api_key TEXT;
