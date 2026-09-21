/**
 * OPERACIÓN · Fase 5.
 *
 * Esta fase trajo una COLUMNA consigo, y ahí está casi todo el riesgo. Lo que
 * se vigila aquí, por orden de lo que dolería:
 *
 *  1. Que el reporte DIGA que su cobertura es parcial mientras el relleno de
 *     `visits.companyId` no termine. Sin ese aviso, los canjes de los meses
 *     viejos salen por debajo de lo que fueron y nadie tiene forma de saberlo.
 *  2. Que la migración no bloquee la pista: columna nullable, sin default, e
 *     índices con `IF NOT EXISTS` para que el archivo manual con `CONCURRENTLY`
 *     pueda ir antes y dejarla en nada.
 *  3. Que el único sitio donde se crea una visita escriba la empresa. Si se le
 *     olvida, el hueco no deja de crecer y el reporte se equivoca para siempre.
 *  4. Que el desglose por persona vaya detrás de su permiso EN LA CONSULTA,
 *     porque la ruta de exportación llama a la misma función.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function crudo(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
}

function fuente(...ruta: string[]): string {
  return crudo(...ruta)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const MOTOR = ['src', 'modules', 'reportes', 'operacion.ts']
const VISTA = ['src', 'components', 'reportes', 'ReporteOperacionVista.tsx']
const PAGINA = ['src', 'app', '(admin)', 'admin', 'reportes', 'operacion', 'page.tsx']
const EXPORTA = ['src', 'app', '(admin)', 'admin', 'reportes', 'operacion', 'export', 'route.ts']
const MIGRACION = ['prisma', 'migrations', '20260919_visitas_company_id', 'migration.sql']
const MANUAL = ['prisma', 'migrations_manual', '2026-09-visitas-company-id.sql']

// ── La columna nueva ─────────────────────────────────────────────────────────

test('la visita se crea con la empresa de su membresía', () => {
  // Es el ÚNICO sitio del producto donde nace una visita. Si aquí falta, el
  // hueco de `companyId` no deja de crecer y ningún backfill lo alcanza.
  //
  // Se mira DENTRO del `visit.create`, no en el archivo entero: `canje.ts`
  // escribe `companyId: membership.companyId` en ocho sitios más —auditoría,
  // QR, notificaciones— y una búsqueda suelta pasaría con la visita sin
  // empresa. Esta prueba se escribió primero laxa y pasó con el campo borrado;
  // esto es lo que aprendió.
  const src = fuente('src', 'modules', 'visitas', 'canje.ts')
  const i = src.indexOf('tx.visit.create(')
  assert.ok(i > 0, 'no se encontró la creación de la visita')
  const bloque = src.slice(i, src.indexOf('})', src.indexOf('},', i)))
  assert.match(bloque, /companyId: membership\.companyId/)
})

test('no hay otro sitio que cree visitas sin empresa', () => {
  // Los scripts de semilla y de verificación también la escriben: si no, sus
  // visitas quedarían invisibles para este reporte y alguien perseguiría un
  // fantasma.
  for (const ruta of [
    ['scripts', 'demo-datos.ts'],
    ['scripts', 'verificar-cliente-global.mts'],
  ]) {
    assert.match(fuente(...ruta), /companyId: mem/i, ruta.join('/'))
  }
})

test('la columna es nullable y sin default: el ADD COLUMN no reescribe la tabla', () => {
  // Una columna NOT NULL con default obliga a Postgres a reescribir `visits`
  // entera con un lock exclusivo. Sobre millones de filas eso es la pista
  // parada.
  const sql = crudo(...MIGRACION)
  assert.match(sql, /ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "companyId" TEXT;/)
  assert.doesNotMatch(sql, /"companyId"[^;]*NOT NULL/)
  assert.doesNotMatch(sql, /"companyId"[^;]*DEFAULT/i)
})

test('la migración no rellena nada: el relleno va aparte y por lotes', () => {
  const sql = crudo(...MIGRACION)
  assert.doesNotMatch(sql, /\bUPDATE\b/i, 'la migración de Prisma no debe tocar filas')
  assert.match(crudo(...MANUAL), /UPDATE "visits"/)
})

test('los índices se crean con IF NOT EXISTS para que el manual pueda ir antes', () => {
  // Es el trato que ya documenta 2026-07-visitas-indices-concurrently.sql: en
  // producción primero el CONCURRENTLY a mano, y después la migración, que no
  // hace nada porque ya están.
  const sql = crudo(...MIGRACION)
  for (const idx of [
    'visits_companyId_fechaVisita_idx',
    'audit_logs_companyId_accion_createdAt_idx',
  ]) {
    assert.ok(
      sql.includes(`CREATE INDEX IF NOT EXISTS "${idx}"`),
      `${idx} debe crearse con IF NOT EXISTS en la migración`
    )
    assert.ok(
      crudo(...MANUAL).includes(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${idx}"`),
      `${idx} debe tener su versión CONCURRENTLY en el archivo manual`
    )
  }
})

test('ningún archivo manual con CONCURRENTLY dice que se ejecute en el editor de Supabase', () => {
  // El editor SQL de Supabase envuelve en una transacción TODO lo que se le
  // manda —una sentencia o veinte—, así que `CONCURRENTLY` siempre devuelve
  // `ERROR: 25001`. Dos archivos decían «una sentencia a la vez» y otro «solo,
  // en su propia pestaña»; las tres instrucciones eran falsas y costaron un
  // intento fallido en producción.
  //
  // SOLO SE MIRA `migrations_manual/`, y el motivo es otra cosa que se aprendió
  // el mismo día: una migración YA APLICADA no se edita, ni sus comentarios.
  // `migrate deploy` lo tolera —comprobado—, pero el siguiente `migrate dev` se
  // planta y exige `migrate reset`, que borra la base. La corrección de esta
  // frase llegó a escribirse en `20260905_connect_identidad_externa` y hubo que
  // revertirla; lo vigila `tests/migraciones-inmutables.test.ts`. Los archivos
  // manuales sí se pueden corregir: nadie guarda su suma.
  const raiz = join(__dirname, '..', 'prisma', 'migrations_manual')
  for (const nombre of readdirSync(raiz)) {
    if (!nombre.endsWith('.sql')) continue
    const texto = readFileSync(join(raiz, nombre), 'utf8')
    if (!texto.includes('CONCURRENTLY')) continue
    assert.doesNotMatch(
      texto,
      /UNA SENTENCIA A LA VEZ|en su propia pestaña/,
      `${nombre} repite la instrucción falsa sobre el editor de Supabase`
    )
  }
})

test('los archivos que ejecutan CONCURRENTLY dicen con qué cliente', () => {
  // Decir que no se puede en Supabase sin decir dónde sí deja a quien aplica el
  // SQL con un error y sin salida.
  for (const ruta of [
    MANUAL,
    ['prisma', 'migrations_manual', '2026-07-visitas-indices-concurrently.sql'],
  ]) {
    const texto = crudo(...ruta)
    assert.match(texto, /autocommit/i, `${ruta.join('/')} no dice qué cliente usar`)
    assert.match(texto, /psql/, ruta.join('/'))
  }
})

test('el relleno manual va acotado y es reanudable', () => {
  const sql = crudo(...MANUAL)
  assert.match(sql, /LIMIT \d+/, 'sin tope, un solo UPDATE bloquea la tabla entera')
  assert.match(sql, /"companyId" IS NULL/, 'solo debe tocar lo que falta, para poder reanudarse')
})

test('el esquema declara el índice que justifica la columna', () => {
  const schema = crudo('prisma', 'schema', 'membresias.prisma')
  assert.match(schema, /@@index\(\[companyId, fechaVisita\]\)/)
  assert.match(schema, /companyId {4}String\?/)
})

// ── El reporte dice hasta dónde llega ────────────────────────────────────────

test('mientras quede relleno pendiente, el reporte lo avisa', () => {
  assert.match(fuente(...MOTOR), /rellenoPendiente/)
  assert.match(fuente(...VISTA), /cobertura\.pendiente/)
  assert.match(fuente(...EXPORTA), /PARCIAL - quedan visitas sin empresa asignada/)
})

test('si la comprobación de cobertura falla, se avisa de más', () => {
  // De los dos errores posibles, el único grave es dar por completa una
  // cobertura que no se pudo verificar: alguien decidiría con un número corto.
  const src = fuente(...MOTOR)
  assert.match(src, /seguro\(rellenoPendiente\(tx\), true, fallos\)/)
})

test('la cobertura es un sí o un no, no un número de otro inquilino', () => {
  // Contar cuántas pendientes son de ESTA empresa exigiría el JOIN por
  // `membershipId` que esta fase existe para evitar; un conteo global sería
  // dato de otra empresa pintado en la pantalla de esta.
  const src = fuente(...MOTOR)
  assert.match(src, /pendiente: boolean/)
})

test('un fallo de consulta se dice, no se enseña como cero', () => {
  assert.match(fuente(...MOTOR), /incompleto: fallos\.n > 0/)
  assert.match(fuente(...VISTA), /r\.incompleto &&/)
})

// ── Aislamiento ──────────────────────────────────────────────────────────────

test('todo va con contexto de empresa y con la empresa también en el WHERE', () => {
  const src = fuente(...MOTOR)
  assert.match(src, /conEmpresa\(companyId/)
  // RLS es la segunda barrera, no la única: las consultas crudas filtran.
  const crudas = src.match(/\$queryRaw<[^`]*`[\s\S]*?`/g) ?? []
  assert.ok(crudas.length >= 2, 'se esperaban las consultas crudas del reporte')
  for (const q of crudas) {
    if (!q.includes('FROM "visits"')) continue
    if (q.includes('IS NULL')) continue // la de cobertura es un sí/no, sin empresa
    assert.match(q, /"companyId" = \$\{companyId\}/, 'consulta cruda sin filtro de empresa')
  }
})

test('los nombres de empleado se buscan acotados a la empresa, por los dos caminos', () => {
  // `users` es global: cruzarla sin filtro reconstruiría por detrás la frontera
  // de privacidad que el producto promete. Y el filtro tiene que aceptar los
  // DOS caminos —empresa activa y tabla de accesos—, porque con solo el primero
  // un empleado que atiende dos negocios saldría como «(eliminado)» en el
  // reporte del segundo: un nombre falso, no un dato que falte.
  const src = fuente(...MOTOR)
  const fn = src.slice(src.indexOf("agrupar(tx, companyId, rango, filtro, 'empleadoId'"))
  const bloque = fn.slice(0, 800)
  assert.match(bloque, /tx\.user\.findMany\(/)
  assert.match(bloque, /OR: \[\{ companyId \}, \{ empresasAcceso: \{ some: \{ companyId \} \} \}\]/)
})

// ── Permisos ─────────────────────────────────────────────────────────────────

test('la pantalla y la exportación exigen la función, no solo el rol', () => {
  assert.match(fuente(...PAGINA), /requireSection\('reportes', 'ver'\)/)
  assert.match(fuente(...EXPORTA), /requireSection\('reportes', 'exportar'\)/)
})

test('sin ver_empleados la consulta por persona NI SE LANZA', () => {
  // Traerla para esconderla en la vista dejaría el dato saliendo por el CSV,
  // que usa esta misma función.
  const src = fuente(...MOTOR)
  assert.match(src, /opciones\.verEmpleados\s*\?/)
  assert.match(src, /:\s*Promise\.resolve\(null\)/)
})

test('la exportación vuelve a comprobar el permiso de empleados', () => {
  // Con solo `exportar`, el desglose que la pantalla esconde se sacaría
  // cambiando de ruta.
  const src = fuente(...EXPORTA)
  assert.match(src, /puedeFuncion\('reportes', 'ver_empleados'\)/)
  // Y el bloque no va vacío: no va. Un bloque con encabezados y sin filas se
  // lee como «no hubo», que es una afirmación sobre el negocio.
  assert.match(src, /r\.porEmpleado\s*\n?\s*\?/)
  assert.match(src, /OMITIDO - sin permiso ver_empleados/)
})

test('sin permiso la pantalla explica la ausencia en vez de enseñar una tabla vacía', () => {
  assert.match(fuente(...VISTA), /r\.porEmpleado === null/)
})

// ── Reglas de docs/REPORTES.md que este reporte tenía que respetar ───────────

test('la fila «sin asignar» no se esconde', () => {
  // `sucursalId` y `empleadoId` son opcionales. Esconder sus canjes haría que
  // los subtotales no sumaran el total, que es la forma más rápida de que
  // nadie vuelva a confiar en el reporte.
  const src = fuente(...MOTOR)
  assert.match(src, /SIN_ASIGNAR = '\(sin asignar\)'/)
  assert.doesNotMatch(src, /sucursalId: \{ not: null \}/)
  assert.doesNotMatch(src, /empleadoId: \{ not: null \}/)
})

test('las agrupaciones van con tope, y lo recortado se declara', () => {
  // `servicio` es texto libre del formulario: su número de valores distintos no
  // lo acota ningún catálogo, así que un groupBy sin límite trae tantas filas
  // como cosas se hayan tecleado. Recortar a secas rompería la regla que más
  // importa —los subtotales suman el total—, así que el resto va en su fila,
  // calculado restando de los totales del periodo.
  const src = fuente(...MOTOR)
  assert.match(src, /LIMIT \$\{TOPE_GRUPOS\}/)
  assert.match(src, /RESTO = '\(resto, agrupado\)'/)
  assert.match(src, /conElResto\(sucursales, actual\)/)
  assert.match(src, /conElResto\(servicios, actual\)/)
  assert.match(fuente(...VISTA), /resto, agrupado/)
})

test('el tope se aplica sobre la clave, no sobre pares clave+descontado', () => {
  // Con `by: [campo, 'descontado']` un `take` recortaría pares, y un servicio
  // podría salir con solo la mitad de sus canjes: un número mal, no un número
  // de menos.
  const src = fuente(...MOTOR)
  const i = src.indexOf('async function agrupar')
  const cuerpo = src.slice(i, src.indexOf('\n}', i))
  assert.match(cuerpo, /GROUP BY 1/)
  assert.doesNotMatch(cuerpo, /groupBy\(/)
})

test('los totales se agregan en la base, no contando listas', () => {
  const src = fuente(...MOTOR)
  assert.match(src, /groupBy\(/)
  assert.match(src, /count\(DISTINCT "clienteId"\)/)
})

test('el día se corta en la zona horaria del negocio', () => {
  assert.match(fuente(...MOTOR), /AT TIME ZONE/)
})

test('las revertidas no se restan de los canjes: se cuentan aparte', () => {
  // El servicio se dio. Que después se anulara la factura es un hecho
  // posterior, no una razón para fingir que el lavado no ocurrió.
  const src = fuente(...MOTOR)
  assert.match(src, /revertidas: number/)
  assert.doesNotMatch(src, /revertidaAt: null/, 'los canjes no deben excluir las revertidas')
  assert.match(fuente(...VISTA), /No se restan de los canjes/)
})

test('las revertidas se fechan por cuándo se revirtieron', () => {
  // Fecharlas por la visita respondería «cuántas visitas de marzo acabaron
  // anuladas», que no es la pregunta que se hace al cuadrar el mes.
  assert.match(fuente(...MOTOR), /revertidaAt: \{ gte: rango\.desde, lt: rango\.hasta \}/)
})

test('los QR se rotulan como lo que son: bitácora, no visitas', () => {
  // Si no, un QR generado al activar una membresía se leería como un canje y
  // las dos cifras parecerían un descuadre.
  assert.match(fuente(...VISTA), /Sale de la bitácora, no de las visitas/)
})

test('el reporte de operación se alcanza desde la pantalla de reportes', () => {
  const src = fuente('src', 'app', '(admin)', 'admin', 'reportes', 'page.tsx')
  assert.match(src, /\/admin\/reportes\/operacion/)
})

test('el archivo lleva el mismo alcance que la pantalla', () => {
  const src = fuente(...EXPORTA)
  assert.match(src, /leerRango\(sp, timeZone\)/, 'el CSV no debe recalcular el periodo por su cuenta')
  assert.match(src, /Alcance del reporte/)
})
