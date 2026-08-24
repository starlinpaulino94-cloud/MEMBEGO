-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNAS DE LA #391 QUE SE MEZCLARON SIN SU MIGRACIÓN
--
-- La #391 (perfiles B2B de operadores, crédito comercial, recogida en hotel y
-- ámbito TIPO_VENDEDOR en las reglas de comisión) declaró 14 columnas nuevas en
-- el esquema Prisma pero no trajo el SQL que las crea. Se mezcló con el check
-- «Esquema de base de datos» en ROJO — precisamente el que existe para cazar
-- esto.
--
-- La consecuencia es la misma que dejó el escáner de QR fuera de servicio en
-- agosto: el código desplegado consulta columnas que la base no tiene, y
-- Postgres responde 42703 (`column does not exist`). No falla al desplegar:
-- falla la primera vez que alguien abre la pantalla que las usa.
--
-- Todo aditivo y con IF NOT EXISTS: se puede ejecutar dos veces sin daño, y las
-- filas existentes quedan con los mismos valores por defecto que declara el
-- esquema.
-- ─────────────────────────────────────────────────────────────────────────────

-- Reglas de comisión: ámbito por TIPO de vendedor.
ALTER TABLE "comision_reglas"
  ADD COLUMN IF NOT EXISTS "tipoVendedor" TEXT;

-- Reservas: logística de recogida en hotel y tarifa neta de agencia.
ALTER TABLE "reservas_excursion"
  ADD COLUMN IF NOT EXISTS "habitacion"      TEXT,
  ADD COLUMN IF NOT EXISTS "horaRecogida"    TEXT,
  ADD COLUMN IF NOT EXISTS "hotelRecogida"   TEXT,
  ADD COLUMN IF NOT EXISTS "lobbyRecogida"   TEXT,
  ADD COLUMN IF NOT EXISTS "tarifaNetaTotal" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "voucherAgencia"  TEXT;

-- Vendedores: perfil B2B (razón social, RNC, facturación) y crédito comercial.
--
-- `modeloComercial` va NOT NULL con DEFAULT 'COMISION': es el modelo que
-- tienen hoy TODOS los vendedores existentes, así que el valor por defecto
-- reproduce el comportamiento actual y no cambia a nadie de modelo por sorpresa.
ALTER TABLE "vendedores"
  ADD COLUMN IF NOT EXISTS "diasCredito"      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "emailFacturacion" TEXT,
  ADD COLUMN IF NOT EXISTS "limiteCredito"    DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "modeloComercial"  TEXT NOT NULL DEFAULT 'COMISION',
  ADD COLUMN IF NOT EXISTS "prefijoVoucher"   TEXT,
  ADD COLUMN IF NOT EXISTS "razonSocial"      TEXT,
  ADD COLUMN IF NOT EXISTS "rnc"              TEXT;
