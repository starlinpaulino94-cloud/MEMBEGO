-- Tokens QR: caducidad y fin de `cuid()` como valor por defecto
-- (auditoría de producción · A-02).
--
-- El token venía de `@default(cuid())`. cuid está hecho para no COLISIONAR, no
-- para no ADIVINARSE: es marca de tiempo + contador + huella de máquina + cuatro
-- caracteres al azar. Conocidos dos tokens del mismo servidor, el espacio de
-- búsqueda del siguiente se reduce mucho.
--
-- Un token QR no es un identificador: es una credencial al portador. Vale un
-- lavado, se manda por WhatsApp y se fotografía. Desde ahora lo genera la
-- aplicación con 24 bytes de `randomBytes` (ver src/modules/qr/token.ts).
--
-- ADITIVA Y SIN ROMPER NADA: los tokens ya emitidos se quedan como están y
-- siguen funcionando. Solo se les pone fecha de caducidad — 90 días desde
-- ahora, no desde su creación, para no invalidar de golpe el QR que un cliente
-- lleva hoy en el teléfono.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente.

ALTER TABLE "qr_tokens" ADD COLUMN IF NOT EXISTS "expiraAt" TIMESTAMP(3);

-- Índice para la limpieza periódica de tokens vencidos.
CREATE INDEX IF NOT EXISTS "qr_tokens_expiraAt_idx" ON "qr_tokens" ("expiraAt");

-- Fecha para los tokens que ya existen y siguen activos. Los inactivos (ya
-- canjeados) se dejan en NULL: no hay nada que caducar.
UPDATE "qr_tokens"
   SET "expiraAt" = now() + interval '90 days'
 WHERE "expiraAt" IS NULL
   AND "activo" = true;

-- El DEFAULT desaparece: a partir de ahora el token SIEMPRE lo pone la
-- aplicación. Si algún día alguien inserta a mano sin token, que falle en el
-- acto y no genere en silencio uno adivinable.
ALTER TABLE "qr_tokens" ALTER COLUMN "token" DROP DEFAULT;

-- ── Verificación ───────────────────────────────────────────────────────────
-- (a) La columna existe y el DEFAULT se fue.
SELECT column_name, column_default
  FROM information_schema.columns
 WHERE table_name = 'qr_tokens' AND column_name IN ('token', 'expiraAt');

-- (b) Ningún token activo se quedó sin fecha de caducidad.
SELECT count(*) AS activos_sin_caducidad
  FROM "qr_tokens" WHERE "activo" = true AND "expiraAt" IS NULL;
