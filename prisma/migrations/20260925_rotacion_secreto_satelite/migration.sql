-- ============================================================================
-- ROTACIÓN DEL SECRETO DE SATÉLITE  ·  auditoría de integraciones, hallazgo A-7
-- ============================================================================
--
-- `SistemaConectado.secreto` es el secreto compartido con un satélite: firma sus
-- webhooks y sus tokens SSO, en las dos direcciones. Rotarlo obligaba a un CORTE:
-- se cambiaba aquí y el satélite dejaba de validar hasta que alguien actualizaba
-- su .env. Una rotación que corta el servicio es una rotación que no se hace.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTE MODELO Y NO EL DE LOS WEBHOOKS DE EMPRESA
--
-- Aquél firma lo saliente con una LISTA de secretos y el receptor acepta
-- cualquiera. No sirve aquí: el token SSO es una firma única (`cuerpo.firma`, no
-- admite lista) y el `X-Membego-Firma` de los satélites en producción se lee
-- como UN valor. Meterle una lista rompería a quien ya funciona.
--
-- Así que el solape es al revés: lo SALIENTE se sigue firmando con `secreto`
-- (nada se rompe), y lo ENTRANTE se ACEPTA firmado con `secreto` O con
-- `secretoSiguiente` durante la ventana. El operador instala el nuevo en el
-- satélite y `promover` lo mueve a `secreto`. No hay lista, no hay corte.
--
-- Solo AÑADE dos columnas nullable. Idempotente, sin backfill.
-- ============================================================================

-- AlterTable
ALTER TABLE "sistemas_conectados"
    ADD COLUMN IF NOT EXISTS "secretoSiguiente" TEXT,
    ADD COLUMN IF NOT EXISTS "secretoSiguienteHasta" TIMESTAMP(3);
