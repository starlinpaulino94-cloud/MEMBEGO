ALTER TABLE "pago_intentos"
  ADD COLUMN "cardnetUniqueId" TEXT;

CREATE UNIQUE INDEX "pago_intentos_cardnetUniqueId_key"
  ON "pago_intentos"("cardnetUniqueId");

ALTER TABLE "tarjetas_tokenizadas"
  ADD COLUMN "cardnetCaptureSessionId" TEXT;
CREATE UNIQUE INDEX "tarjetas_tokenizadas_cardnetCaptureSessionId_key"
  ON "tarjetas_tokenizadas"("cardnetCaptureSessionId");

DO $$ BEGIN
  ALTER TABLE "pago_intentos"
    ADD CONSTRAINT "pago_intentos_target_xor_check"
    CHECK (("membershipId" IS NULL) <> ("compraId" IS NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE "cardnet_capture_sessions" (
  "id" TEXT NOT NULL,
  "authSubject" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "customerId" TEXT,
  "membershipId" TEXT,
  "compraId" TEXT,
  "monto" DECIMAL(10,2) NOT NULL,
  "moneda" TEXT NOT NULL DEFAULT 'DOP',
  "estado" TEXT NOT NULL DEFAULT 'STARTING',
  "reservaClienteKey" TEXT,
  "captureNonce" TEXT,
  "captureUrl" TEXT,
  "scriptUrl" TEXT,
  "publicKey" TEXT,
  "customerUniqueId" TEXT,
  "perfilBase" JSONB,
  "paymentProfileId" TEXT,
  "guardarRenovacion" BOOLEAN NOT NULL DEFAULT FALSE,
  "purchaseIntentId" TEXT,
  "capturadoAt" TIMESTAMP(3),
  "perfilLeidoAt" TIMESTAMP(3),
  "conciliadoAt" TIMESTAMP(3),
  "asociadoAt" TIMESTAMP(3),
  "venceAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cardnet_capture_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cardnet_capture_sessions_target_xor_check"
    CHECK (("membershipId" IS NULL) <> ("compraId" IS NULL)),
  CONSTRAINT "cardnet_capture_sessions_state_check"
    CHECK ("estado" IN (
      'STARTING', 'CAPTURE_OPEN', 'CAPTURE_CONSUMED', 'PROFILE_PENDING',
      'ACTIVATION_REQUIRED', 'ACTIVATION_PROCESSING', 'PURCHASE_PENDING',
      'FULFILLMENT_PENDING', 'ASSOCIATION_PENDING', 'APPROVED', 'DECLINED',
      'EXPIRED', 'FAILED'
    ))
);

CREATE UNIQUE INDEX "cardnet_capture_sessions_reservaClienteKey_key"
  ON "cardnet_capture_sessions"("reservaClienteKey");
CREATE UNIQUE INDEX "cardnet_capture_sessions_purchaseIntentId_key"
  ON "cardnet_capture_sessions"("purchaseIntentId");
CREATE INDEX "cardnet_capture_sessions_authSubject_createdAt_idx"
  ON "cardnet_capture_sessions"("authSubject", "createdAt");
CREATE INDEX "cardnet_capture_sessions_companyId_clienteId_estado_idx"
  ON "cardnet_capture_sessions"("companyId", "clienteId", "estado");
CREATE INDEX "cardnet_capture_sessions_estado_venceAt_idx"
  ON "cardnet_capture_sessions"("estado", "venceAt");

DO $$ BEGIN
  ALTER TABLE "cardnet_capture_sessions"
    ADD CONSTRAINT "cardnet_capture_sessions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cardnet_capture_sessions"
    ADD CONSTRAINT "cardnet_capture_sessions_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cardnet_capture_sessions"
    ADD CONSTRAINT "cardnet_capture_sessions_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cardnet_capture_sessions"
    ADD CONSTRAINT "cardnet_capture_sessions_compraId_fkey"
    FOREIGN KEY ("compraId") REFERENCES "producto_compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cardnet_capture_sessions"
    ADD CONSTRAINT "cardnet_capture_sessions_purchaseIntentId_fkey"
    FOREIGN KEY ("purchaseIntentId") REFERENCES "pago_intentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tarjetas_tokenizadas"
    ADD CONSTRAINT "tarjetas_tokenizadas_cardnetCaptureSessionId_fkey"
    FOREIGN KEY ("cardnetCaptureSessionId") REFERENCES "cardnet_capture_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
