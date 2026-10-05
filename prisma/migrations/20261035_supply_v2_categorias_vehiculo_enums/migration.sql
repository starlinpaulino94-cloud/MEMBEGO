-- MEMBEGO SUPPLY 2.0 · bitácora del catálogo de categorías de vehículo.
--
-- Cuatro filas que se tocan una vez al año, pero que deciden cuánto se cobra:
-- mover el `nivelTarifario` de una categoría cambia qué vehículos caen en ella
-- y, por tanto, qué precio paga su dueño. Un cambio así sin rastro deja una
-- pregunta sin respuesta —«¿por qué esta compra cobró el precio de SUV?»— justo
-- cuando alguien la hace.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_V2_VEHICLE_CATEGORY_CHANGED';
END $$;
