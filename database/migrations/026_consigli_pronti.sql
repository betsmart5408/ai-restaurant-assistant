-- Consigli pronti: "cosa mi consigli?", "menu degustazione per 2",
-- "sono vegetariano", "per bambini". L'IA li scrive la prima volta che un
-- cliente li chiede (per ristorante e lingua), poi li riusano tutti gli altri.
-- Si riscrivono quando cambia il menu (menu_hash) o dopo un giorno.
CREATE TABLE IF NOT EXISTS consigli_pronti (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  lang          TEXT NOT NULL,
  tipo          TEXT NOT NULL,           -- consiglio | degustazione2 | vegetariano | bambini
  menu_hash     TEXT NOT NULL,
  testo         TEXT NOT NULL,
  suggerimenti  JSONB NOT NULL DEFAULT '[]',
  creato_il     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usato         INTEGER NOT NULL DEFAULT 0,  -- quante volte e' stato riusato gratis
  PRIMARY KEY (restaurant_id, lang, tipo)
);
