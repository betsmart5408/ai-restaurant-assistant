-- Memoria delle conversazioni WhatsApp commerciali: per ogni numero teniamo
-- l'ultima demo di cui ha parlato, così quando risponde "1" (attiva) sappiamo
-- di quale ristorante si tratta senza che lo riscriva.
CREATE TABLE IF NOT EXISTS whatsapp_leads (
  phone       TEXT PRIMARY KEY,
  slug        TEXT,
  name        TEXT,
  stato       TEXT DEFAULT 'nuovo',   -- nuovo | menu | link_inviato | umano | attivato
  last_msg_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
