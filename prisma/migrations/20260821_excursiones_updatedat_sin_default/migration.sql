-- Las tablas de Excursiones vuelven a alinearse con el esquema.
--
-- `20260817_excursiones_fundacion` creó once tablas con
-- `updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`, y los modelos
-- declaran `updatedAt DateTime @updatedAt` — que en Prisma significa que el
-- valor lo escribe el cliente en cada `create` y cada `update`, SIN default en
-- la base. Mientras esa diferencia exista, `prisma migrate diff` ve un cambio
-- pendiente para siempre y el trabajo `esquema` del CI está en rojo: deja de
-- poder avisar de una migración que SÍ falte, que es para lo que existe.
--
-- Es la MISMA corrección que ya se hizo dos veces: `20260770_reconciliacion`
-- para quince tablas y `20260820_solicitudes_updatedat_sin_default` para la de
-- solicitudes. La convención del esquema es `@updatedAt` a secas en las
-- veintidós tablas que lo usan, así que se quita el default en la base en vez
-- de añadir `@default(now())` al modelo.
--
-- Se aprovecha para renombrar el índice del embudo al nombre canónico que
-- Prisma deriva de sus columnas: el índice es el mismo, solo cambia su nombre.
--
-- SEGURA: no toca una sola fila de datos. Ninguna consulta inserta en estas
-- tablas por SQL crudo — todas pasan por Prisma, que siempre escribe el valor.

ALTER TABLE "excursiones"            ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursion_variantes"    ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedores"             ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_metas"         ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_bonos"         ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "reservas_excursion"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ventas_excursion"       ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "comision_reglas"        ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "comision_entradas"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "liquidaciones"          ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursiones_config"     ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER INDEX IF EXISTS "vendedor_atribuciones_embudo_idx"
  RENAME TO "vendedor_atribuciones_companyId_vendedorId_etapa_createdAt_idx";
