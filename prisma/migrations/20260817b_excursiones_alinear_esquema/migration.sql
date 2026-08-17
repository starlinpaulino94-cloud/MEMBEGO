-- Las tablas de Excursiones vuelven a alinearse con el esquema.
--
-- `20260817_excursiones_fundacion` dejó `DEFAULT CURRENT_TIMESTAMP` en once
-- columnas `updatedAt`, y nombró un índice a mano. El modelo declara
-- `updatedAt DateTime @updatedAt` —que en Prisma significa que el valor lo
-- escribe el cliente en cada `create` y cada `update`, SIN default en la base—
-- y deja los nombres de índice a Prisma. La diferencia deja `migrate diff`
-- viendo un cambio pendiente para siempre:
--
--   [*] Altered column `updatedAt` (default changed from `Some(Now)` to `None`)
--   [*] Renamed index `vendedor_atribuciones_embudo_idx` to
--       `vendedor_atribuciones_companyId_vendedorId_etapa_createdAt_idx`
--
-- Y mientras eso pase, el trabajo `esquema` del CI está en rojo: deja de poder
-- avisar de una migración que SÍ falte, que es exactamente para lo que existe.
-- Hoy, 17-08-2026, ese hueco dejó cinco migraciones sin aplicar en producción
-- y rompió el registro de clientes, el embudo de solicitudes, la reversión de
-- visitas y el QR del cliente y del cajero. El gate no es burocracia: es lo
-- único que lo detecta antes de que lo detecte un cliente.
--
-- ESTA ES LA TERCERA VEZ. `20260770_reconciliacion` quitó este mismo default
-- de quince tablas y dejó escrito el motivo; `20260820` lo quitó de
-- `solicitudes_empresa`, creada después, que volvió a traerlo. Ahora las de
-- Excursiones. El patrón se repite porque escribir la migración a mano invita
-- a poner el default «por si acaso», y Prisma no lo usa nunca.
--
-- Se quita el default en vez de añadir `@default(now())` a los modelos porque
-- TODAS las tablas del esquema usan `@updatedAt` a secas: la convención está
-- decidida, y la excepción aquí sería una tercera forma de escribir lo mismo.
--
-- SEGURA: ninguna consulta inserta en estas tablas por SQL crudo —todas pasan
-- por Prisma, que siempre escribe el valor—, así que quitar el default no
-- puede dejar un `NOT NULL` sin valor. No toca una sola fila de datos.
ALTER TABLE "comision_entradas"   ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "comision_reglas"     ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursion_variantes" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursiones"         ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "excursiones_config"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "liquidaciones"       ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "reservas_excursion"  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_bonos"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedor_metas"      ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "vendedores"          ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ventas_excursion"    ALTER COLUMN "updatedAt" DROP DEFAULT;

-- El índice: mismas columnas, el nombre que genera Prisma. Sin esto Prisma cree
-- que le falta y lo crearía DUPLICADO. Idempotente para poder correrlo también
-- a mano en producción, donde estas tablas ya existen.
DO $$ BEGIN
  ALTER INDEX "vendedor_atribuciones_embudo_idx"
    RENAME TO "vendedor_atribuciones_companyId_vendedorId_etapa_createdAt_idx";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
