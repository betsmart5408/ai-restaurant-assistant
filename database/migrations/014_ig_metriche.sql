-- Contatori dell'invito Instagram nel chat cliente:
--  ig_popup_shown   = quante volte l'invito e' stato mostrato (1 per visita)
--  ig_follow_clicks = quante volte il cliente ha toccato "Segui su Instagram"
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ig_popup_shown   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ig_follow_clicks INTEGER NOT NULL DEFAULT 0;
