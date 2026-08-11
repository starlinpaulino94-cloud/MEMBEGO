-- ============================================================================
-- RLS · CAPA 2 — aislamiento real entre empresas   (auditoría · A-01)
-- ============================================================================
--
-- ESTO NO SE APLICA SOLO. Léelo entero antes de correrlo, y lee docs/RLS.md.
-- No está en `prisma/migrations/` a propósito: crea un rol con contraseña y
-- cambia por qué usuario se conecta la aplicación. Eso no va en un archivo
-- versionado ni se dispara solo en un despliegue.
--
-- ────────────────────────────────────────────────────────────────────────────
-- QUÉ PROBLEMA RESUELVE, Y POR QUÉ LA CAPA 1 NO BASTA
--
-- La Capa 1 (`20260771_rls_barrera_publica`) le quitó a `anon` el acceso a
-- `public`. Eso cierra la puerta de PostgREST, que era la grave.
--
-- Pero NO protege contra el fallo que más veces ocurre de verdad: alguien
-- escribe una consulta nueva y se le olvida el `where companyId`. Prisma se
-- conecta como `postgres`, que en Supabase tiene el atributo BYPASSRLS: se
-- salta RLS por completo. Con la Capa 1 puesta, esa consulta seguiría
-- devolviendo los clientes de todas las empresas.
--
-- Para que RLS proteja de eso hacen falta dos cosas, y las dos duelen:
--
--   1. Que la aplicación se conecte con un rol que NO se salte RLS.
--   2. Que cada consulta diga en qué empresa está trabajando.
--
-- El (2) es lo caro: PostgreSQL no sabe quién es el usuario de la aplicación.
-- Hay que decírselo en cada transacción con `SET LOCAL app.company_id`. En
-- MembeGo eso son 765 puntos de consulta. Por eso esta capa se entrega
-- montada y probada, pero APAGADA: se enciende con `conEmpresa()` módulo a
-- módulo, no de golpe. Ver `src/lib/tenant.ts` y docs/RLS.md § 4.
--
-- ────────────────────────────────────────────────────────────────────────────
-- CÓMO SE DECIDE QUÉ POLÍTICA LLEVA CADA TABLA
--
-- No hay una lista escrita a mano de 112 tablas: se deduce del esquema, y por
-- eso no se desincroniza.
--
--   NIVEL 0 · la tabla tiene columna `companyId`  → política directa.
--             Son 80 de 112.
--   NIVEL N · la tabla no la tiene, pero una de sus claves foráneas apunta a
--             una tabla ya cubierta → política por EXISTS a través de esa
--             clave. Se repite hasta que no se cubre ninguna más.
--             Ejemplo: `visits` no tiene `companyId`, pero tiene `clienteId`,
--             y `clientes` sí lo tiene.
--   SIN RUTA· lo que quede sin camino fiable se INFORMA por pantalla y se
--             queda accesible solo en modo omnisciente. No se inventa una
--             regla: una política mal puesta es peor que ninguna, porque
--             parece que protege.
--
-- Solo se usan claves foráneas NOT NULL. Con una nullable, las filas
-- huérfanas quedarían fuera de toda empresa y habría que decidir si se ven o
-- no; se prefiere informarlo antes que elegir en silencio.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LA VÁLVULA DE ESCAPE, Y SU LÍMITE HONESTO
--
-- Muchísimo de MembeGo cruza empresas por diseño y con razón: el marketplace
-- público, el panel del superadmin, el cron que recorre todas las empresas.
-- Para eso está `app.omnisciente = 'on'`.
--
-- Esa válvula la puede abrir la propia aplicación. Es decir: esto NO defiende
-- de un servidor comprometido —quien ejecute código en el servidor puede
-- abrirla— y no pretende hacerlo. Defiende de un `where` olvidado, que es el
-- fallo que de verdad pasa. Un `where` olvidado nunca escribe
-- `app.omnisciente`.
--
-- Si algún día quieres la versión fuerte, se cambia la válvula por un SEGUNDO
-- ROL (`membego_admin`) con su propia cadena de conexión, y entonces el código
-- de inquilino no puede alcanzarla ni queriendo. Cuesta dos clientes de Prisma.
-- ============================================================================


-- ── 1. El rol de la aplicación ──────────────────────────────────────────────
--
-- NOBYPASSRLS es todo el punto de esta capa. Si este rol se saltara RLS, todo
-- lo demás sería decorado.
--
-- CAMBIA LA CONTRASEÑA en la línea marcada de abajo antes de ejecutar esto.
-- No la guardes en el repositorio: escríbela, ejecuta, y deshaz el cambio.
--
-- Aquí NO se usa `\set` de psql. El editor SQL de Supabase no es psql: manda el
-- texto tal cual al servidor, y una línea que empieza por `\` es un error de
-- sintaxis. Todo lo que este archivo necesita va en SQL puro, para que se pueda
-- pegar igual en el editor de Supabase que en psql.
--
-- Y si nadie cambia la clave, esto FALLA en vez de crear un rol con una
-- contraseña que está escrita en el repositorio.
DO $$
DECLARE
  clave text := 'CAMBIA-ESTA-CLAVE';   -- ← LA CONTRASEÑA VA AQUÍ
BEGIN
  IF clave = 'CAMBIA-ESTA-CLAVE' OR length(clave) < 16 THEN
    RAISE EXCEPTION
      'Pon una contraseña propia (16+ caracteres) en la variable `clave` antes de ejecutar este archivo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'membego_app') THEN
    EXECUTE format('CREATE ROLE membego_app LOGIN NOBYPASSRLS PASSWORD %L', clave);
    RAISE NOTICE 'Rol membego_app creado.';
  ELSE
    -- NOBYPASSRLS se reafirma siempre: si alguien se lo quitó, esta capa
    -- entera sería decorado y nadie se enteraría.
    EXECUTE format('ALTER ROLE membego_app NOBYPASSRLS PASSWORD %L', clave);
    RAISE NOTICE 'Rol membego_app ya existía; se reafirma NOBYPASSRLS y se fija la contraseña.';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO membego_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO membego_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO membego_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO membego_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO membego_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO membego_app;

-- `_prisma_migrations` no: migrar es cosa del rol de despliegue, no de la app.
-- Va guardado porque en una base creada con `db push` esa tabla no existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_prisma_migrations') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM membego_app;
  END IF;
END $$;


-- ── 2. Las políticas, deducidas del esquema ─────────────────────────────────
DO $$
DECLARE
  cubiertas  text[] := ARRAY[]::text[];
  ronda      integer := 0;
  nuevas     integer;
  t          record;
  fk         record;
  sin_ruta   text[] := ARRAY[]::text[];
  cond       text;
BEGIN
  -- Se parte de cero para poder recorrer el archivo las veces que haga falta.
  -- Se callan los avisos de "no existe, se omite": en la primera pasada son
  -- 112 líneas de ruido que tapan el resumen del final, que es lo que hay que
  -- leer.
  SET LOCAL client_min_messages = warning;
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS membego_inquilino ON public.%I', t.tablename);
  END LOOP;
  RESET client_min_messages;

  -- ── Nivel 0: la tabla lleva `companyId` encima ────────────────────────────
  FOR t IN
    SELECT c.relname AS tabla
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'companyId' AND a.attnum > 0
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    cond := '(current_setting(''app.omnisciente'', true) = ''on'''
         || ' OR "companyId" = current_setting(''app.company_id'', true))';
    EXECUTE format(
      'CREATE POLICY membego_inquilino ON public.%I FOR ALL TO membego_app USING (%s) WITH CHECK (%s)',
      t.tabla, cond, cond);
    cubiertas := cubiertas || t.tabla;
  END LOOP;

  RAISE NOTICE 'Nivel 0 — tablas con companyId propio: %', cardinality(cubiertas);

  -- `companies` es la tabla de empresas: su propia clave ES el inquilino.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='companies') THEN
    cond := '(current_setting(''app.omnisciente'', true) = ''on'''
         || ' OR id = current_setting(''app.company_id'', true))';
    EXECUTE format(
      'CREATE POLICY membego_inquilino ON public.companies FOR ALL TO membego_app USING (%s) WITH CHECK (%s)',
      cond, cond);
    -- El `::text` no es adorno: sin él PostgreSQL elige `array || array` e
    -- intenta leer 'companies' como literal de array.
    cubiertas := cubiertas || 'companies'::text;
    RAISE NOTICE 'companies cubierta por su propia clave primaria.';
  END IF;

  -- ── Niveles 1..N: se llega al inquilino por una clave foránea NOT NULL ────
  LOOP
    ronda  := ronda + 1;
    nuevas := 0;

    FOR fk IN
      SELECT hija.relname   AS tabla,
             att.attname    AS columna,
             madre.relname  AS padre,
             pk.attname     AS columna_padre
        FROM pg_constraint con
        JOIN pg_class  hija  ON hija.oid  = con.conrelid
        JOIN pg_class  madre ON madre.oid = con.confrelid
        JOIN pg_namespace n  ON n.oid     = hija.relnamespace
        JOIN pg_attribute att ON att.attrelid = con.conrelid  AND att.attnum = con.conkey[1]
        JOIN pg_attribute pk  ON pk.attrelid  = con.confrelid AND pk.attnum  = con.confkey[1]
       WHERE con.contype = 'f'
         AND n.nspname = 'public'
         AND cardinality(con.conkey) = 1     -- solo claves de una columna
         AND att.attnotnull                  -- solo NOT NULL: ver la nota de arriba
         AND NOT (hija.relname  = ANY (cubiertas))
         AND      madre.relname = ANY (cubiertas)
         AND hija.relname <> madre.relname   -- nada de autorreferencias
       ORDER BY hija.relname, att.attname
    LOOP
      CONTINUE WHEN fk.tabla = ANY (cubiertas);   -- ya cubierta en esta ronda

      cond := format(
        '(current_setting(''app.omnisciente'', true) = ''on'' OR EXISTS ('
        || 'SELECT 1 FROM public.%I p WHERE p.%I = public.%I.%I))',
        fk.padre, fk.columna_padre, fk.tabla, fk.columna);

      EXECUTE format(
        'CREATE POLICY membego_inquilino ON public.%I FOR ALL TO membego_app USING (%s) WITH CHECK (%s)',
        fk.tabla, cond, cond);

      cubiertas := cubiertas || fk.tabla;
      nuevas    := nuevas + 1;
    END LOOP;

    RAISE NOTICE 'Ronda % — cubiertas por clave foránea: %', ronda, nuevas;
    EXIT WHEN nuevas = 0 OR ronda > 10;
  END LOOP;

  -- ── Las que no tienen inquilino porque no les toca ────────────────────────
  --
  -- Estas tablas se quedaron sin camino, y se miraron una por una. No se dejan
  -- denegadas: si lo estuvieran, el listado de categorías saldría vacío y el POS
  -- no podría numerar un ticket.
  --
  -- Son CATÁLOGOS GLOBALES: los administra MembeGo y los lee todo el mundo
  -- (incluido el SSO y el despacho de eventos a sistemas satélite). Lectura
  -- para cualquier inquilino; escritura solo en modo omnisciente.
  --
  -- `tipos_negocio` y `sistemas_tipos_negocio` entran por el mismo motivo, y
  -- dejarlas fuera sería peor que en los otros casos: la decisión de acceso a un
  -- sistema (`modules/plataforma/acceso.ts`) compara el vertical de la empresa
  -- contra esa relación, así que una lectura vacía no daría una lista vacía en
  -- pantalla — cerraría TODOS los accesos a TODOS los satélites, y el motivo
  -- que quedaría en el log sería «vertical incompatible».
  FOREACH cond IN ARRAY ARRAY[
    'business_categories', 'campanas_globales', 'sistemas_conectados',
    'tipos_negocio', 'sistemas_tipos_negocio'
  ] LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=cond);
    EXECUTE format('DROP POLICY IF EXISTS membego_catalogo_lee ON public.%I', cond);
    EXECUTE format('DROP POLICY IF EXISTS membego_catalogo_escribe ON public.%I', cond);
    EXECUTE format(
      'CREATE POLICY membego_catalogo_lee ON public.%I FOR SELECT TO membego_app USING (true)', cond);
    EXECUTE format(
      'CREATE POLICY membego_catalogo_escribe ON public.%I FOR ALL TO membego_app '
      || 'USING (current_setting(''app.omnisciente'', true) = ''on'') '
      || 'WITH CHECK (current_setting(''app.omnisciente'', true) = ''on'')', cond);
    cubiertas := cubiertas || cond;
  END LOOP;
  RAISE NOTICE 'Catálogos globales: lectura abierta, escritura solo omnisciente.';

  -- `transaction_counters` es (id, seq) y nada más: contadores atómicos. Su
  -- `id` es un ámbito, no un dato — `TX:<fecha>` es global y `TICKET:<empresa>`
  -- es de una empresa (ver `nextCounter` en transaction-service.ts).
  --
  -- Abrirla entera dejaría que una empresa leyera cuántos tickets lleva otra.
  -- Es poco, pero es innecesario: la regla puede ser exacta.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='transaction_counters') THEN
    cond := '(current_setting(''app.omnisciente'', true) = ''on'''
         || ' OR id LIKE ''TX:%'''
         || ' OR id = ''TICKET:'' || current_setting(''app.company_id'', true))';
    EXECUTE format(
      'CREATE POLICY membego_inquilino ON public.transaction_counters FOR ALL TO membego_app '
      || 'USING (%s) WITH CHECK (%s)', cond, cond);
    cubiertas := cubiertas || 'transaction_counters'::text;
    RAISE NOTICE 'transaction_counters: ámbito global TX:* + TICKET del propio inquilino.';
  END IF;

  -- ── Solo omnisciente: ni de un inquilino ni de todos ──────────────────────
  --
  -- `credenciales_sistema` guarda con qué se autentica cada satélite contra
  -- `/api/platform/v1`. No lleva `companyId` —una credencial es de un SISTEMA,
  -- que atiende a muchas empresas— y NO es un catálogo: abrirla a lectura
  -- general dejaría que una empresa viera los hashes y los scopes de otra.
  --
  -- Es la única categoría que faltaba: sin ruta al inquilino Y sin lectura
  -- pública. Y no puede quedarse sin política, porque entonces RLS la deniega
  -- también en modo omnisciente y la API no autenticaría a NADIE: fallo
  -- cerrado, sí, pero cerrado del todo y sin decir por qué.
  FOREACH cond IN ARRAY ARRAY['credenciales_sistema'] LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=cond);
    EXECUTE format('DROP POLICY IF EXISTS membego_omnisciente ON public.%I', cond);
    EXECUTE format(
      'CREATE POLICY membego_omnisciente ON public.%I FOR ALL TO membego_app '
      || 'USING (current_setting(''app.omnisciente'', true) = ''on'') '
      || 'WITH CHECK (current_setting(''app.omnisciente'', true) = ''on'')', cond);
    cubiertas := cubiertas || cond;
  END LOOP;
  RAISE NOTICE 'Credenciales de sistema: solo en modo omnisciente.';

  -- ── Lo que quedó fuera ────────────────────────────────────────────────────
  --
  -- Sin política, RLS deniega. Aquí no debería quedar nada: si aparece algo, es
  -- una tabla NUEVA sin camino al inquilino, y hay que decidirlo a mano igual
  -- que se decidieron las tres de arriba. No se inventa una regla por defecto:
  -- una política mal puesta es peor que ninguna, porque parece que protege.
  SELECT array_agg(tablename ORDER BY tablename) INTO sin_ruta
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename <> '_prisma_migrations'
     AND NOT (tablename = ANY (cubiertas));

  RAISE NOTICE '────────────────────────────────────────────────';
  RAISE NOTICE 'Cubiertas por política de inquilino: % de %',
    cardinality(cubiertas),
    (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations');
  RAISE NOTICE 'SIN ruta al inquilino (solo omnisciente): %',
    COALESCE(array_to_string(sin_ruta, ', '), 'ninguna');
  RAISE NOTICE '────────────────────────────────────────────────';
  RAISE NOTICE 'Revisa esa lista. Si ahí aparece una tabla con datos de una';
  RAISE NOTICE 'empresa concreta, le falta camino y hay que dárselo a mano.';
END $$;


-- ── 3. Encender RLS ─────────────────────────────────────────────────────────
--
-- SIN ESTO, TODO LO DE ARRIBA ES DECORADO. Una política no se aplica sola: si
-- la tabla no tiene `ENABLE ROW LEVEL SECURITY`, PostgreSQL ni la mira. Se
-- crean las 137 políticas, `pg_policies` las enseña, y una empresa sigue viendo
-- a otra entera. Comprobado: con las políticas puestas y sin este paso,
-- `npm run rls:probar` daba 1 de 6, y la que pasaba lo hacía por casualidad
-- (el modo omnisciente ve todo, que es justo lo que pasa cuando RLS está
-- apagado).
--
-- Se encienden TODAS las tablas, también las que quedaron sin política: sin
-- política, RLS deniega, y eso es lo que se quiere para una tabla nueva que
-- nadie ha decidido cómo aislar. Fallar cerrado.
--
-- NO se usa FORCE ROW LEVEL SECURITY. FORCE aplicaría RLS también al DUEÑO de
-- la tabla, que es quien migra y quien siembra; y en Supabase ese dueño es
-- superusuario, así que FORCE ni siquiera lo alcanzaría. Lo único que
-- conseguiría es romper despliegues sin añadir aislamiento.
DO $$
DECLARE
  t          record;
  encendidas integer := 0;
  faltan     text[];
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname <> '_prisma_migrations'
       AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    encendidas := encendidas + 1;
  END LOOP;

  -- Y se comprueba, en vez de suponerlo. Este archivo ya estuvo una vez
  -- creando políticas inertes sin que nada lo dijera; que no vuelva a pasar
  -- en silencio.
  SELECT array_agg(c.relname ORDER BY c.relname) INTO faltan
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname <> '_prisma_migrations'
     AND NOT c.relrowsecurity;

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'RLS quedó apagado en: %', array_to_string(faltan, ', ');
  END IF;

  RAISE NOTICE '────────────────────────────────────────────────';
  RAISE NOTICE 'RLS ENCENDIDO. Tablas activadas en esta pasada: %', encendidas;
  RAISE NOTICE 'Total con RLS activo: %',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity);
  RAISE NOTICE '────────────────────────────────────────────────';
END $$;


-- ============================================================================
-- VERIFICACIÓN — el aislamiento, comprobado y no supuesto.
--
--   -- Con la empresa c1 puesta, no debe verse ni una fila de c2.
--   set role membego_app;
--   set local app.company_id = 'c1';
--   select count(*) from clientes;                       -- solo las de c1
--   select count(*) from clientes where "companyId"='c2'; -- tiene que dar 0
--   reset role;
--
-- La versión automática de esto es `npm run rls:probar`, que siembra dos
-- empresas y falla si una ve a la otra. Corre en CI.
--
-- ────────────────────────────────────────────────────────────────────────────
-- MARCHA ATRÁS:
--
--   do $$ declare t record; begin
--     for t in select tablename from pg_tables where schemaname='public' loop
--       execute format('drop policy if exists membego_inquilino on public.%I', t.tablename);
--     end loop;
--   end $$;
--   -- y devuelve DATABASE_URL al rol `postgres`.
--
-- Volver la cadena de conexión a `postgres` basta para desactivar la Capa 2
-- entera sin borrar nada: ese rol se salta RLS.
-- ============================================================================
