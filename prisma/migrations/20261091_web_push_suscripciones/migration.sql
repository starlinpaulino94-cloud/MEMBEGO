-- WEB PUSH · suscripciones de navegador (PWA instalada o pestaña del navegador).
--
-- MembeGo no está en las tiendas, así que la única forma de avisar a una persona
-- FUERA de la app (pantalla apagada, app cerrada) es Web Push: el navegador
-- entrega la notificación aunque la pestaña no exista. Cada fila es un navegador
-- en un dispositivo. El `endpoint` lo asigna el servicio push del navegador y es
-- único por protocolo; si la persona cambia de cuenta en el mismo navegador, la
-- fila cambia de dueño (upsert por endpoint) en vez de duplicarse.
--
-- Misma forma que `push_tokens` (Expo): clave de usuario con borrado en cascada
-- —al eliminar la cuenta se van sus dispositivos— y RLS encendida como en el
-- resto de tablas con datos de personas.

CREATE TABLE "web_push_suscripciones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_push_suscripciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_suscripciones_endpoint_key" ON "web_push_suscripciones"("endpoint");
CREATE INDEX "web_push_suscripciones_userId_idx" ON "web_push_suscripciones"("userId");

ALTER TABLE "web_push_suscripciones"
ADD CONSTRAINT "web_push_suscripciones_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_push_suscripciones" ENABLE ROW LEVEL SECURITY;
