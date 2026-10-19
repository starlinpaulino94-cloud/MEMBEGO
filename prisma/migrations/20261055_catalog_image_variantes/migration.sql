-- Editor de imágenes del catálogo: el original se conserva y las versiones
-- (tarjeta, ficha, compartir) se generan a partir de él y del encuadre elegido.
-- Todas las columnas son opcionales: las fotos anteriores siguen sirviéndose
-- desde su original, sin versiones, hasta que se reencuadren.

ALTER TABLE "catalog_item_images"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "crop" JSONB,
  ADD COLUMN "variantesBase" TEXT;
