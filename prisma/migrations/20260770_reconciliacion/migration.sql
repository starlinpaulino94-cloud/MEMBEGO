-- ─────────────────────────────────────────────────────────────────────────────
-- RECONCILIACIÓN · alinear la base con el esquema
--
-- QUÉ ES ESTO
--
-- El último trozo del arreglo del historial de migraciones. Con la migración
-- génesis (`0_genesis`) y la de reparación (`20260713b_invitaciones_campanas`),
-- las 71 migraciones ya se reproducen enteras sobre una base vacía y crean las
-- 112 tablas. Lo que quedaba eran DIFERENCIAS DE FORMA entre lo que el SQL
-- escrito a mano dejó en la base y lo que declara `prisma/schema/`:
--
--   · 37 claves foráneas con el mismo destino pero distinta regla ON DELETE
--     o distinto nombre. Esto SÍ importa: una FK declarada CASCADE en el
--     esquema y RESTRICT en la base hace que borrar una empresa falle en
--     producción y funcione en desarrollo.
--   · 21 columnas con diferencias de tipo o de DEFAULT. Las de `updatedAt` son
--     el caso típico: el SQL manual les puso `DEFAULT CURRENT_TIMESTAMP` y
--     Prisma no lo usa (escribe el valor él mismo). Y varios `VARCHAR(n)` que
--     el esquema declara como `String` (TEXT).
--   · 12 índices con nombre `idx_*` en vez del que genera Prisma. Sin esto,
--     Prisma cree que faltan y los volvería a crear DUPLICADOS.
--   · 3 índices que existen en la base y ya no están en el esquema.
--
-- POR QUÉ HAY QUE APLICARLA EN PRODUCCIÓN
--
-- Porque producción se construyó igual que la copia con la que se calculó esta
-- diferencia: a mano. Estas mismas discrepancias están allí. Mientras existan,
-- `prisma migrate diff` seguirá viendo cambios pendientes y el trabajo
-- `esquema` del CI no puede decir la verdad.
--
-- IDEMPOTENTE Y SEGURA DE REPETIR. Todo va con `IF EXISTS` / `IF NOT EXISTS` o
-- dentro de un bloque que comprueba antes. No borra ni modifica una sola fila
-- de datos: solo toca definiciones.
--
-- LO ÚNICO QUE MERECE UNA VENTANA TRANQUILA: durante el instante en que una
-- clave foránea se borra y se vuelve a crear, esa integridad referencial no
-- está vigente. Son milisegundos por clave, pero no es momento de hacerlo un
-- sábado a mediodía.
-- ─────────────────────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "activos" DROP CONSTRAINT IF EXISTS "activos_companyId_fkey";

-- DropForeignKey
ALTER TABLE "cargos_cuenta" DROP CONSTRAINT IF EXISTS "cargos_cuenta_colaId_fkey";

-- DropForeignKey
ALTER TABLE "cargos_cuenta" DROP CONSTRAINT IF EXISTS "cargos_cuenta_cuentaId_fkey";

-- DropForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_colaId_fkey";

-- DropForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_companyId_fkey";

-- DropForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_userId_fkey";

-- DropForeignKey
ALTER TABLE "company_ratings" DROP CONSTRAINT IF EXISTS "company_ratings_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "company_ratings" DROP CONSTRAINT IF EXISTS "company_ratings_companyId_fkey";

-- DropForeignKey
ALTER TABLE "company_to_categories" DROP CONSTRAINT IF EXISTS "company_to_categories_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "company_to_categories" DROP CONSTRAINT IF EXISTS "company_to_categories_companyId_fkey";

-- DropForeignKey
ALTER TABLE "cuenta_vehiculos" DROP CONSTRAINT IF EXISTS "cuenta_vehiculos_cuentaId_fkey";

-- DropForeignKey
ALTER TABLE "cuenta_vehiculos" DROP CONSTRAINT IF EXISTS "cuenta_vehiculos_vehiculoId_fkey";

-- DropForeignKey
ALTER TABLE "cuentas_corporativas" DROP CONSTRAINT IF EXISTS "cuentas_corporativas_companyId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_colaId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_companyId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_reportadaPorId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_responsableId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_rewashColaId_fkey";

-- DropForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_vehiculoId_fkey";

-- DropForeignKey
ALTER TABLE "mantenimientos" DROP CONSTRAINT IF EXISTS "mantenimientos_activoId_fkey";

-- DropForeignKey
ALTER TABLE "mantenimientos" DROP CONSTRAINT IF EXISTS "mantenimientos_hechoPorId_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_companyId_fkey";

-- DropForeignKey
ALTER TABLE "movimientos_inventario" DROP CONSTRAINT IF EXISTS "movimientos_inventario_ordenCompraId_fkey";

-- DropForeignKey
ALTER TABLE "orden_compra_lineas" DROP CONSTRAINT IF EXISTS "orden_compra_lineas_ordenId_fkey";

-- DropForeignKey
ALTER TABLE "orden_compra_lineas" DROP CONSTRAINT IF EXISTS "orden_compra_lineas_productoId_fkey";

-- DropForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_companyId_fkey";

-- DropForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_creadaPorId_fkey";

-- DropForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_proveedorId_fkey";

-- DropForeignKey
ALTER TABLE "productos_inventario" DROP CONSTRAINT IF EXISTS "productos_inventario_proveedorId_fkey";

-- DropForeignKey
ALTER TABLE "proveedores" DROP CONSTRAINT IF EXISTS "proveedores_companyId_fkey";

-- DropForeignKey
ALTER TABLE "qr_tokens" DROP CONSTRAINT IF EXISTS "qr_tokens_membresiaId_fkey";

-- DropForeignKey
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_companyId_fkey";

-- DropForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_cerradoPorId_fkey";

-- DropForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_companyId_fkey";

-- DropForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_userId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "cola_vehiculos_bahiaId_idx";

-- DropIndex
DROP INDEX IF EXISTS "producto_compras_campanaPasoId_idx";

-- DropIndex
DROP INDEX IF EXISTS "promociones_visibilidad_archivada_idx";

-- AlterTable
ALTER TABLE "activos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bahias" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "business_categories" ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "slug" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "campana_inscripciones" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "campana_pasos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "campanas_globales" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cargos_cuenta" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cola_vehiculos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "comisiones" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "provincia" SET DATA TYPE TEXT,
ALTER COLUMN "pais" SET DATA TYPE TEXT,
ALTER COLUMN "whatsapp" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "cuentas_corporativas" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "incidencias" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ordenes_compra" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pago_intentos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "productos_inventario" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "promociones" ALTER COLUMN "slug" SET DATA TYPE TEXT,
ALTER COLUMN "tipo" SET DATA TYPE TEXT,
ALTER COLUMN "codigo" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "proveedores" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "servicio_precios" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "servicios" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tipos_vehiculo" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "turnos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "productos_inventario" DROP CONSTRAINT IF EXISTS "productos_inventario_proveedorId_fkey";
ALTER TABLE "productos_inventario" ADD CONSTRAINT "productos_inventario_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" DROP CONSTRAINT IF EXISTS "movimientos_inventario_ordenCompraId_fkey";
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ordenCompraId_fkey" FOREIGN KEY ("ordenCompraId") REFERENCES "ordenes_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_corporativas" DROP CONSTRAINT IF EXISTS "cuentas_corporativas_companyId_fkey";
ALTER TABLE "cuentas_corporativas" ADD CONSTRAINT "cuentas_corporativas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_vehiculos" DROP CONSTRAINT IF EXISTS "cuenta_vehiculos_cuentaId_fkey";
ALTER TABLE "cuenta_vehiculos" ADD CONSTRAINT "cuenta_vehiculos_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuenta_vehiculos" DROP CONSTRAINT IF EXISTS "cuenta_vehiculos_vehiculoId_fkey";
ALTER TABLE "cuenta_vehiculos" ADD CONSTRAINT "cuenta_vehiculos_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_cuenta" DROP CONSTRAINT IF EXISTS "cargos_cuenta_cuentaId_fkey";
ALTER TABLE "cargos_cuenta" ADD CONSTRAINT "cargos_cuenta_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_corporativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos_cuenta" DROP CONSTRAINT IF EXISTS "cargos_cuenta_colaId_fkey";
ALTER TABLE "cargos_cuenta" ADD CONSTRAINT "cargos_cuenta_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_companyId_fkey";
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_colaId_fkey";
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comisiones" DROP CONSTRAINT IF EXISTS "comisiones_userId_fkey";
ALTER TABLE "comisiones" ADD CONSTRAINT "comisiones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_companyId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_colaId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_colaId_fkey" FOREIGN KEY ("colaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_rewashColaId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_rewashColaId_fkey" FOREIGN KEY ("rewashColaId") REFERENCES "cola_vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_clienteId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_vehiculoId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_reportadaPorId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_reportadaPorId_fkey" FOREIGN KEY ("reportadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidencias" DROP CONSTRAINT IF EXISTS "incidencias_responsableId_fkey";
ALTER TABLE "incidencias" ADD CONSTRAINT "incidencias_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores" DROP CONSTRAINT IF EXISTS "proveedores_companyId_fkey";
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_companyId_fkey";
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_proveedorId_fkey";
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_compra" DROP CONSTRAINT IF EXISTS "ordenes_compra_creadaPorId_fkey";
ALTER TABLE "ordenes_compra" ADD CONSTRAINT "ordenes_compra_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_lineas" DROP CONSTRAINT IF EXISTS "orden_compra_lineas_ordenId_fkey";
ALTER TABLE "orden_compra_lineas" ADD CONSTRAINT "orden_compra_lineas_ordenId_fkey" FOREIGN KEY ("ordenId") REFERENCES "ordenes_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra_lineas" DROP CONSTRAINT IF EXISTS "orden_compra_lineas_productoId_fkey";
ALTER TABLE "orden_compra_lineas" ADD CONSTRAINT "orden_compra_lineas_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos_inventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activos" DROP CONSTRAINT IF EXISTS "activos_companyId_fkey";
ALTER TABLE "activos" ADD CONSTRAINT "activos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" DROP CONSTRAINT IF EXISTS "mantenimientos_activoId_fkey";
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_activoId_fkey" FOREIGN KEY ("activoId") REFERENCES "activos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" DROP CONSTRAINT IF EXISTS "mantenimientos_hechoPorId_fkey";
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_hechoPorId_fkey" FOREIGN KEY ("hechoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_companyId_fkey";
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_userId_fkey";
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" DROP CONSTRAINT IF EXISTS "turnos_cerradoPorId_fkey";
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_cerradoPorId_fkey" FOREIGN KEY ("cerradoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_to_categories" DROP CONSTRAINT IF EXISTS "company_to_categories_companyId_fkey";
ALTER TABLE "company_to_categories" ADD CONSTRAINT "company_to_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_to_categories" DROP CONSTRAINT IF EXISTS "company_to_categories_categoryId_fkey";
ALTER TABLE "company_to_categories" ADD CONSTRAINT "company_to_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "business_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ratings" DROP CONSTRAINT IF EXISTS "company_ratings_companyId_fkey";
ALTER TABLE "company_ratings" ADD CONSTRAINT "company_ratings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ratings" DROP CONSTRAINT IF EXISTS "company_ratings_clienteId_fkey";
ALTER TABLE "company_ratings" ADD CONSTRAINT "company_ratings_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_companyId_fkey";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_tokens" DROP CONSTRAINT IF EXISTS "qr_tokens_membresiaId_fkey";
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_membresiaId_fkey" FOREIGN KEY ("membresiaId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_companyId_fkey";
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_events" DROP CONSTRAINT IF EXISTS "referral_events_clienteId_fkey";
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_business_categories_active_order' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'business_categories_active_order_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_business_categories_active_order" RENAME TO "business_categories_active_order_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_companies_city_province' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies_ciudad_provincia_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_companies_city_province" RENAME TO "companies_ciudad_provincia_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_companies_created' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies_createdAt_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_companies_created" RENAME TO "companies_createdAt_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_companies_published_featured' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies_isPublished_isFeatured_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_companies_published_featured" RENAME TO "companies_isPublished_isFeatured_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_companies_type' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'companies_type_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_companies_type" RENAME TO "companies_type_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_company_ratings_companyId' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'company_ratings_companyId_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_company_ratings_companyId" RENAME TO "company_ratings_companyId_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_company_ratings_rating' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'company_ratings_rating_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_company_ratings_rating" RENAME TO "company_ratings_rating_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_company_to_categories_categoryId' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'company_to_categories_categoryId_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_company_to_categories_categoryId" RENAME TO "company_to_categories_categoryId_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_company_to_categories_companyId' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'company_to_categories_companyId_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_company_to_categories_companyId" RENAME TO "company_to_categories_companyId_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_promociones_created_at' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'promociones_createdAt_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_promociones_created_at" RENAME TO "promociones_createdAt_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_promociones_featured' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'promociones_isFeatured_vigenciaHasta_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_promociones_featured" RENAME TO "promociones_isFeatured_vigenciaHasta_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_promociones_tipo' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'promociones_tipo_idx' AND relkind = 'i') THEN
    ALTER INDEX "idx_promociones_tipo" RENAME TO "promociones_tipo_idx";
  END IF;
END $$;
