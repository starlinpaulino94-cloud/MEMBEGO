-- SUPPLIER & FULFILLMENT COMMERCE · Slice 4 · `deals.sponsor` (§17, §18).
--
-- Una oferta de la empresa puede estar financiada total o parcialmente por
-- Membego. Hasta ahora no había forma de decirlo, así que el Marketplace la
-- enseñaba como cualquier descuento de la empresa. Desde aquí:
--   MERCHANT (defecto) → «Vendido por la empresa»
--   MEMBEGO / SHARED   → «Vendido por la empresa · Promoción financiada por Membego»
-- Solo presentación y reporte: no cambia precios, cuotas ni el ledger.
-- Aditiva e idempotente; las ofertas existentes quedan en MERCHANT (verdad).
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "sponsor" "DealSponsor" NOT NULL DEFAULT 'MERCHANT';
