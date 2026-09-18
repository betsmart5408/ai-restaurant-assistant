-- Nome dell'assistente virtuale, scelto dal ristoratore. Se non lo cambia resta Marco.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_name TEXT DEFAULT 'Marco';
