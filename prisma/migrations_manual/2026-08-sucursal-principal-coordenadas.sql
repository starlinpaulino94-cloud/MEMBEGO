-- Copia el punto del mapa de la EMPRESA a su SUCURSAL PRINCIPAL.
--
-- POR QUÉ HACE FALTA: `companies.latitud/longitud` y `sucursales.latitud/
-- longitud` son campos distintos. El dueño colocaba el pin en /admin/perfil,
-- se guardaba en la empresa, y la sucursal principal se quedaba en NULL.
-- "Cerca de mí" consulta SUCURSALES y exige coordenadas, así que el negocio
-- no aparecía nunca en el mapa — sin error y sin nada que el admin pudiera
-- hacer desde esa pantalla. El mapa decía "0 negocios", que es exactamente lo
-- que diría si de verdad no hubiera ninguno cerca.
--
-- El código ya no lo repite (`ensureSucursalPrincipal` copia el punto al
-- guardar el perfil). Esto es solo la puesta al día de las empresas que ya
-- quedaron con la sucursal sin coordenadas.
--
-- SEGURIDAD: solo RELLENA huecos. Nunca pisa una sucursal que ya tenga su
-- punto puesto —las que el admin colocó a mano en /admin/sucursales se quedan
-- como están— y solo toca la sucursal llamada 'Sucursal principal', que es la
-- que crea el sistema. La columna PostGIS `location` se sincroniza sola: su
-- trigger es BEFORE INSERT OR UPDATE OF latitud, longitud.

BEGIN;

UPDATE "sucursales" s
SET    latitud  = c.latitud,
       longitud = c.longitud
FROM   "companies" c
WHERE  s."companyId" = c.id
  AND  s.nombre = 'Sucursal principal'
  AND  (s.latitud IS NULL OR s.longitud IS NULL)
  AND  c.latitud IS NOT NULL
  AND  c.longitud IS NOT NULL;

-- Verificación: cuántas sucursales quedan sin punto y cuántas ya lo tienen.
-- `sin_punto` > 0 no es necesariamente un fallo: son empresas cuyo dueño
-- todavía no ha marcado su ubicación en el perfil. Esas no pueden salir en el
-- mapa hasta que la marquen.
SELECT count(*) FILTER (WHERE latitud IS NOT NULL AND longitud IS NOT NULL) AS con_punto,
       count(*) FILTER (WHERE latitud IS NULL OR longitud IS NULL)          AS sin_punto,
       count(*) FILTER (WHERE "mostrarEnMapa" = false)                      AS ocultas_del_mapa,
       count(*)                                                             AS total
FROM   "sucursales";

COMMIT;
