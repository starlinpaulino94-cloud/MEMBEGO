-- Regalo VIP con el MISMO proceso de QR que las compras (14-08-2026).
-- El QR del regalo apunta al invitado de la oferta privada; el scanner lo
-- reconoce y canjea contra el cupo del período. Idempotente.

ALTER TABLE "qr_tokens" ADD COLUMN IF NOT EXISTS "ofertaInvitadoId" TEXT;

DO $$ BEGIN
  ALTER TABLE "qr_tokens"
    ADD CONSTRAINT "qr_tokens_ofertaInvitadoId_fkey"
    FOREIGN KEY ("ofertaInvitadoId") REFERENCES "oferta_invitados"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "qr_tokens_ofertaInvitadoId_idx"
  ON "qr_tokens"("ofertaInvitadoId");
