-- MEMBEGO SUPPLY 2.0 · modo de precio de una oferta · enums.
--
-- Un lavado no cuesta lo mismo en un sedán que en una camioneta, y una oferta
-- hoy solo sabe decir dos montos fijos. El primer paso es poder decir «35 % de
-- descuento» o «gratis» y GUARDAR cuál de las tres cosas se eligió: `salePrice`
-- dice cuánto se cobra, el modo dice qué quiso el operador. Sin el modo, al
-- reabrir una oferta al 35 % se vería «RD$650», un número que nadie escribió.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea. Mismo patrón que los Slices 7, 8 y 9.

DO $$ BEGIN
    CREATE TYPE "SupplyV2OfferPriceMode" AS ENUM ('FIXED', 'PERCENTAGE', 'FREE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Una oferta GRATIS no tenía camino a PAID: la vía bancaria rechaza un total 0
-- y la vía sin pago exigía una reserva de beneficio viva. Con esto la cobertura
-- total acepta DOS motivos para un total 0, y los distingue: un beneficio que
-- lo cubre todo (COVERED_BY_BENEFIT, alguien lo financió y hay que liquidarlo)
-- o una oferta gratis de origen (FREE_OFFER, nadie financió nada). Tratarlos
-- igual metería regalos en los informes de subsidio como si fueran pagados.
DO $$ BEGIN
    ALTER TYPE "SupplyV2PaymentStatus" ADD VALUE IF NOT EXISTS 'FREE_OFFER';
END $$;
