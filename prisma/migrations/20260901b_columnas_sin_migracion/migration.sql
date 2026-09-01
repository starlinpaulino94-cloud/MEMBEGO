-- Tres columnas que el esquema declara y NINGUNA migración crea.
--
-- No son migraciones que se quedaran sin aplicar: es que no existen. La PR
-- #416 («flujos de acceso con setup de contraseña por token… y mejoras en
-- metas/reportes») editó `prisma/schema/` y no escribió el SQL. Aunque el
-- despliegue automático de migraciones estuviera configurado, no habría nada
-- que aplicar.
--
-- Detectado con el mismo comando del trabajo `esquema` del CI, aplicando las
-- 120 migraciones sobre una base vacía y comparando con el esquema:
--
--   [*] Changed the `vendedor_metas` table
--     [+] Added column `beneficio`
--   [*] Changed the `users` table
--     [+] Added column `establecerContrasenaExpira`
--     [+] Added column `establecerContrasenaToken`
--
-- POR QUÉ LAS DE `users` SON LAS GRAVES
--
-- Es el mismo mecanismo que rompió el registro de clientes el 17-08 con
-- `users.permisos`: un `find*` o un `create` de Prisma SIN `select` pide TODAS
-- las columnas escalares del modelo, las use el código o no. Con una ausente,
-- la consulta entera falla. Y `users` la tocan el registro, el login y cada
-- comprobación de permisos — o sea, la aplicación entera, no la función nueva.
--
-- TIPOS
--
-- `beneficio` y `establecerContrasenaToken` son `String?` sin `@db.VarChar`,
-- que en Prisma es TEXT. `establecerContrasenaExpira` lleva `@db.Timestamptz()`
-- explícito en el modelo, así que va TIMESTAMPTZ y no TIMESTAMP(3): poner el
-- otro dejaría el diff viendo un cambio pendiente para siempre, que es
-- exactamente el estado del que venimos.
--
-- IDEMPOTENTE, para poder aplicarla también a mano en producción. Las tres
-- admiten nulos: no toca una sola fila de datos.
ALTER TABLE "vendedor_metas" ADD COLUMN IF NOT EXISTS "beneficio" TEXT;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "establecerContrasenaToken"  TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "establecerContrasenaExpira" TIMESTAMPTZ;
