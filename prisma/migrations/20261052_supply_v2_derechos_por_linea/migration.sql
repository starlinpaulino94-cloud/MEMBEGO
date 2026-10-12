-- SUPPLY V2 · un derecho por unidad comprada, también en la base (sprint de cierre, 2026-10-08).
--
-- QUÉ CUBRE. Los derechos (`supply_v2_entitlements`) se emiten al confirmar el pago, uno
-- por unidad de cada línea de la orden (`emitirDerechosDeOrdenEnTx`). Que no se emitieran
-- dos veces dependía SOLO del código: el candado `FOR UPDATE` sobre la orden y el estado
-- PAID. La base no tenía ninguna regla que limitara los derechos de una línea, así que un
-- escritor nuevo (o un camino sin candado) podía dejar más derechos que unidades pagadas:
-- unidades canjeables que nadie pagó. Desde esta migración:
--
--   · un derecho pertenece a una línea de SU orden (no de otra);
--   · una línea nunca tiene más derechos que `quantity` (todos cuentan, también los
--     cancelados: cancelar un derecho no abre cupo para emitir otro). La comprobación
--     bloquea la fila de la línea, así dos emisiones a la vez se serializan.
--
-- DATOS EXISTENTES. Solo se comprueban (NOTICE con el recuento); no se tocan. Una línea
-- que ya estuviera por encima seguiría igual: lo detecta el aviso y se revisa a mano.

CREATE OR REPLACE FUNCTION supply_v2_entitlements_por_linea() RETURNS trigger AS $$
DECLARE
    v_order_id TEXT;
    v_quantity INTEGER;
    v_emitidos INTEGER;
BEGIN
    SELECT "orderId", "quantity" INTO v_order_id, v_quantity
      FROM "supply_v2_customer_order_lines" WHERE "id" = NEW."orderLineId" FOR UPDATE;
    IF v_order_id IS NULL THEN
        RAISE EXCEPTION 'supply_v2_entitlements_linea: la línea % no existe.', NEW."orderLineId"
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_order_id <> NEW."orderId" THEN
        RAISE EXCEPTION 'supply_v2_entitlements_linea: la línea % no es de la orden %.', NEW."orderLineId", NEW."orderId"
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT COUNT(*) INTO v_emitidos FROM "supply_v2_entitlements" WHERE "orderLineId" = NEW."orderLineId";
    IF v_emitidos + NEW."quantity" > v_quantity THEN
        RAISE EXCEPTION 'supply_v2_entitlements_linea: la línea % ya tiene sus % derechos: no se emite otro.', NEW."orderLineId", v_quantity
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "supply_v2_entitlements_por_linea" ON "supply_v2_entitlements";
CREATE TRIGGER "supply_v2_entitlements_por_linea"
    BEFORE INSERT ON "supply_v2_entitlements"
    FOR EACH ROW EXECUTE FUNCTION supply_v2_entitlements_por_linea();

-- La línea de un derecho no cambia: con ella viajaría el cupo.
CREATE OR REPLACE FUNCTION supply_v2_entitlements_linea_fija() RETURNS trigger AS $$
BEGIN
    IF NEW."orderLineId" <> OLD."orderLineId" OR NEW."orderId" <> OLD."orderId" OR NEW."quantity" <> OLD."quantity" THEN
        RAISE EXCEPTION 'supply_v2_entitlements_linea: el derecho % no cambia de línea, de orden ni de cantidad.', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "supply_v2_entitlements_linea_fija" ON "supply_v2_entitlements";
CREATE TRIGGER "supply_v2_entitlements_linea_fija"
    BEFORE UPDATE ON "supply_v2_entitlements"
    FOR EACH ROW EXECUTE FUNCTION supply_v2_entitlements_linea_fija();

-- ── Lo que ya existe, a la vista ─────────────────────────────────────────────
DO $$
DECLARE
    v_lineas_de_mas INTEGER;
    v_de_otra_orden INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_lineas_de_mas FROM (
        SELECT e."orderLineId"
          FROM "supply_v2_entitlements" e
          JOIN "supply_v2_customer_order_lines" l ON l."id" = e."orderLineId"
         GROUP BY e."orderLineId", l."quantity"
        HAVING SUM(e."quantity") > l."quantity"
    ) x;
    SELECT COUNT(*) INTO v_de_otra_orden
      FROM "supply_v2_entitlements" e
      JOIN "supply_v2_customer_order_lines" l ON l."id" = e."orderLineId"
     WHERE l."orderId" <> e."orderId";
    RAISE NOTICE 'supply_v2_entitlements_por_linea: % líneas con más derechos que unidades, % derechos de otra orden (se dejan como están: revisar a mano si no es 0).', v_lineas_de_mas, v_de_otra_orden;
END $$;
