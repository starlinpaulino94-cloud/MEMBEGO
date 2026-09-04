-- LIMPIAR EL SISTEMA CAR WASH DUPLICADO · dato de producción, no esquema.
--
-- POR QUÉ ESTÁ AQUÍ Y NO EN prisma/migrations/
--
-- Esta fila no la creó ninguna semilla ni migración: se registró a mano en
-- producción. No existe en el repositorio, así que no existe en la base de
-- ninguna otra persona ni en la sombra de la CI. Meterla en el historial de
-- migraciones sería afirmar que forma parte del esquema, y no lo es.
--
-- QUÉ PASABA
--
-- El panel de Integraciones enseñaba DOS sistemas Car Wash:
--
--   · carwash            → https://carwash.membego.com   (Activo, el bueno)
--   · car-wash-membego   → https://SU-CARWASH.vercel.app (Retirado, plantilla)
--
-- El segundo apunta a una URL de EJEMPLO —«SU-CARWASH» es el hueco que había
-- que rellenar— así que sus 73 webhooks agotados son 73 intentos de entregar
-- a un dominio que nunca existió. Aparecían en el contador global de eventos
-- agotados, que es donde se mira cuando algo va mal: ruido permanente encima
-- de la señal.
--
-- Aparte de esto, el código ya no los mezcla: los sistemas RETIRED salen en su
-- propia sección, sin botones que no pueden funcionar. Esa parte protege del
-- próximo retiro; este SQL borra el de hoy.
--
-- QUÉ SE LLEVA POR DELANTE
--
-- Cinco tablas cascadean desde `sistemas_conectados` (ON DELETE CASCADE), así
-- que el borrado es limpio y no deja huérfanos:
--
--   usuarios_sistemas       accesos de personas a ese sistema
--   credenciales_sistema    credenciales que el satélite usaba contra la API
--   sistemas_tipos_negocio  a qué categorías servía
--   empresas_sistemas       la habilitación de 1 empresa
--   eventos_salientes       su historial, incluidos los 73 agotados
--
-- La empresa habilitada NO pierde su Car Wash: sigue teniendo el sistema
-- `carwash`, que es el que está en servicio y al que ya apunta el enlace del
-- menú. Lo que se borra es una habilitación sobre un satélite inexistente.
--
-- ANTES DE BORRAR, MIRA
--
-- El primer bloque no cambia nada: enseña exactamente lo que se va a perder.
-- Córrelo, lee los números, y solo entonces corre el DELETE.

-- ── 1. Qué hay (no modifica nada) ───────────────────────────────────────────
SELECT
  s.slug,
  s.nombre,
  s.estado,
  s."urlBase",
  (SELECT count(*) FROM eventos_salientes      e WHERE e."sistemaId" = s.id) AS eventos,
  (SELECT count(*) FROM empresas_sistemas      h WHERE h."sistemaId" = s.id) AS habilitaciones,
  (SELECT count(*) FROM usuarios_sistemas      u WHERE u."sistemaId" = s.id) AS accesos,
  (SELECT count(*) FROM credenciales_sistema   c WHERE c."sistemaId" = s.id) AS credenciales
FROM sistemas_conectados s
ORDER BY s.slug;

-- Comprueba en el resultado, ANTES de seguir:
--   · que `car-wash-membego` aparece con estado RETIRED y la URL de ejemplo,
--   · que `carwash` aparece con estado ACTIVE y su URL real,
--   · que los números de la fila a borrar son los que esperas.
--
-- Si `carwash` NO está ahí, PARA: estarías a punto de quedarte sin ninguno.

-- ── 2. El borrado ───────────────────────────────────────────────────────────
-- Se identifica por `slug` y además se exige que esté RETIRED: si alguien lo
-- hubiera reactivado entre que miraste y ejecutaste, esto no borra nada en vez
-- de borrar un sistema vivo.
DELETE FROM sistemas_conectados
WHERE slug = 'car-wash-membego'
  AND estado = 'RETIRED';

-- ── 3. Confirmar ────────────────────────────────────────────────────────────
-- Debe quedar solo `carwash`.
SELECT slug, nombre, estado FROM sistemas_conectados ORDER BY slug;
