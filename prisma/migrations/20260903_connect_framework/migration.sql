-- ============================================================================
-- MEMBEGO CONNECT · Fase 10 — Framework de integraciones
-- ============================================================================
-- Dos cosas, las dos aditivas:
--
--   1. `conexiones_empresa.claseError` — POR QUÉ falló, en vocabulario cerrado.
--      Cada clase implica una conducta distinta del sistema: AUTH pide
--      reconectar, RATE_LIMIT solo pide esperar. Sin esta columna, distinguir
--      «vuelve a conectar tu cuenta» de «hay un problema» obligaría a leer el
--      texto del error a ojo, y eso siempre acaba mal.
--
--   2. Las integraciones PREVISTAS entran en el catálogo en DRAFT. En DRAFT no
--      las ve nadie: aparecen cuando el superadmin las publica, y ni siquiera
--      entonces se pueden conectar — no hay implementación detrás y el
--      servidor lo comprueba antes de crear ninguna conexión.
--
-- NADA EXISTENTE CAMBIA DE SIGNIFICADO. No se borra ni se modifica un solo
-- dato. Idempotente: se puede ejecutar dos veces sin daño.
-- ============================================================================

-- ── 1 · Por qué falló ───────────────────────────────────────────────────────

ALTER TABLE "conexiones_empresa" ADD COLUMN IF NOT EXISTS "claseError" TEXT;

-- Vocabulario cerrado, y cerrado también en la base: una clase inventada por
-- un SQL a mano rompería la traducción a lenguaje humano en silencio.
-- NULL es válido: una conexión sana no tiene clase de error.
DO $$ BEGIN ALTER TABLE "conexiones_empresa"
  ADD CONSTRAINT "conexiones_empresa_clase_error_valida"
  CHECK ("claseError" IS NULL OR "claseError" IN
    ('AUTH','PERMISSIONS','RATE_LIMIT','NETWORK','PROVIDER','CONFIGURATION','UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2 · CardNET en el catálogo (integración ADAPTADA) ───────────────────────
-- CardNET NO se migra a Connect: sigue viviendo en el subsistema de pagos, con
-- su MetodoPago, sus PagoIntento y sus variables de plataforma. Esta fila
-- existe solo para que aparezca en el catálogo unificado; Connect LEE su
-- estado y «Gestionar» lleva a /admin/metodos-pago. Nunca se creará una fila
-- en `conexiones_empresa` para ella — la guardia del servidor lo impide.

INSERT INTO "conectores" (
  "id", "slug", "nombre", "descripcion", "categoria", "authTipo", "estado",
  "scopesDisponibles", "createdAt", "updatedAt"
) VALUES (
  'cnr_cardnet',
  'cardnet',
  'CardNET',
  'Cobra con tarjeta de crédito y débito. Es la pasarela que ya usa tu negocio para las compras en línea.',
  'PAGOS',
  'API_KEY',
  'ACTIVE',
  ARRAY[]::text[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

-- ── 3 · Las integraciones previstas, en DRAFT ───────────────────────────────
-- `authTipo = 'NINGUNA'` es literal: todavía no se ha decidido cómo se
-- autoriza ninguna de estas. Poner 'OAUTH2' aquí sería documentar una decisión
-- que no se ha tomado.

INSERT INTO "conectores" (
  "id", "slug", "nombre", "descripcion", "categoria", "authTipo", "estado",
  "scopesDisponibles", "createdAt", "updatedAt"
) VALUES
  ('cnr_google',     'google',     'Google',     'Entra con tu cuenta de Google y sincroniza los datos de tu negocio.',        'IDENTIDAD',      'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_facebook',   'facebook',   'Facebook',   'Recibe en Membego los mensajes y clientes potenciales de tu página.',        'MARKETING',      'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_instagram',  'instagram',  'Instagram',  'Responde los mensajes directos de tu cuenta desde Membego.',                 'MARKETING',      'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_paypal',     'paypal',     'PayPal',     'Cobra a tus clientes con PayPal desde las compras de tu negocio.',           'PAGOS',          'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_stripe',     'stripe',     'Stripe',     'Cobra con tarjeta usando Stripe como pasarela.',                             'PAGOS',          'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_quickbooks', 'quickbooks', 'QuickBooks', 'Lleva tus ventas y pagos a tu contabilidad sin escribirlos dos veces.',      'CONTABILIDAD',   'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_hubspot',    'hubspot',    'HubSpot',    'Sincroniza tus clientes con tu CRM.',                                        'CRM',            'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_mailchimp',  'mailchimp',  'Mailchimp',  'Manda tus campañas de correo con las listas de Membego.',                    'MARKETING',      'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_brevo',      'brevo',      'Brevo',      'Correo y SMS de marketing con los datos de tus clientes.',                   'MARKETING',      'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_zapier',     'zapier',     'Zapier',     'Conecta Membego con miles de aplicaciones sin programar.',                   'AUTOMATIZACION', 'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cnr_make',       'make',       'Make',       'Crea flujos visuales entre Membego y las herramientas que ya usas.',         'AUTOMATIZACION', 'NINGUNA', 'DRAFT', ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- ── Verificación ────────────────────────────────────────────────────────────

SELECT 'connect_framework' AS objeto,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'conexiones_empresa' AND column_name = 'claseError') AS clase_error,
       (SELECT count(*) FROM conectores WHERE estado = 'DRAFT') AS previstas,
       (SELECT count(*) FROM conectores WHERE slug = 'cardnet') AS cardnet,
       CASE WHEN (SELECT count(*) FROM information_schema.columns
                   WHERE table_name = 'conexiones_empresa' AND column_name = 'claseError') = 1
             AND (SELECT count(*) FROM conectores) >= 14
            THEN 'OK' ELSE 'FALTA' END AS estado;

-- ── Diagnóstico que la Fase 12 necesita (decisión 7) ────────────────────────
-- ¿Hay conexiones de Google vivas en producción? De la respuesta depende si
-- ampliar los permisos de Google obliga a reautorizar a alguien.
SELECT 'google_calendar_conexiones' AS objeto,
       ce."estado",
       count(*) AS cuantas
  FROM conexiones_empresa ce
  JOIN conectores c ON c.id = ce."conectorId"
 WHERE c.slug = 'google-calendar'
 GROUP BY ce."estado";
