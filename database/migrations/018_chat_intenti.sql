-- Quante domande dei clienti riesce a risolvere il database e quante devono
-- passare dal modello. Serve a sapere sul serio quanto rendono le risposte
-- dirette, invece di fidarsi della stima fatta a tavolino (6 su 10).
--
-- Una riga per giorno / ristorante / intento / lingua: la tabella resta
-- piccolissima (poche decine di righe al giorno anche con cento ristoranti)
-- e si aggiorna con un solo upsert per messaggio.
--
-- intento: 'piatto' | 'allergeni' | 'ordine' | 'saluto'  = risolto in casa
--          'modello'                                      = e' servito l'IA
--
-- La lingua c'e' perche' la domanda interessante e' anche un'altra: le
-- risposte dirette funzionano in tutte le lingue o solo in italiano e inglese?
CREATE TABLE IF NOT EXISTS chat_intenti (
  giorno        DATE    NOT NULL DEFAULT CURRENT_DATE,
  restaurant_id UUID    NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  intento       TEXT    NOT NULL,
  lingua        TEXT    NOT NULL DEFAULT '',
  quanti        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (giorno, restaurant_id, intento, lingua)
);

CREATE INDEX IF NOT EXISTS idx_chat_intenti_giorno ON chat_intenti(giorno DESC);
