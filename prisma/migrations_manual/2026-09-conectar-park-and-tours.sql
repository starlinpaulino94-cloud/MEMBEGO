-- ─────────────────────────────────────────────────────────────────────────────
-- CONECTAR PARK & TOURS · dar de alta el satélite, igual que Car Wash.
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ ESTO ES SQL Y NO CÓDIGO
--
-- MembeGo no conoce a ningún vertical por nombre. Un sistema satélite —Car
-- Wash, Park & Tours, el que venga— se declara EN DATOS: cuatro filas en tres
-- tablas, y el acceso aparece solo. No hay `switch`, no hay `as const`, no hay
-- despliegue. Es la propiedad que la Fase 7 existe para demostrar, y este
-- archivo es la prueba de que se sostiene con el segundo satélite.
--
-- Concretamente, esto es lo que ya hace `scripts/registrar-sistema.ts` con el
-- manifiesto `examples/manifiestos/park-and-tours.json`. El script es el camino
-- bueno cuando se tiene la base a mano; esto es el mismo alta para quien opera
-- desde el editor SQL de Supabase, que es como se aplica todo aquí.
--
-- Car Wash está conectado exactamente así: su fila se registró a mano en
-- producción (ver `2026-09-limpiar-carwash-duplicado.sql`, que limpia el
-- duplicado que dejó aquel alta). Esto es lo mismo, escrito y repetible.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ APARECE CUANDO TERMINE
--
--   · Una tarjeta «Park & Tours» en /admin/integraciones → «Tus aplicaciones».
--   · Un icono en el App Launcher de la barra superior, en todas las páginas
--     del panel de esa empresa.
--
-- Los dos abren `/api/integraciones/abrir/park-and-tours`, que firma un token
-- SSO de 90 segundos y redirige a `{urlBase}/sso/membego?token=…`, que es el
-- handler que el satélite ya tiene implementado. Nadie escribe otra contraseña.
--
-- ════════════════════════════════════════════════════════════════════════════
-- LO QUE ESTE ARCHIVO **NO** HACE, A PROPÓSITO
--
--  1. NO cambia el vertical de ninguna empresa. `companies.tipoNegocioCodigo`
--     decide qué módulos ve en el menú, qué capacidades tiene y a qué sistemas
--     puede entrar: cambiarlo desde un SQL de alta reconfiguraría el panel de
--     un negocio de paso. Se elige en el formulario de la empresa (panel de
--     superadmin → Empresas → editar → Vertical), que ya ofrece «Excursiones y
--     Tours» porque lee `tipos_negocio`. Si la empresa no es de ese vertical,
--     el bloque 3 PARA y lo dice, en vez de dejar una habilitación que el
--     acceso rechazará por incompatible con un mensaje que no explica nada.
--
--  2. NO crea la credencial OAuth2 (`MEMBEGO_CLIENT_ID` / `MEMBEGO_CLIENT_SECRET`).
--     Su secreto se guarda con scrypt y eso no se hace en SQL. Tampoco hace
--     falta para lo que se pide aquí: el SSO y los webhooks van con el secreto
--     compartido de abajo. La credencial es para que el satélite LLAME a la API
--     de plataforma (canjear beneficios desde su punto de venta), y se emite con:
--
--       tsx scripts/registrar-sistema.ts examples/manifiestos/park-and-tours.json
--
--     sobre la misma base. Reregistrar no toca `estado` ni `autoHabilitar`, así
--     que correrlo después de esto no deshace nada.
--
--  3. NO rota el secreto si el sistema ya estaba dado de alta. Rotar es otra
--     operación, con su ventana de solape, y vive en el panel de plataforma.
--
--  4. NO reactiva un sistema SUSPENDED ni RETIRED. Esos dos estados los puso
--     alguien a conciencia; un alta que los pisara convertiría «lo registré
--     otra vez» en «reabrí un sistema que habíamos parado».
--
-- ════════════════════════════════════════════════════════════════════════════
-- CÓMO SE CORRE
--
-- Va entero, de una vez, en el editor SQL de Supabase. Antes, edita las dos
-- líneas marcadas «EDITA» del bloque 2 y la del bloque 3. Es idempotente:
-- correrlo dos veces deja exactamente lo mismo que correrlo una.
-- ─────────────────────────────────────────────────────────────────────────────

-- `gen_random_bytes` para el secreto compartido. `gen_random_uuid` es del
-- núcleo desde PostgreSQL 13; esta otra no, y sin ella el bloque 2 falla.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1 · Qué hay ahora (no modifica nada) ────────────────────────────────────
--
-- Míralo antes de seguir. Interesan dos cosas:
--   · que `park-and-tours` NO esté ya con otro `urlBase` o en RETIRED,
--   · el `slug` exacto de la empresa que va a abrirlo, y su vertical.

SELECT s.slug,
       s.nombre,
       s.estado,
       s."urlBase",
       s."urlWebhook",
       (SELECT string_agg(t.codigo, ', ' ORDER BY t.codigo)
          FROM "sistemas_tipos_negocio" st
          JOIN "tipos_negocio" t ON t.id = st."tipoId"
         WHERE st."sistemaId" = s.id) AS verticales,
       (SELECT count(*) FROM "empresas_sistemas" h
         WHERE h."sistemaId" = s.id AND h.estado = 'ENABLED') AS empresas_habilitadas
  FROM "sistemas_conectados" s
 ORDER BY s.slug;

SELECT c.slug, c.name, c."tipoNegocioCodigo", c.type
  FROM "companies" c
 WHERE c."isActive"
 ORDER BY c.name;

-- ── 2 · El alta del sistema ─────────────────────────────────────────────────
--
-- Global: no depende de ninguna empresa. Crea el vertical si falta, la fila del
-- sistema si falta, y la relación N:M.

DO $$
DECLARE
  -- EDITA: la raíz del despliegue del satélite. Es a donde redirige el SSO, así
  -- que tiene que ser https y tiene que ser la de verdad — no la de ejemplo.
  v_url_base    text := 'https://parkandtours.membego.com';
  -- EDITA: destino de los webhooks firmados. Ponlo a NULL si aún no quieres
  -- que MembeGo le mande eventos; el SSO funciona igual.
  v_url_webhook text := 'https://parkandtours.membego.com/api/membego/webhook';

  v_slug     text := 'park-and-tours';
  v_nombre   text := 'Park & Tours';
  v_vertical text := 'EXCURSIONES';
  v_tipo_id  text;
  v_sistema  record;
BEGIN
  IF v_url_base !~ '^https://' THEN
    RAISE EXCEPTION 'urlBase tiene que ser https: por ahí viaja un token SSO. Recibido: %', v_url_base;
  END IF;

  -- El vertical. `EXCURSIONES` ya lo siembra 20260817_excursiones_fundacion;
  -- esto lo cubre por si esta base se restauró desde antes de esa migración.
  INSERT INTO "tipos_negocio" ("id","codigo","nombre","orden","activo","createdAt","updatedAt")
  VALUES (gen_random_uuid()::text, v_vertical, 'Excursiones y Tours', 5, true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("codigo") DO NOTHING;

  SELECT id INTO v_tipo_id FROM "tipos_negocio" WHERE codigo = v_vertical;

  -- El sistema.
  --
  -- `estado`/`activo` van juntos porque un CHECK de 20260803 exige
  -- `(estado = 'ACTIVE') = activo`: dos columnas que dicen lo mismo se separan
  -- siempre, y con el CHECK el UPDATE que las separaría falla en vez de dejar
  -- la fila diciendo dos cosas.
  --
  -- Nace ACTIVE y no DRAFT, al contrario que el script: DRAFT existe para que
  -- alguien lo revise antes de lanzarlo, y ese alguien es quien está leyendo
  -- esto en el editor SQL de su propia producción. No hay panel para activarlo
  -- después, así que dejarlo en DRAFT sería dejarlo apagado sin interruptor.
  --
  -- ON CONFLICT actualiza SOLO lo que puede haber cambiado de sitio (nombre y
  -- URLs). Ni el secreto, ni el estado, ni las políticas: ver el encabezado.
  INSERT INTO "sistemas_conectados"
    ("id","slug","nombre","categoria","estado","activo","autoHabilitar",
     "accesoPorUsuario","urlBase","urlWebhook","secreto","createdAt")
  VALUES
    (gen_random_uuid()::text, v_slug, v_nombre, v_vertical, 'ACTIVE', true,
     -- `autoHabilitar = false`: registrar no es conceder. Cada empresa se
     -- habilita a mano (bloque 3). Car Wash lo tiene en true porque ya
     -- funcionaba así antes de que existieran las habilitaciones, y quitárselo
     -- le habría cortado el acceso a todo el mundo el día del cambio; un
     -- vertical nuevo no arrastra esa deuda.
     false,
     -- `accesoPorUsuario = false`: entra todo el equipo de la empresa
     -- habilitada, como en Car Wash. Ponerlo en true exige una fila por
     -- persona en `usuarios_sistemas` y hoy no hay pantalla para crearlas.
     false,
     v_url_base, v_url_webhook,
     'whs_' || encode(gen_random_bytes(24), 'hex'),
     CURRENT_TIMESTAMP)
  ON CONFLICT ("slug") DO UPDATE
    SET "nombre"     = EXCLUDED."nombre",
        "urlBase"    = EXCLUDED."urlBase",
        "urlWebhook" = EXCLUDED."urlWebhook";

  SELECT id, estado, "urlBase" INTO v_sistema
    FROM "sistemas_conectados" WHERE slug = v_slug;

  -- La compatibilidad (N:M). Sin esta fila el sistema no sirve a ningún
  -- vertical y NADIE puede abrirlo: una lista vacía no es un comodín.
  INSERT INTO "sistemas_tipos_negocio" ("sistemaId","tipoId","createdAt")
  VALUES (v_sistema.id, v_tipo_id, CURRENT_TIMESTAMP)
  ON CONFLICT DO NOTHING;

  IF v_sistema.estado <> 'ACTIVE' THEN
    RAISE WARNING 'El sistema % ya existía en estado % y NO se ha reactivado. Si es lo que quieres, cámbialo aparte y a conciencia.',
      v_slug, v_sistema.estado;
  END IF;

  RAISE NOTICE 'Sistema % listo (%), vertical %, url %', v_slug, v_sistema.estado, v_vertical, v_sistema."urlBase";
END $$;

-- ── 3 · La habilitación de la empresa ───────────────────────────────────────
--
-- Va en su propio bloque para que un error aquí no deshaga el alta de arriba:
-- el sistema es global y ya está bien registrado; lo que falla en este bloque
-- es la concesión a UNA empresa, y se reintenta sola corrigiendo la línea.

DO $$
DECLARE
  -- EDITA: el `slug` (o el `id`) de la empresa que abrirá Park & Tours. Sale
  -- del segundo SELECT del bloque 1.
  v_empresa_ref text := 'PON-AQUI-EL-SLUG-DE-LA-EMPRESA';

  v_slug     text := 'park-and-tours';
  v_vertical text := 'EXCURSIONES';
  v_sistema_id text;
  v_empresa  record;
BEGIN
  SELECT id INTO v_sistema_id FROM "sistemas_conectados" WHERE slug = v_slug;
  IF v_sistema_id IS NULL THEN
    RAISE EXCEPTION 'No existe el sistema %: corre el bloque 2 primero.', v_slug;
  END IF;

  SELECT id, name, slug, "tipoNegocioCodigo" INTO v_empresa
    FROM "companies" WHERE slug = v_empresa_ref OR id = v_empresa_ref;

  IF v_empresa.id IS NULL THEN
    RAISE EXCEPTION 'No existe ninguna empresa con slug o id "%". Míralo en el segundo SELECT del bloque 1.', v_empresa_ref;
  END IF;

  -- El vertical NO se toca desde aquí; ver el punto 1 del encabezado. Parar es
  -- mejor que habilitar: una fila ENABLED sobre una empresa incompatible deja
  -- la tarjeta apagada con «el vertical de tu empresa no coincide», y desde esa
  -- frase nadie deduce que lo que falta es editar la ficha de la empresa.
  IF coalesce(v_empresa."tipoNegocioCodigo", '') <> v_vertical THEN
    RAISE EXCEPTION
      'La empresa "%" es del vertical "%" y Park & Tours sirve a "%": nadie podría abrirlo. Cámbialo en Superadmin → Empresas → % → editar → Vertical → «Excursiones y Tours», y vuelve a correr este bloque.',
      v_empresa.name, coalesce(v_empresa."tipoNegocioCodigo", '(sin vertical)'), v_vertical, v_empresa.slug;
  END IF;

  INSERT INTO "empresas_sistemas"
    ("id","companyId","sistemaId","estado","habilitadoAt","deshabilitadoAt","createdAt","updatedAt")
  VALUES
    (gen_random_uuid()::text, v_empresa.id, v_sistema_id, 'ENABLED',
     CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT ("companyId","sistemaId") DO UPDATE
    SET "estado"          = 'ENABLED',
        "habilitadoAt"    = CURRENT_TIMESTAMP,
        "deshabilitadoAt" = NULL,
        "updatedAt"       = CURRENT_TIMESTAMP;

  RAISE NOTICE 'Park & Tours habilitado para % (%)', v_empresa.name, v_empresa.slug;
END $$;

-- ── 4 · El secreto compartido, que se copia UNA vez ─────────────────────────
--
-- Va al `.env` del satélite como `MEMBEGO_SECRETO`. Con él verifica la firma
-- del token SSO y la de los webhooks; sin él, su `/sso/membego` rechaza todo.
--
-- Está en claro en la base porque MembeGo FIRMA con él —no es un hash de
-- contraseña, es una clave simétrica compartida—. No lo pegues en un chat ni
-- en un ticket: si se escapa, se rota desde el panel de plataforma.

SELECT slug,
       secreto AS "MEMBEGO_SECRETO (cópialo al .env del satélite)"
  FROM "sistemas_conectados"
 WHERE slug = 'park-and-tours';

-- ── 5 · Verificación: exactamente lo que decidirá `acceso.ts` ───────────────
--
-- Las cuatro columnas de la derecha son los cuatro pasos de la regla, en orden.
-- Si las cuatro dicen `true`, la tarjeta se ve y el botón abre. Si alguna dice
-- `false`, esa es la que hay que arreglar y ninguna otra.

SELECT c.name                                             AS empresa,
       c."tipoNegocioCodigo"                              AS vertical_empresa,
       s.estado = 'ACTIVE'                                AS "1_sistema_activo",
       EXISTS (SELECT 1
                 FROM "sistemas_tipos_negocio" st
                 JOIN "tipos_negocio" t ON t.id = st."tipoId"
                WHERE st."sistemaId" = s.id
                  AND t.codigo = c."tipoNegocioCodigo")   AS "2_vertical_compatible",
       coalesce(h.estado, '(sin fila)') <> 'DISABLED'
         AND coalesce(h.estado, '(sin fila)') <> 'SUSPENDED'
                                                          AS "3_no_revocada",
       h.estado = 'ENABLED' OR s."autoHabilitar"          AS "4_concedida"
  FROM "sistemas_conectados" s
  JOIN "empresas_sistemas"  h ON h."sistemaId" = s.id
  JOIN "companies"          c ON c.id = h."companyId"
 WHERE s.slug = 'park-and-tours'
 ORDER BY c.name;
