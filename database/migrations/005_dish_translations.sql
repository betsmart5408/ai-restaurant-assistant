-- Traduzioni dei piatti, calcolate una volta sola e salvate.
-- source = 'auto' (tradotto dalla macchina) | 'manual' (corretto a mano: non viene sovrascritto)
CREATE TABLE IF NOT EXISTS dish_translations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dish_id     UUID REFERENCES dishes(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  name        TEXT,
  description TEXT,
  source      TEXT DEFAULT 'auto',
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dish_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_dish_translations_lookup ON dish_translations(dish_id, lang);
