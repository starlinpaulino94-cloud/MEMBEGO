-- MEMBEGO SUPPLY 2.0 · modo de precio de una oferta · columnas y reglas.
--
-- Aditiva e idempotente. COMPATIBILIDAD: `priceMode` por defecto FIXED es una
-- afirmación VERDADERA sobre las ofertas que ya existen —todas se crearon
-- escribiendo dos montos—, no un relleno. Ninguna oferta cambia de precio.

ALTER TABLE "supply_v2_offers"
  ADD COLUMN IF NOT EXISTS "priceMode" "SupplyV2OfferPriceMode" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "priceModePercentage" DECIMAL(5,2);

-- Las tres reglas del modo, en la base y no solo en el servidor. El dominio ya
-- las valida para dar un mensaje decente; aquí están para que no entren por
-- otra puerta (una consulta a mano, un script, una migración futura).
--
--   1. El porcentaje y el modo van emparejados: un porcentaje guardado en una
--      oferta de precio fijo es un número huérfano que alguien acabaría
--      mostrando como si fuera el descuento vigente.
--   2. Rango 0 < pct <= 100: un 0 % no es un descuento y un 120 % cobraría
--      negativo. Mismo rango que `commissionPercentage`.
--   3. FREE significa gratis DE VERDAD: `salePrice = 0`. Si el modo dijera
--      gratis y el importe cobrara, el cliente vería «Gratis» y pagaría.
--
-- La invariante `salePrice <= publicPrice` ya la impone
-- `supply_v2_offers_prices` desde el Slice 2, así que no se repite aquí.
DO $$ BEGIN
    ALTER TABLE "supply_v2_offers" ADD CONSTRAINT "supply_v2_offers_price_mode" CHECK (
      (("priceMode" = 'PERCENTAGE') = ("priceModePercentage" IS NOT NULL))
      AND ("priceModePercentage" IS NULL OR ("priceModePercentage" > 0 AND "priceModePercentage" <= 100))
      AND ("priceMode" <> 'FREE' OR "salePrice" = 0)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
