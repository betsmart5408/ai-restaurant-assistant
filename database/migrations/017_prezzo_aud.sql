-- Prezzo abbonamento: da 49 EUR a 30 AUD (mercato Australia).
-- Cambia il default della colonna e allinea le righe rimaste al vecchio
-- default (49.00); non tocca prezzi gia' personalizzati diversi da 49.

ALTER TABLE restaurants ALTER COLUMN monthly_price SET DEFAULT 30.00;

UPDATE restaurants SET monthly_price = 30.00 WHERE monthly_price = 49.00;
