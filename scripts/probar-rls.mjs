#!/usr/bin/env node
/**
 * PRUEBA DE AISLAMIENTO ENTRE EMPRESAS  (auditoría de producción · A-01)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ COMPRUEBA, Y POR QUÉ HACE FALTA UNA PRUEBA Y NO UN DOCUMENTO
 *
 * Las políticas de `2026-07-rls-capa2-aislamiento.sql` se deducen del esquema:
 * 80 tablas por su columna `companyId` y 29 más siguiendo claves foráneas. Eso
 * es cómodo, pero también significa que **nadie las ha leído una por una**. Un
 * EXISTS mal montado en la ronda 1 se propaga a 28 tablas sin que nadie lo note,
 * y el resultado es una base que parece aislada y no lo está.
 *
 * Por eso esto no comprueba que las políticas EXISTAN. Comprueba que una
 * empresa no ve a la otra, sembrando dos empresas de verdad y mirando qué
 * devuelve la base.
 *
 * Los seis casos:
 *
 *   1. Lectura directa    — con el contexto en la empresa A, `select * from
 *                           clientes` SIN `where` no devuelve nada de B.
 *                           Este es EL caso: el `where` olvidado.
 *   2. Lectura por hija   — `visits` no tiene `companyId`; llega al inquilino
 *                           a través de `clientes`. Se comprueba que el camino
 *                           deducido funciona.
 *   3. Escritura cruzada  — la empresa A no puede insertar una fila marcada
 *                           como de B. Sin esto, RLS solo sería un filtro de
 *                           lectura.
 *   4. Modificación cruzada — A no puede tocar filas de B con un `update` sin
 *                           `where`, que es como se corrompen datos ajenos.
 *   5. Omnisciente        — la válvula de escape sigue viendo todo, porque el
 *                           superadmin, el marketplace público y el cron la
 *                           necesitan.
 *   6. Sin contexto       — si nadie declaró empresa, no se ve NADA. Fallo
 *                           cerrado: un olvido no debe abrir la puerta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USO
 *
 *   DATABASE_URL="postgresql://postgres@host:5432/base" npm run rls:probar
 *
 * Necesita un rol con permiso para `SET ROLE membego_app`, es decir el dueño
 * de las tablas. Crea sus datos con identificadores propios y los borra al
 * terminar, incluso si falla.
 *
 * NO LO CORRAS CONTRA PRODUCCIÓN. Escribe filas. Úsalo contra una base de
 * prueba o la del CI. Se niega a arrancar si la URL huele a Supabase.
 */

import { execFileSync } from 'node:child_process'

const C = { ok: '\x1b[32m', mal: '\x1b[31m', avi: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' }

const URL = process.env.DATABASE_URL
if (!URL) {
  console.error(`${C.mal}✗${C.off} Falta DATABASE_URL.`)
  process.exit(1)
}

// Guarda: esta prueba ESCRIBE. Contra la base real sería sembrar basura en
// producción, y peor: los `delete` de limpieza correrían allí.
if (/supabase\.(co|com)|pooler\.supabase/i.test(URL) && process.env.RLS_PERMITIR_REMOTA !== 'si') {
  console.error(
    `${C.mal}✗${C.off} La URL apunta a Supabase y esta prueba escribe filas.\n` +
    `  Úsala contra una base de prueba. Si de verdad sabes lo que haces:\n` +
    `  RLS_PERMITIR_REMOTA=si`
  )
  process.exit(1)
}

/** Ejecuta SQL y devuelve la salida cruda. Lanza si psql falla. */
function sql(texto) {
  return execFileSync('psql', [URL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', texto], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Ejecuta SQL con la válvula omnisciente abierta, y COMMIT.
 *
 * La siembra y la limpieza crean y borran DOS empresas: eso no lo hace ningún
 * inquilino, lo hace el superadmin. Con RLS de verdad encendido, hacerlo sin la
 * válvula falla —`new row violates row-level security policy for table
 * "companies"`— y la prueba no llega ni a empezar.
 *
 * Commit y no rollback, al contrario que `comoInquilino`: lo sembrado tiene que
 * seguir ahí cuando corran las comprobaciones.
 */
function comoOmnisciente(texto) {
  return sql(`begin; set local app.omnisciente = 'on'; ${texto} commit;`)
}

/**
 * Ejecuta SQL como `membego_app` con un contexto de empresa, dentro de una
 * transacción que SIEMPRE se deshace.
 *
 * `SET LOCAL` es deliberado: el ajuste muere con la transacción. Con `SET` a
 * secas se quedaría pegado a la conexión y, con un pool por delante, la
 * siguiente petición heredaría la empresa de la anterior. Ese es el fallo
 * clásico de RLS con pooler, y así no puede ocurrir.
 */
function comoInquilino(companyId, consulta, { omnisciente = false } = {}) {
  const contexto = omnisciente
    ? `set local app.omnisciente = 'on';`
    : companyId === null
      ? ''
      : `set local app.company_id = '${companyId}';`
  const crudo = sql(`begin; set local role membego_app; ${contexto} ${consulta} rollback;`)

  // psql imprime la etiqueta de CADA sentencia (BEGIN, SET, ROLLBACK…) en la
  // misma salida que el resultado. Sin quitarlas, la comprobación compara
  // "BEGIN\nSET\n1\nROLLBACK" contra "1" y falla aunque el aislamiento sea
  // correcto — que es exactamente lo que pasó la primera vez.
  return crudo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|SET|RESET|INSERT \d|UPDATE \d|DELETE \d)$/.test(l))
    .join('\n')
}

/** Igual, pero se espera que FALLE (permiso denegado). Devuelve true si falló. */
function fallaComoInquilino(companyId, consulta) {
  try {
    comoInquilino(companyId, consulta)
    return false
  } catch {
    return true
  }
}

const A = 'rlsprueba_a'
const B = 'rlsprueba_b'
let pasadas = 0
let fallos = 0

function comprobar(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++
    console.log(`${C.ok}  ✓${C.off} ${nombre}`)
  } else {
    fallos++
    console.log(`${C.mal}  ✗ ${nombre}${C.off}`)
    if (detalle) console.log(`${C.dim}     ${detalle}${C.off}`)
  }
}

function limpiar() {
  // En orden inverso a la siembra: las hijas antes que las madres, o las
  // claves foráneas lo impiden.
  try {
    comoOmnisciente(`
      delete from visits      where "clienteId" in ('${A}_k', '${B}_k');
      delete from memberships where "clienteId" in ('${A}_k', '${B}_k');
      delete from clientes    where id in ('${A}_k', '${B}_k');
      delete from plans       where "companyId" in ('${A}', '${B}');
      delete from companies   where id in ('${A}', '${B}');
    `)
  } catch {
    /* si no llegó a sembrarse, no hay nada que limpiar */
  }
}

console.log('\nAislamiento entre empresas (RLS · Capa 2)')
console.log('─'.repeat(64))

try {
  // ── Requisitos previos ────────────────────────────────────────────────────
  const rol = sql(
    `select coalesce((select case when rolbypassrls then 'BYPASS' else 'ok' end
        from pg_roles where rolname='membego_app'), 'NO_EXISTE')`
  )
  if (rol === 'NO_EXISTE') {
    console.error(
      `${C.mal}✗${C.off} El rol membego_app no existe.\n` +
      `  Aplica prisma/migrations_manual/2026-07-rls-capa2-aislamiento.sql primero.`
    )
    process.exit(1)
  }
  if (rol === 'BYPASS') {
    console.error(
      `${C.mal}✗${C.off} membego_app tiene BYPASSRLS: las políticas no le aplican.\n` +
      `  Corrígelo con: alter role membego_app nobypassrls;`
    )
    process.exit(1)
  }

  const conPolitica = Number(
    sql(`select count(*) from pg_policies where schemaname='public' and policyname like 'membego_%'`)
  )
  const tablas = Number(
    sql(`select count(*) from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`)
  )
  console.log(`${C.dim}Políticas membego_* activas: ${conPolitica} · tablas en public: ${tablas}${C.off}\n`)

  // ── Siembra ───────────────────────────────────────────────────────────────
  //
  // Dos empresas completas: plan → cliente → membresía → visita. La cadena
  // entera hace falta porque `visits` exige membresía, y es justo lo que
  // interesa: `visits` no tiene `companyId` y debe heredar el inquilino a
  // través de esa cadena.
  limpiar()
  comoOmnisciente(`
    insert into companies (id, name, slug, type, "updatedAt") values
      ('${A}', 'Prueba A', '${A}', 'CARWASH', now()),
      ('${B}', 'Prueba B', '${B}', 'CARWASH', now());
    insert into plans (id, "companyId", nombre, precio, "updatedAt") values
      ('${A}_p', '${A}', 'Plan A', 100, now()),
      ('${B}_p', '${B}', 'Plan B', 100, now());
    insert into clientes (id, "companyId", "supabaseId", nombre, email, "codigoReferido", "updatedAt") values
      ('${A}_k', '${A}', '${A}_u', 'Cliente de A', 'a@prueba.invalid', '${A}_r', now()),
      ('${B}_k', '${B}', '${B}_u', 'Cliente de B', 'b@prueba.invalid', '${B}_r', now());
    insert into memberships (id, "clienteId", "companyId", "planId", "updatedAt") values
      ('${A}_m', '${A}_k', '${A}', '${A}_p', now()),
      ('${B}_m', '${B}_k', '${B}', '${B}_p', now());
    insert into visits (id, "clienteId", "membershipId", servicio, "fechaVisita") values
      ('${A}_v', '${A}_k', '${A}_m', 'Lavado', now()),
      ('${B}_v', '${B}_k', '${B}_m', 'Lavado', now());
  `)

  // ── 1. El `where` olvidado ────────────────────────────────────────────────
  const vistos = comoInquilino(A, `select id from clientes where id in ('${A}_k','${B}_k');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Lectura directa: con el contexto en A, no aparece ningún cliente de B',
    vistos.length === 1 && vistos[0] === `${A}_k`,
    `devolvió: ${JSON.stringify(vistos)}`
  )

  // ── 2. El camino deducido por clave foránea ───────────────────────────────
  const visitas = comoInquilino(A, `select id from visits where id in ('${A}_v','${B}_v');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Lectura por tabla hija: `visits` hereda el inquilino de `clientes`',
    visitas.length === 1 && visitas[0] === `${A}_v`,
    `devolvió: ${JSON.stringify(visitas)}`
  )

  // ── 3. Escritura marcada como de otro ─────────────────────────────────────
  comprobar(
    'Escritura cruzada: A no puede insertar una fila con el companyId de B',
    fallaComoInquilino(
      A,
      `insert into clientes (id,"companyId","supabaseId",nombre,email,"codigoReferido","updatedAt")
       values ('${A}_intruso','${B}','x','Intruso','x@prueba.invalid','${A}_ri',now());`
    )
  )

  // ── 4. Modificación de lo ajeno ───────────────────────────────────────────
  const tocadas = comoInquilino(
    A,
    `with u as (update clientes set nombre='PISOTEADO' returning 1) select count(*) from u;`
  )
  comprobar(
    'Modificación cruzada: un `update` sin `where` solo alcanza las filas de A',
    tocadas === '1',
    `filas afectadas: ${tocadas} (debería ser 1, la de A)`
  )

  // ── 5. La válvula de escape ───────────────────────────────────────────────
  const omni = comoInquilino(
    null,
    `select count(*) from clientes where id in ('${A}_k','${B}_k');`,
    { omnisciente: true }
  )
  comprobar(
    'Modo omnisciente: superadmin, marketplace público y cron siguen viendo todo',
    omni === '2',
    `vio ${omni} de 2`
  )

  // ── 6. Fallo cerrado ──────────────────────────────────────────────────────
  const sinContexto = comoInquilino(
    null,
    `select count(*) from clientes where id in ('${A}_k','${B}_k');`
  )
  comprobar(
    'Sin contexto de empresa no se ve nada (fallo cerrado, no abierto)',
    sinContexto === '0',
    `vio ${sinContexto} filas sin declarar empresa`
  )
} catch (e) {
  fallos++
  console.log(`${C.mal}  ✗ La prueba no pudo completarse${C.off}`)
  console.log(`${C.dim}     ${String(e.stderr ?? e.message).split('\n').slice(0, 4).join('\n     ')}${C.off}`)
} finally {
  limpiar()
}

console.log('─'.repeat(64))
if (fallos === 0) {
  console.log(`${C.ok}✓${C.off} ${pasadas} comprobaciones, 0 fallos. El aislamiento se sostiene.\n`)
  process.exit(0)
}
console.log(`${C.mal}✗${C.off} ${pasadas} pasaron, ${fallos} fallaron.`)
console.log(`${C.avi}Una empresa puede ver o tocar datos de otra. No despliegues esto.${C.off}\n`)
process.exit(1)
