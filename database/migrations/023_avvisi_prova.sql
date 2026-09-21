-- Avvisi di fine prova gia' mandati: uno per tipo e per ristorante, cosi'
-- il controllo orario non li ripete. 'email' e 'whatsapp' dicono se quel
-- canale e' partito davvero (il WhatsApp puo' mancare: nessun numero o
-- fuori dalla finestra di 24 ore senza modello approvato).
CREATE TABLE IF NOT EXISTS avvisi_prova (
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,              -- 'scade_presto' | 'scaduta' | 'in_pausa'
  email         BOOLEAN DEFAULT FALSE,
  whatsapp      BOOLEAN DEFAULT FALSE,
  inviato_il    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, tipo)
);
