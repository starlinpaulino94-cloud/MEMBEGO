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
 *   7. Inicio comercial   — `home_revisiones` (Nivel 0) y `home_bloques`
 *                           (Nivel N, por `revisionId`): lo que compone la
 *                           pantalla que ve el cliente no cruza empresas, ni
 *                           leyéndola ni colgando un bloque de una revisión
 *                           ajena.
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
      delete from supply_redenciones where id = '${A}_sr';
      delete from supply_vouchers    where id = '${A}_sv';
      delete from supply_derechos    where id = '${A}_sd';
      delete from supply_lotes       where id = '${A}_sl';
      delete from supply_acuerdos    where id = '${A}_sa';
      delete from home_bloques    where "revisionId" in ('${A}_h', '${B}_h');
      delete from home_revisiones where id in ('${A}_h', '${B}_h');
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
    insert into home_revisiones (id, "companyId", territorio, estado, "updatedAt") values
      ('${A}_h', '${A}', 'Territorio A', 'PUBLICADA', now()),
      ('${B}_h', '${B}', 'Territorio B', 'PUBLICADA', now());
    insert into home_bloques (id, "revisionId", tipo, orden, "updatedAt") values
      ('${A}_hb', '${A}_h', 'CABECERA', 0, now()),
      ('${B}_hb', '${B}_h', 'CABECERA', 0, now());

    -- MEMBEGO SUPPLY · el caso cruzado, que es el que importa.
    --
    -- El proveedor es A. El cliente que recibe el beneficio es el de B: una
    -- persona registrada en otra empresa que recibe una pizza de A. Eso NO es
    -- un caso raro, es el normal — el marketplace de Membego cruza empresas a
    -- propósito— y es exactamente el que se colaba.
    insert into supply_acuerdos (id, codigo, "proveedorId", tipo, "itemNombre",
                                 cantidad, "costoUnitario", "inicioAt", "finAt", "updatedAt")
      values ('${A}_sa', 'MBG-A-001', '${A}', 'ON_DEMAND', 'Pizza Grande',
              1000, 300, now(), now() + interval '90 days', now());
    insert into supply_lotes (id, codigo, "acuerdoId", "proveedorId", "snapshotItemNombre",
                              "snapshotCostoUnitario", "snapshotModelo", "snapshotTipo",
                              "inicioAt", "venceAt", "updatedAt")
      values ('${A}_sl', 'MBG-A-001-L1', '${A}_sa', '${A}', 'Pizza Grande',
              300, 'COMPRA_UNIDAD_COMPLETA', 'ON_DEMAND',
              now(), now() + interval '90 days', now());
    insert into supply_derechos (id, "loteId", "clienteId", "proveedorId", origen,
                                 "costoUnitario", "vencAt", "updatedAt")
      values ('${A}_sd', '${A}_sl', '${B}_k', '${A}', 'REGALO',
              300, now() + interval '30 days', now());
    insert into supply_vouchers (id, "derechoId", codigo, "proveedorId", "vigenteHasta", "updatedAt")
      values ('${A}_sv', '${A}_sd', 'MBG-PRUEBA-1', '${A}', now() + interval '30 days', now());
    insert into supply_redenciones (id, "voucherId", "derechoId", "clienteId", "proveedorId",
                                    "loteId", "acuerdoId", "costoUnitario")
      values ('${A}_sr', '${A}_sv', '${A}_sd', '${B}_k', '${A}', '${A}_sl', '${A}_sa', 300);
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

  // ── 7. La composición del Inicio, que es lo que ve el cliente ─────────────
  //
  // `home_revisiones` entra por Nivel 0 y `home_bloques` por Nivel N a través
  // de `revisionId`. Se comprueban aquí, y no con un script aparte, por la
  // razón que explica la cabecera de este archivo: las políticas se DEDUCEN,
  // así que nadie las ha leído una por una y el único aval es sembrar dos
  // empresas y mirar qué devuelve la base.
  //
  // Que estas dos tablas caigan por el mecanismo genérico es justamente lo que
  // se está comprobando: si mañana una tabla nueva se queda sin camino, este
  // caso —no un documento— es lo que lo dice.
  const revisiones = comoInquilino(A, `select id from home_revisiones where id in ('${A}_h','${B}_h');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Inicio: la composición de A no incluye la de B',
    revisiones.length === 1 && revisiones[0] === `${A}_h`,
    `devolvió: ${JSON.stringify(revisiones)}`
  )

  const bloques = comoInquilino(A, `select id from home_bloques where id in ('${A}_hb','${B}_hb');`)
    .split('\n').filter(Boolean)
  comprobar(
    'Inicio: los bloques heredan el inquilino de su revisión (Nivel N)',
    bloques.length === 1 && bloques[0] === `${A}_hb`,
    `devolvió: ${JSON.stringify(bloques)}`
  )

  comprobar(
    'Inicio: A no puede colgar un bloque de la composición de B',
    fallaComoInquilino(
      A,
      `insert into home_bloques (id,"revisionId",tipo,orden,"updatedAt")
       values ('${A}_intruso','${B}_h','HERO',1,now());`
    )
  )

  // ── 8. Membego Supply: el inquilino de un derecho es QUIEN LO CUMPLE ──────
  //
  // Estas cuatro comprobaciones nacieron de un fallo medido el 25-09-2026, y
  // las cuatro fallaban antes de arreglarlo.
  //
  // Las políticas se deducen recorriendo claves foráneas en orden ALFABÉTICO de
  // columna. `supply_derechos` tiene tres NOT NULL —`clienteId`, `loteId`,
  // `proveedorId`— y ganaba `clienteId`, así que el derecho quedaba atado a la
  // empresa donde la PERSONA tiene su ficha. No es la misma que lo cumple.
  //
  // Resultado: el proveedor no veía ni uno de sus propios derechos (su portal y
  // su escáner se apagaban), y la empresa de la ficha del cliente SÍ los veía
  // —con `costoUnitario` dentro, que es lo que Membego negoció con un TERCERO—.
  //
  // Por eso se siembra al cliente en B y el proveedor en A: con las dos cosas
  // en la misma empresa, una política mal puesta pasa la prueba.
  const derechosA = comoInquilino(A, `select id from supply_derechos where id = '${A}_sd';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply: el PROVEEDOR ve sus propios derechos, aunque el cliente sea de otra empresa',
    derechosA.length === 1,
    `el proveedor no ve su derecho: devolvió ${JSON.stringify(derechosA)}`
  )

  const derechosB = comoInquilino(B, `select id from supply_derechos where id = '${A}_sd';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: la empresa de la ficha del cliente NO ve el derecho (lleva el costo de Membego)',
    derechosB.length === 0,
    `${B} llegó a leer el derecho de ${A}: ${JSON.stringify(derechosB)}`
  )

  const redenA = comoInquilino(A, `select id from supply_redenciones where id = '${A}_sr';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply: el proveedor ve sus propias entregas',
    redenA.length === 1,
    `devolvió: ${JSON.stringify(redenA)}`
  )

  const redenB = comoInquilino(B, `select id from supply_redenciones where id = '${A}_sr';`)
    .split('\n').filter(Boolean)
  comprobar(
    'Supply · FUGA: otra empresa no ve las entregas del proveedor',
    redenB.length === 0,
    `${B} llegó a leer la entrega de ${A}: ${JSON.stringify(redenB)}`
  )

  comprobar(
    'Supply: B no puede colgar un derecho del lote de A',
    fallaComoInquilino(
      B,
      `insert into supply_derechos (id,"loteId","clienteId","proveedorId",origen,
                                   "costoUnitario","vencAt","updatedAt")
       values ('${B}_intruso','${A}_sl','${B}_k','${B}','REGALO',300,now(),now());`
    )
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
