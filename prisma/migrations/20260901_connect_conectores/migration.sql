-- ============================================================================
-- MEMBEGO CONNECT · Fase 6 — Los dos primeros conectores nativos
-- ============================================================================
-- Siembra el catálogo. Que la fila exista NO significa que la empresa lo vea:
-- la lectura filtra además por si el conector está configurado de verdad en
-- este despliegue (`slugsDisponibles()`). Google Calendar, sin sus variables
-- de entorno, no se ofrece aunque esté aquí.
--
-- 100% ADITIVA. Idempotente: ON CONFLICT no pisa lo que ya haya.
-- ============================================================================

INSERT INTO "conectores" (
  "id", "slug", "nombre", "descripcion", "categoria", "authTipo", "estado",
  "scopesDisponibles", "createdAt", "updatedAt"
) VALUES (
  'cnr_whatsapp',
  'whatsapp',
  'WhatsApp',
  'Envía mensajes a tus clientes desde tus automatizaciones, con el número de WhatsApp de tu negocio.',
  'COMUNICACION',
  'API_KEY',
  'ACTIVE',
  ARRAY[]::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
), (
  'cnr_google_calendar',
  'google-calendar',
  'Google Calendar',
  'Lleva las citas confirmadas a la agenda de Google de tu negocio, automáticamente.',
  'CALENDARIO',
  'OAUTH2',
  'ACTIVE',
  ARRAY['https://www.googleapis.com/auth/calendar.events']::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
-- Si ya existían (por ejecutar esto dos veces, o porque alguien los ajustó a
-- mano), no se tocan: la migración siembra, no impone.
ON CONFLICT ("slug") DO NOTHING;

SELECT 'connect_conectores' AS objeto,
       (SELECT count(*) FROM conectores WHERE slug IN ('whatsapp','google-calendar')) AS sembrados,
       CASE WHEN (SELECT count(*) FROM conectores WHERE slug IN ('whatsapp','google-calendar')) = 2
            THEN 'OK' ELSE 'FALTA' END AS estado;
