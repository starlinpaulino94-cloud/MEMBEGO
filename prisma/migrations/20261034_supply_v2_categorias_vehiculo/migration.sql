-- MEMBEGO SUPPLY 2.0 · categorías de vehículo de PLATAFORMA.
--
-- Un lavado no cuesta lo mismo en un sedán que en una camioneta, y una oferta
-- de Supply necesita poder decir «la SUV cuesta X». Pero un proveedor de Supply
-- puede ser EXTERNO y no tener empresa en Membego, así que no hay un
-- `tipos_vehiculo` suyo al que colgar el precio. Esta tabla es el catálogo
-- único con el que Membego habla de vehículos.
--
-- Se casa con las categorías de cada empresa por `nivelTarifario`, el mismo
-- número que usa `tipos_vehiculo` y que el proyecto declara el contrato —nunca
-- el nombre—. Una empresa puede llamar «Jeepeta» a lo que otra llama «SUV»; si
-- las dos lo pusieron en nivel 2, las dos cobran el precio del nivel 2.
--
-- SIN enums nuevos, así que una sola migración: no hay ningún `ALTER TYPE ...
-- ADD VALUE` que obligue a separarla.
--
-- ADITIVA E IDEMPOTENTE. No toca ninguna tabla existente y, por sí sola, no
-- cambia ni un precio: en esta fase nadie lee todavía estas filas para cobrar.

CREATE TABLE IF NOT EXISTS "supply_v2_vehicle_categories" (
  "id"             TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "nombre"         TEXT NOT NULL,
  "nivelTarifario" INTEGER NOT NULL,
  "orden"          INTEGER NOT NULL DEFAULT 0,
  "activo"         BOOLEAN NOT NULL DEFAULT true,
  "descripcion"    TEXT,
  "iconoUrl"       TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supply_v2_vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- `nivelTarifario` ÚNICO a propósito: la resolución va nivel → categoría. Dos
-- filas con el mismo nivel la harían ambigua y el checkout tendría que elegir
-- una por orden de llegada, que es la clase de cosa que cobra distinto según
-- el plan de consulta.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_vehicle_categories_code_key"
  ON "supply_v2_vehicle_categories" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_vehicle_categories_nombre_key"
  ON "supply_v2_vehicle_categories" ("nombre");
CREATE UNIQUE INDEX IF NOT EXISTS "supply_v2_vehicle_categories_nivelTarifario_key"
  ON "supply_v2_vehicle_categories" ("nivelTarifario");
CREATE INDEX IF NOT EXISTS "supply_v2_vehicle_categories_activo_orden_idx"
  ON "supply_v2_vehicle_categories" ("activo", "orden");

-- El nivel tiene que ser un nivel: el 0 y los negativos son datos corruptos,
-- no «antes del sedán».
DO $$ BEGIN
    ALTER TABLE "supply_v2_vehicle_categories"
      ADD CONSTRAINT "supply_v2_vehicle_categories_nivel" CHECK ("nivelTarifario" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SEMILLA. No es una invención: es la enumeración que ya está escrita en el
-- esquema de `tipos_vehiculo` como la numeración de referencia del proyecto
-- —sedán 1, SUV 2, pickup 3, comercial 4—. Sembrarla aquí hace que el catálogo
-- de plataforma coincida con lo que las empresas ya tenían que seguir.
--
-- ON CONFLICT DO NOTHING en los tres unique, para que reejecutarla no falle ni
-- pise lo que un operador haya cambiado después.
INSERT INTO "supply_v2_vehicle_categories"
  ("id","code","nombre","nivelTarifario","orden","descripcion","updatedAt")
VALUES
  ('svc_sedan',     'SEDAN',     'Sedán',     1, 10, 'Carros de pasajeros de tamaño normal.',            CURRENT_TIMESTAMP),
  ('svc_suv',       'SUV',       'SUV',       2, 20, 'Jeepetas y camionetas de pasajeros.',              CURRENT_TIMESTAMP),
  ('svc_pickup',    'PICKUP',    'Pickup',    3, 30, 'Camionetas de cajón.',                             CURRENT_TIMESTAMP),
  ('svc_comercial', 'COMERCIAL', 'Comercial', 4, 40, 'Vans, furgonetas y vehículos de carga livianos.', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
