-- Promociones · límite de adquisiciones por cliente (un solo uso).
-- Añade la columna `limitePorCliente` (int, null = sin límite) a promociones.
-- Con 1 = un solo uso por cliente: una vez adquirida (aunque ya se haya usado
-- o vencido) no se puede volver a adquirir.
--
-- Idempotente: se puede ejecutar varias veces sin error. No toca datos
-- existentes (todas las promos quedan sin límite hasta que el admin lo defina).

ALTER TABLE "promociones"
  ADD COLUMN IF NOT EXISTS "limitePorCliente" integer;

-- Opcional: marca la promo "primer lavado gratis" como de un solo uso.
-- Descomenta y ajusta el id si quieres aplicarlo directamente por SQL en vez
-- de hacerlo desde el editor del panel (Promociones → editar → "Límite por
-- cliente" = 1).
-- UPDATE "promociones" SET "limitePorCliente" = 1
--   WHERE id = 'cmri7w6d9000ajy04ov9pmo9a';
