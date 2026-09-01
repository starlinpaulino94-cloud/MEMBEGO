-- ============================================================================
-- MEMBEGO CONNECT · Fase 12 — El alta guiada
-- ============================================================================
-- DOS COLUMNAS, las dos anulables y sin valor por defecto. En PostgreSQL 11+
-- eso es un cambio de METADATOS: no reescribe la tabla, no toca una sola fila
-- en disco y termina en milisegundos sea cual sea el tamaño.
--
-- POR QUÉ SEPARADAS DE `config`
--
--   config       ajustes OPERATIVOS. Los lee el motor cada vez que actúa y
--                viven mientras viva la conexión.
--   setupState   estado TEMPORAL del alta. Se BORRA al terminar.
--
-- Mezclarlos tiene una consecuencia concreta: el día que alguien escriba
-- «borra el progreso del asistente» borraría también el calendario elegido.
-- Y al revés, un progreso fósil de un alta abandonada hace tres meses se
-- quedaría dentro de la configuración productiva para siempre.
--
-- SIN CHECK, SIN ÍNDICES, SIN UPDATE, SIN BACKFILL.
-- Idempotente: se puede ejecutar dos veces sin daño.
--
-- (Nota de método: cuando una fase futura necesite un CHECK sobre una tabla
-- con volumen, se hará en dos pasos —ADD CONSTRAINT ... NOT VALID y luego
-- VALIDATE CONSTRAINT— para no bloquearla mientras se valida. Aquí no aplica:
-- no se añade ninguna restricción.)
-- ============================================================================

ALTER TABLE "conexiones_empresa" ADD COLUMN IF NOT EXISTS "setupState" JSONB;
ALTER TABLE "conexiones_empresa" ADD COLUMN IF NOT EXISTS "setupVersion" INTEGER;

-- ── Verificación ────────────────────────────────────────────────────────────

SELECT 'connect_alta_guiada' AS objeto,
       count(*) FILTER (WHERE column_name = 'setupState')   AS setup_state,
       count(*) FILTER (WHERE column_name = 'setupVersion') AS setup_version,
       CASE WHEN count(*) FILTER (WHERE column_name IN ('setupState','setupVersion')) = 2
            THEN 'OK' ELSE 'FALTA' END AS estado
  FROM information_schema.columns
 WHERE table_name = 'conexiones_empresa';

-- ── Diagnóstico ─────────────────────────────────────────────────────────────
-- Altas a medias que ya existan (PENDING). Ninguna tendrá setupState todavía:
-- las que empezaron antes de esta fase se reinician solas al abrir el
-- asistente, porque su estado se lee como ausente.
SELECT 'altas_a_medias' AS objeto, count(*) AS cuantas
  FROM conexiones_empresa WHERE estado = 'PENDING';
