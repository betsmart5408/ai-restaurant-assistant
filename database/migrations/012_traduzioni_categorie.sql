-- Traduzione dei nomi di categoria ("Charcoal Grill", "To Share", "STARTERS").
--
-- Fino a ora si traducevano solo i piatti: un turista cinese leggeva i nomi
-- dei piatti in cinese ma le intestazioni delle sezioni restavano in inglese.
-- La categoria e' scritta a mano dal ristorante ed e' la stessa per molti
-- piatti, percio' la traduzione sta su una tabella propria e non su dishes.
--
-- source = 'manual'  -> tradotta a mano, non va mai sovrascritta
-- source = 'auto'    -> generata dal traduttore automatico

CREATE TABLE IF NOT EXISTS category_translations (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  lang          TEXT NOT NULL,
  name          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'auto',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, category, lang)
);

CREATE INDEX IF NOT EXISTS idx_category_translations_lookup
  ON category_translations (restaurant_id, lang);
