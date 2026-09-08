-- ============================================================================
-- El Home vuelve al mecanismo genérico de aislamiento        (corrige 20260914)
-- ============================================================================
--
-- QUÉ PASÓ
--
-- `20260914_home_rls` escribió a mano políticas `membego_inquilino` para las
-- tres tablas del Home, y llegó a aplicarse. Esa migración ya no existe en el
-- repo, por las razones que explica
-- `20260914_sinonimos_globales_unicos/migration.sql`; esto retira su efecto de
-- las bases donde alcanzó a correr.
--
-- Lo que dejó, y por qué se va:
--
--   · FORCE ROW LEVEL SECURITY en las tres tablas — y en NINGUNA otra de las
--     ~140 de `public`. La Capa 2 lo evita a propósito: FORCE alcanza también
--     al DUEÑO, que es quien ejecuta las migraciones y los caminos
--     omniscientes.
--   · Políticas `TO public`, es decir aplicables a todos los roles, cuando la
--     Capa 2 las crea `TO membego_app`.
--   · El nombre `membego_inquilino`, que es el que la Capa 2 usa y recrea.
--
-- Al retirarlas, las tres tablas quedan exactamente como las otras ~140: RLS
-- activado por la Capa 1 y sin política propia, esperando a que la Capa 2
-- deduzca la suya del esquema. `home_revisiones` y `busqueda_sinonimos`
-- entrarán por Nivel 0 (tienen `companyId`) y `home_bloques` por Nivel N a
-- través de su clave foránea NOT NULL. No hay que escribir nada para ellas.
--
-- Idempotente y sin pérdida de datos. Rollback: no hace falta — volver a
-- crear estas políticas sería reintroducir el defecto.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS membego_inquilino ON "home_revisiones";
DROP POLICY IF EXISTS membego_inquilino ON "home_bloques";
DROP POLICY IF EXISTS membego_inquilino ON "busqueda_sinonimos";

ALTER TABLE "home_revisiones"    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "home_bloques"       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "busqueda_sinonimos" NO FORCE ROW LEVEL SECURITY;

-- La Capa 1 mantiene RLS activado en todas las tablas de `public`; estas tres
-- no son la excepción.
ALTER TABLE "home_revisiones"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_bloques"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "busqueda_sinonimos" ENABLE ROW LEVEL SECURITY;

COMMIT;
