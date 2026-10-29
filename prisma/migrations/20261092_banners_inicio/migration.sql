-- CARRUSEL AUTOMÁTICO DEL INICIO · ajustes por pieza (aprobado 2026-10-29).
--
-- El carrusel del inicio del cliente se llena solo con lo que la empresa
-- publica (promociones, productos y servicios, ofertas, planes), de lo más
-- reciente a lo más viejo. Esta tabla guarda únicamente lo que la empresa
-- decidió sobre una pieza (fijarla, ocultarla, su plantilla) y el color
-- dominante de su imagen. Sin fila, la pieza sale con los valores automáticos.
-- RLS encendida como en el resto de tablas de empresa.

CREATE TABLE "banners_inicio" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "origenTipo" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "plantilla" TEXT,
    "fijado" BOOLEAN NOT NULL DEFAULT false,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "colorDominante" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_inicio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "banners_inicio_companyId_origenTipo_origenId_key" ON "banners_inicio"("companyId", "origenTipo", "origenId");
CREATE INDEX "banners_inicio_companyId_fijado_orden_idx" ON "banners_inicio"("companyId", "fijado", "orden");

ALTER TABLE "banners_inicio"
ADD CONSTRAINT "banners_inicio_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "banners_inicio" ENABLE ROW LEVEL SECURITY;
