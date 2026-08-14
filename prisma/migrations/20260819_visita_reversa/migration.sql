-- Reversa de una visita: deshacer un canje y devolverle el lavado al cliente.
--
-- Faltaba, y se notaba desde fuera: un satélite que cobra el lavado con
-- `POST /redemptions` y después anula la factura dejaba al cliente sin ese
-- lavado para siempre. No había forma de devolvérselo salvo tocando la base a
-- mano, que es exactamente lo que una API existe para evitar.
--
-- Una visita revertida NO se borra: se marca. Borrarla dejaría el saldo
-- cuadrado y el historial mintiendo — el lavado se registró, y que después se
-- anulara la factura que lo cobraba es un hecho posterior, no una razón para
-- fingir que nunca ocurrió. Es además lo único que permite responder «¿por qué
-- a este cliente le sobra un lavado?» tres meses después.
--
-- TODO es aditivo y anulable: ninguna columna existente cambia de tipo ni de
-- obligatoriedad, y las visitas que ya están en la tabla quedan con
-- `revertidaAt` NULL, que es «visita normal».
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaAt"         TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaMotivo"     TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaPorId"      TEXT;
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "revertidaPorSistema" TEXT;

-- ON DELETE SET NULL: si algún día se borra el usuario que revirtió, la reversa
-- sigue existiendo. Perder el rastro entero por dar de baja a un empleado sería
-- justo lo contrario de lo que estas columnas vienen a resolver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visits_revertidaPorId_fkey'
  ) THEN
    ALTER TABLE "visits"
      ADD CONSTRAINT "visits_revertidaPorId_fkey"
      FOREIGN KEY ("revertidaPorId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Índice PARCIAL: las revertidas son y deben ser una minoría diminuta frente a
-- los millones de filas de `visits`. Un índice completo pagaría por todas las
-- normales para encontrar las pocas raras.
CREATE INDEX IF NOT EXISTS "visits_revertidas_idx"
  ON "visits" ("revertidaAt")
  WHERE "revertidaAt" IS NOT NULL;

-- La bitácora la distingue de confirmar una visita: se pregunta por ella sola.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'VISITA_REVERTIDA';
