-- ============================================================================
-- CUÁNDO TOCA EL SIGUIENTE INTENTO  ·  auditoría de integraciones, hallazgo A-1
-- ============================================================================
--
-- Las dos colas de salida —`eventos_salientes` (satélites) y `entregas_webhook`
-- (empresas)— guardaban CUÁNTAS veces se había intentado una entrega y nunca
-- CUÁNDO tocaba la siguiente. Con esa información faltando solo cabía una
-- política: reintentarlo todo cada vez que alguien barriera. Y como el único
-- que barría era el cron diario (`vercel.json`, 13:00 UTC), un receptor caído
-- treinta segundos le costaba a su cliente veinticuatro horas, y agotar los
-- ocho intentos llevaba ocho días.
--
-- Con esta columna, cada fallo programa su propio reintento en la cola con
-- espera creciente (30 s → 2 m → 10 m → 30 m → 2 h → 6 h → 24 h) y el cron pasa
-- de ser quien reintenta a ser la red de seguridad: recoge lo que no se pudo
-- programar.
--
-- ---------------------------------------------------------------------------
-- NULL SIGNIFICA «YA TOCABA», Y POR ESO NO HAY RELLENO
--
-- Las filas que existan al aplicar esto quedan con NULL, y el barrido trata
-- NULL como vencido. O sea: las entregas que estaban en cola siguen tratándose
-- exactamente igual que antes de esta migración. No hay ventana en la que algo
-- deje de reintentarse por haber añadido la columna, y no hace falta tocar ni
-- una fila existente.
--
-- Lo mismo vale para el camino de degradación: sin QStash configurado, nadie
-- escribe la fecha, todas las filas quedan en NULL y el sistema se comporta
-- como el de ayer. El peor caso de la versión nueva es el caso normal de la
-- vieja.
--
-- Solo AÑADE: dos columnas nullable y dos índices. Idempotente.
-- ============================================================================

-- AlterTable
ALTER TABLE "eventos_salientes" ADD COLUMN IF NOT EXISTS "proximoIntentoAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "entregas_webhook" ADD COLUMN IF NOT EXISTS "proximoIntentoAt" TIMESTAMP(3);

-- CreateIndex
-- El barrido pregunta por las dos columnas JUNTAS («pendientes y vencidas»).
-- Con el índice de `[estado, createdAt]` que ya existía habría que leer todas
-- las pendientes para descartar las que aún no tocan — que es justo lo que pasa
-- cuando un satélite lleva una semana caído y la cola es grande.
CREATE INDEX IF NOT EXISTS "eventos_salientes_estado_proximoIntentoAt_idx"
  ON "eventos_salientes"("estado", "proximoIntentoAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "entregas_webhook_estado_proximoIntentoAt_idx"
  ON "entregas_webhook"("estado", "proximoIntentoAt");
