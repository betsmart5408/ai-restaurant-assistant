-- Risposte scritte PRIMA, non improvvisate davanti al cliente.
--
-- Il menu e' fermo: il racconto di un piatto e il suo abbinamento non cambiano
-- da un tavolo all'altro. Finora li rigenerava il modello a ogni domanda, a
-- pagamento, con 800 ms di attesa e senza che nessuno avesse mai letto cosa
-- diceva dei piatti del ristorante.
--
-- Calcolate una volta e salvate qui:
--  - costano una tantum invece che a ogni cliente;
--  - arrivano in 10 ms invece che in 800;
--  - continuano a funzionare se il fornitore di turno e' giu';
--  - il ristoratore puo' LEGGERLE e correggerle prima che le veda un cliente.
--
-- kind = 'racconto'     il piatto raccontato bene (ingredienti, sapore, tecnica)
--        'abbinamento'  cosa bere con quel piatto
--
-- source = 'auto' | 'manual'. Come per dish_translations, la riga corretta a
-- mano non viene MAI sovrascritta da una rigenerazione.
--
-- NON si precalcola niente che riguardi allergeni o sicurezza alimentare:
-- quella risposta resta deterministica, presa dal campo allergens. Una frase
-- generata e congelata su un allergene sarebbe piu' pericolosa del modello dal
-- vivo, perche' resta li' per mesi senza che nessuno la rilegga.
CREATE TABLE IF NOT EXISTS dish_answers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dish_id    UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('racconto', 'abbinamento')),
  text       TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'auto',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (dish_id, lang, kind)
);

CREATE INDEX IF NOT EXISTS idx_dish_answers_lookup ON dish_answers(dish_id, lang);
