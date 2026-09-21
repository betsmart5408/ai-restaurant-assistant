-- Interruttore dell'assistente: spento, la chat del cliente mostra solo il
-- menu (niente tasto assistente, niente "Chiedi a ...") e l'API rifiuta la chat.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS assistente_attivo BOOLEAN NOT NULL DEFAULT TRUE;
