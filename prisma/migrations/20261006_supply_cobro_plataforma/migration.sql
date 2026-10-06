--- Membego Supply · cobro a nombre de la PLATAFORMA (Fases 22-23).
---
--- ────────────────────────────────────────────────────────────────────────────
--- QUÉ CIERRA
---
--- El último hueco del módulo. Membego podía comprar 1.000 pizzas, asignarlas,
--- regalarlas y verlas redimir, pero no podía VENDER una: cobrar exigía cobrar
--- a nombre de Membego, y toda la infraestructura de pagos cobra a nombre de
--- una EMPRESA (`PaymentContext.companyId`, `metodos_pago.companyId`, y el
--- proveedor de transferencia que dice «a las cuentas de la empresa»).
---
--- ────────────────────────────────────────────────────────────────────────────
--- POR QUÉ ESTAS DOS TABLAS NO LLEVAN companyId
---
--- No es un olvido. Un pedido de un cliente a Membego no es de ninguna empresa:
---
---   · no es del proveedor, que no debe ver a qué precio revende Membego lo que
---     le vendió a RD$300 — es información de contrato ajeno;
---   · no es de la empresa donde el cliente tiene su ficha, que no participa en
---     esta compra. Poner `companyId` ahí repetiría el fallo que se encontró en
---     `supply_derechos` el 25-09: la derivación de políticas RLS habría atado
---     el pedido a la empresa equivocada.
---
--- Se acceden con `sinEmpresa()` y motivo escrito, como el resto del módulo.
--- Quedan FUERA de la cobertura automática de RLS por no tener camino a
--- `companies`, así que hay que declararlas a mano en la Capa 2. Lo comprueba
--- `npm run rls:preflight`, que las nombrará si alguien lo olvida.
---
--- ────────────────────────────────────────────────────────────────────────────
--- MARCHA ATRÁS
---
---   DROP TABLE "supply_pedidos";
---   DROP TABLE "supply_cuentas_cobro";
---   DROP TYPE  "SupplyPedidoEstado";
---
--- Ninguna fila de otro módulo depende de ellas. Solo creación: cero ALTER
--- sobre tablas vivas, cero DROP, cero DELETE.

-- ── 1. El estado del pedido ─────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE "SupplyPedidoEstado" AS ENUM (
    'INICIADO', 'EN_REVISION', 'PAGADO', 'RECHAZADO', 'EXPIRADO', 'CANCELADO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Las cuentas de cobro de Membego ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supply_cuentas_cobro" (
  "id"            TEXT NOT NULL,
  "tipo"          "MetodoPagoTipo" NOT NULL,
  "nombre"        TEXT NOT NULL,
  "titular"       TEXT,
  "numeroCuenta"  TEXT,
  "tipoCuenta"    TEXT,
  "instrucciones" TEXT,
  "moneda"        TEXT NOT NULL DEFAULT 'DOP',
  "activa"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supply_cuentas_cobro_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supply_cuentas_cobro_activa_idx"
  ON "supply_cuentas_cobro"("activa");

-- ── 3. El pedido del cliente a Membego ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supply_pedidos" (
  "id"                TEXT NOT NULL,
  "numero"            TEXT NOT NULL,
  "estado"            "SupplyPedidoEstado" NOT NULL DEFAULT 'INICIADO',
  "clienteId"         TEXT NOT NULL,
  "derechoId"         TEXT NOT NULL,
  "monto"             DECIMAL(12,2) NOT NULL,
  "moneda"            TEXT NOT NULL DEFAULT 'DOP',
  "cuentaId"          TEXT,
  "comprobanteUrl"    TEXT,
  "comprobanteNota"   TEXT,
  "comprobanteAt"     TIMESTAMP(3),
  "revisadoPor"       TEXT,
  "revisadoAt"        TIMESTAMP(3),
  "motivoRechazo"     TEXT,
  "expiraAt"          TIMESTAMP(3) NOT NULL,
  "claveIdempotencia" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supply_pedidos_pkey" PRIMARY KEY ("id")
);

-- El número y la clave de idempotencia son únicos: una petición repetida no
-- abre un segundo pedido ni retiene una segunda unidad.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_pedidos_numero_key"
  ON "supply_pedidos"("numero");
CREATE UNIQUE INDEX IF NOT EXISTS "supply_pedidos_claveIdempotencia_key"
  ON "supply_pedidos"("claveIdempotencia");

-- UN pedido por derecho retenido. Sin esto, dos pedidos podrían pelearse la
-- misma unidad apartada y los dos creerse con derecho a cobrarla.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_pedidos_derechoId_key"
  ON "supply_pedidos"("derechoId");

CREATE INDEX IF NOT EXISTS "supply_pedidos_estado_expiraAt_idx"
  ON "supply_pedidos"("estado", "expiraAt");
CREATE INDEX IF NOT EXISTS "supply_pedidos_clienteId_estado_idx"
  ON "supply_pedidos"("clienteId", "estado");
-- La cola de revisión: lo que espera a que Membego lo mire, lo más viejo
-- primero. Parcial porque solo se consulta un estado.
CREATE INDEX IF NOT EXISTS "supply_pedidos_cola_revision_idx"
  ON "supply_pedidos"("comprobanteAt")
  WHERE "estado" = 'EN_REVISION';

-- ── 4. Las claves foráneas ──────────────────────────────────────────────────
--
-- Todas RESTRICT: un pedido es historia financiera. Si alguien borra al cliente
-- o al derecho, esto se para y obliga a decidir a mano (Fase 63).
DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_clienteId_fkey"
    FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_derechoId_fkey"
    FOREIGN KEY ("derechoId") REFERENCES "supply_derechos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "supply_cuentas_cobro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_revisadoPor_fkey"
    FOREIGN KEY ("revisadoPor") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. Los invariantes, en la base ──────────────────────────────────────────
--
-- Un `if` en el código no basta: dos peticiones a la vez lo pasan las dos, y un
-- script de madrugada no lo ejecuta. Estas cuatro reglas son sobre DINERO, así
-- que viven donde nadie las puede rodear.

-- Nunca un monto negativo.
DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_monto_valido" CHECK ("monto" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un pedido revisado dice SIEMPRE quién y cuándo. Media firma no es firma: sin
-- esto, un PAGADO sin revisor pasaría por bueno en la conciliación y nadie
-- podría preguntarle a nadie por ese dinero.
DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_revision_completa" CHECK (
      ("estado" IN ('PAGADO', 'RECHAZADO')) = ("revisadoPor" IS NOT NULL AND "revisadoAt" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Un rechazo dice por qué. Es lo único que el cliente va a leer.
DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_rechazo_motivado" CHECK (
      "estado" <> 'RECHAZADO' OR "motivoRechazo" IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- En revisión implica comprobante. El estado EN_REVISION existe justamente
-- porque hay algo que mirar.
DO $$
BEGIN
  ALTER TABLE "supply_pedidos"
    ADD CONSTRAINT "supply_pedidos_revision_con_comprobante" CHECK (
      "estado" <> 'EN_REVISION' OR ("comprobanteUrl" IS NOT NULL AND "comprobanteAt" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. El precio de venta vive en la asignación ─────────────────────────────
--
-- Único ALTER de esta migración, y es aditivo: columna nueva con DEFAULT, sobre
-- una tabla del propio módulo. Ninguna fila existente cambia de significado —
-- todo lo asignado hasta hoy se regalaba, y 0 es exactamente eso.
--
-- En la asignación y no en el lote porque el mismo lote se reparte a la vez
-- entre una campaña de bienvenida (gratis) y una oferta de pago (RD$399). El
-- precio es de la campaña, no de lo comprado.
ALTER TABLE "supply_asignaciones"
  ADD COLUMN IF NOT EXISTS "precioCliente" DECIMAL(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE "supply_asignaciones"
    ADD CONSTRAINT "supply_asignaciones_precio_valido" CHECK ("precioCliente" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 7. La bitácora ──────────────────────────────────────────────────────────
--
-- Tres acciones nuevas, distintas de `SUPPLY_PAGO_*`: esas son pagos de Membego
-- AL PROVEEDOR. Estas son pagos del CLIENTE A MEMBEGO. Compartir nombre entre
-- los dos lados del dinero es la clase de ahorro que luego hace que alguien
-- audite el flujo equivocado.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PEDIDO_ABIERTO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PEDIDO_COBRADO';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_PEDIDO_RECHAZADO';

-- ── 8. La bitácora del alta de cuentas ──────────────────────────────────────
--
-- Dar de alta una cuenta de cobro ENCIENDE la venta de supply, y desactivar la
-- última la apaga. Es una palanca de negocio, no configuración: queda con actor
-- y fecha como cualquier otro movimiento de dinero.
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CUENTA_COBRO_ALTA';
ALTER TYPE "AuditAccion" ADD VALUE IF NOT EXISTS 'SUPPLY_CUENTA_COBRO_ESTADO';
