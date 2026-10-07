-- COMMERCE CORE · bitácora del catálogo unificado (Fase 1).
--
-- Cuatro acciones de auditoría para lo que cambia lo que se vende y a qué
-- precio: crear un ítem, editarlo, cambiar su estado (publicar, pausar,
-- archivar) y tocar una variante. El payload lleva el antes y el después del
-- precio y del estado, que es lo que alguien va a preguntar.
--
-- Va en su propia migración porque PostgreSQL no permite usar un valor de enum
-- nuevo en la MISMA transacción que lo crea.

DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CATALOG_ITEM_CREATED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CATALOG_ITEM_UPDATED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CATALOG_ITEM_STATUS_CHANGED';
END $$;
DO $$ BEGIN
    ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'CATALOG_VARIANT_CHANGED';
END $$;
