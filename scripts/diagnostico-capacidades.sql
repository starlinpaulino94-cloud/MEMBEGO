-- ============================================================================
-- Diagnóstico + arreglo: "encendí las capacidades pero los módulos siguen
-- apareciendo como PRÓXIMAMENTE".
--
-- Causa más probable: falta la columna `companies.capacidades` (migración
-- 20260758). El resolutor es a prueba de fallos: sin esa columna responde con
-- el PAQUETE BASE de la categoría — que NO incluye los módulos nuevos — y el
-- panel de capacidades no puede guardar nada.
--
-- Ejecutar completo en el SQL Editor de Supabase. IDEMPOTENTE.
-- ============================================================================

-- PASO 1 · Crear la columna si falta (no hace nada si ya existe).
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "capacidades" JSONB;

-- PASO 2 · Estado de la columna.
SELECT 'columna companies.capacidades' AS chequeo,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'companies' AND column_name = 'capacidades'
       ) THEN 'OK' ELSE 'FALTA' END AS resultado;

-- PASO 3 · Qué tiene guardado cada empresa.
--   capacidades = NULL  → nunca se guardó nada (paquete base puro).
--   Debe verse algo como: {"overrides":{"COLA_VEHICULOS":true,...}}
SELECT id, name, type, capacidades
FROM "companies"
ORDER BY name;

-- PASO 4 · A qué empresa apunta TU usuario.
--   El panel guarda para la empresa que elijas en el selector, pero la app
--   Car Wash lee la empresa de TU usuario: si no coinciden, enciendes las
--   capacidades de una empresa y miras las de otra.
SELECT u.email, u.role, u."companyId", c.name AS empresa_de_tu_usuario
FROM "users" u
LEFT JOIN "companies" c ON c.id = u."companyId"
WHERE u.role = 'SUPERADMIN'
ORDER BY u.email;
