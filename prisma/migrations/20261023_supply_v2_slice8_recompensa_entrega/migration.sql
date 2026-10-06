-- MEMBEGO SUPPLY 2.0 · SLICE 8 · toda recompensa necesita su beneficio.
--
-- El CHECK de `20261022_supply_v2_slice8` solo exigía la OFERTA a las
-- recompensas que entregan un producto o un servicio, y el beneficio a las
-- demás. Pero el beneficio es lo que PAGA la entrega: es lo que el cliente
-- usa en el checkout de siempre, y sin él reclamar la recompensa no daría
-- nada y la persona habría gastado sus puntos a cambio de aire.
--
-- Esta migración NO edita la anterior —que ya está aplicada y sellada—: la
-- sustituye por una más estricta en su propia migración, que es como se
-- endurece un invariante sin romper el sello.
--
-- Es compatible con lo que haya: una recompensa sin beneficio no se podía
-- reclamar, así que si alguna existiera estaría sin usar.

ALTER TABLE "supply_v2_rewards" DROP CONSTRAINT IF EXISTS "supply_v2_rewards_shape";

DO $$ BEGIN
    ALTER TABLE "supply_v2_rewards" ADD CONSTRAINT "supply_v2_rewards_shape"
        CHECK (
            "pointsCost" >= 0
            AND ("maxClaims" IS NULL OR "maxClaims" > 0)
            AND "maxPerCustomer" > 0
            AND "timesClaimed" >= 0
            AND ("maxClaims" IS NULL OR "timesClaimed" <= "maxClaims")
            AND ("endsAt" IS NULL OR "endsAt" > "startsAt")
            AND ("unitCost" IS NULL OR "unitCost" >= 0)
            AND ("budgetTotal" IS NULL OR "budgetTotal" > 0)
            AND ("kind" NOT IN ('FREE_PRODUCT', 'SERVICE') OR "offerId" IS NOT NULL)
            AND "benefitId" IS NOT NULL
            AND ("requiredPlanId" IS NULL OR "requiresMembership")
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
