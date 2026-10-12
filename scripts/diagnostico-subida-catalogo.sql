-- Diagnóstico de «new row violates row-level security policy» al subir fotos del catálogo.
-- Solo lee: no modifica nada. Corre cada PARTE por separado en el SQL Editor de Supabase
-- (selecciona una parte, pégala sola y ejecútala).
--
-- ═════════════════════════ PARTE A · qué políticas y funciones hay ═════════════════════════
-- Debe haber una política INSERT sobre promociones para `authenticated` que llame a
-- membego_medio_propio, y las tres funciones membego_* deben existir.

SELECT 'politica' AS tipo, policyname AS nombre, cmd || ' · ' || roles::text AS detalle,
       coalesce(with_check, qual, '') AS expresion
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND (coalesce(with_check, '') || coalesce(qual, '')) ILIKE '%promociones%'
UNION ALL
SELECT 'funcion', p.proname, 'existe', ''
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('membego_medio_propio', 'membego_mis_empresas', 'membego_es_superadmin')
UNION ALL
SELECT 'superadmin', coalesce(u.email, u.id), u.role::text, 'supabaseId=' || coalesce(u."supabaseId", 'NULL')
  FROM public.users u WHERE u.role::text = 'SUPERADMIN'
 ORDER BY 1, 2;

-- ═════════════════════════ PARTE B · simula la subida como el superadmin ═════════════════════════
-- Intenta insertar una fila de prueba en storage.objects haciéndose pasar por el primer
-- SUPERADMIN, y también como anónimo. TODO se deshace al final: el resultado sale como
-- un «error» cuyo texto empieza por RESULTADO. Cópialo entero.

DO $$
DECLARE
  v_uid     text;
  v_company text;
  v_path    text;
  v_msg     text := '';
BEGIN
  SELECT u."supabaseId" INTO v_uid
    FROM public.users u
   WHERE u.role::text = 'SUPERADMIN' AND u."supabaseId" IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO v_company FROM public.companies c ORDER BY c.id LIMIT 1;
  v_path := v_company || '/catalogo/diagnostico/prueba.png';
  v_msg  := 'RESULTADO · uid=' || coalesce(v_uid, 'NULL') || ' · ruta=' || coalesce(v_path, 'NULL') || E'\n';

  -- Como usuario autenticado (el superadmin)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_msg := v_msg || 'membego_es_superadmin() = ' || public.membego_es_superadmin()::text || E'\n';
    v_msg := v_msg || 'membego_medio_propio(ruta) = ' || public.membego_medio_propio(v_path)::text || E'\n';
    INSERT INTO storage.objects (bucket_id, name) VALUES ('promociones', v_path);
    v_msg := v_msg || 'INSERT como authenticated: PERMITIDO' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    v_msg := v_msg || 'INSERT como authenticated: BLOQUEADO (' || SQLERRM || ')' || E'\n';
  END;
  RESET ROLE;

  -- Como anónimo (la clave pública, sin sesión)
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('promociones', v_path || '.anon');
    v_msg := v_msg || 'INSERT como anon: PERMITIDO' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    v_msg := v_msg || 'INSERT como anon: BLOQUEADO (' || SQLERRM || ')' || E'\n';
  END;
  RESET ROLE;

  RAISE EXCEPTION '%', v_msg;  -- deshace todo y muestra el resultado
END
$$;
