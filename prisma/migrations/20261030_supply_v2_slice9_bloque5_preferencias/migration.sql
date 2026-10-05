-- MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · PREFERENCIAS DE AVISO.
--
-- Aditiva: una tabla nueva, ninguna columna tocada, ningún dato movido. Se
-- puede aplicar sobre producción con tráfico.
--
-- Por qué existe y por qué vive en identidad y no en Supply 2.0 está escrito en
-- `prisma/schema/identidad.prisma`, junto al modelo. En resumen: no había un
-- modelo de preferencias de aviso en el proyecto —`Notificacion` guarda el
-- aviso ya creado, no el consentimiento— y esto es de la PERSONA, no de una
-- vertical.
--
-- LOS NULOS SON «NO LO HA TOCADO», NO «APAGADO». El valor por defecto lo decide
-- el dominio (`POR_DEFECTO` en modules/supply-v2/notifications/dominio.ts): lo
-- transaccional encendido, lo promocional apagado. Se deja ahí y no como
-- DEFAULT de la columna a propósito: si mañana cambia la política, cambia en un
-- sitio y no hace falta una migración que reescriba filas, y además queda la
-- diferencia entre «dijo que no» y «no se le ha preguntado», que es justo la
-- que importa para poder preguntar una sola vez.

CREATE TABLE "preferencias_de_aviso" (
  "userId" TEXT NOT NULL,
  "inApp" BOOLEAN,
  "emailTransactional" BOOLEAN,
  "emailMarketing" BOOLEAN,
  "whatsappTransactional" BOOLEAN,
  "whatsappMarketing" BOOLEAN,
  "actualizadoPor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "preferencias_de_aviso_pkey" PRIMARY KEY ("userId")
);

-- La preferencia muere con la persona: si se borra la cuenta, no queda una fila
-- huérfana con el consentimiento de alguien que ya no está.
ALTER TABLE "preferencias_de_aviso"
  ADD CONSTRAINT "preferencias_de_aviso_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
