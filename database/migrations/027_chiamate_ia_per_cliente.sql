-- Quante volte il MODELLO ha risposto dentro questa conversazione.
--
-- Il tetto sulle chiamate all'IA era per ristorante e per giorno: il sesto
-- cliente della giornata trovava un assistente spento per colpa dei cinque
-- di prima, e non e' giusto ne' spiegabile. Ora il conto e' per cliente:
-- ognuno ha le sue cinque domande al modello, e chi arriva dopo trova la
-- chat come l'ha trovata il primo.
--
-- Le risposte che da' il database - piatti, prezzi, allergeni, ordini,
-- saluti, fuori tema, consigli gia' in cache - NON incrementano questo
-- contatore: non costano niente e non devono essere razionate.
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS chiamate_ia INTEGER NOT NULL DEFAULT 0;
