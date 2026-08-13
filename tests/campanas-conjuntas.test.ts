import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAMPANA_ESTADO_LABELS,
  CAMPANA_ESTADOS,
  estadoTrasAplicar,
  leerPlantilla,
  type PlantillaPlan,
} from '../src/modules/superadmin/campanasGlobales'
import {
  FILTROS_ESTADO,
  FILTRO_ESTADO_LABEL,
  hayFiltro,
  hrefCampanas,
  leerFiltroCampanas,
} from '../src/modules/superadmin/campanasFiltros'

/**
 * CAMPAÑAS CONJUNTAS — el reparto.
 *
 * Una sola pulsación escribe promociones y planes REALES en N empresas ajenas.
 * Las guardias van sobre eso: que el resultado se cuente como fue, que quede
 * rastro, y que un fallo no se lleve por delante lo que ya funcionó.
 */

const ACCIONES = readFileSync(join('src', 'modules', 'superadmin', 'campanasActions.ts'), 'utf8')
const MODULO = readFileSync(join('src', 'modules', 'superadmin', 'campanasGlobales.ts'), 'utf8')
const PAGE = readFileSync(
  join('src', 'app', '(superadmin)', 'superadmin', 'campanas', 'page.tsx'),
  'utf8'
)
const BOTONES = readFileSync(
  join('src', 'components', 'superadmin', 'CampanaGlobalAcciones.tsx'),
  'utf8'
)

const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────────── M88 · el estado dice lo que pasó ─────────────────

/**
 * `estado: 'APLICADA'` se escribía SIEMPRE al terminar el bucle. Si fallaban las
 * doce empresas, la campaña quedaba en verde diciendo «Aplicada» con un «12 con
 * error» en una insignia pequeña tres columnas más allá.
 */
test('sin una sola copia creada, la campaña NO queda aplicada', () => {
  assert.equal(estadoTrasAplicar('BORRADOR', 0, 12), 'BORRADOR')
  assert.equal(estadoTrasAplicar('BORRADOR', 0, 0), 'BORRADOR')
})

test('con copias y fallos, se dice a medias', () => {
  assert.equal(estadoTrasAplicar('BORRADOR', 8, 4), 'APLICADA_PARCIAL')
})

test('sin fallos y con copias, aplicada', () => {
  assert.equal(estadoTrasAplicar('BORRADOR', 12, 0), 'APLICADA')
})

/**
 * Volver a aplicar una campaña YA aplicada, para incorporar empresas nuevas, no
 * puede devolverla a borrador cuando no hay nada pendiente.
 */
test('volver a aplicar sin pendientes conserva el estado', () => {
  assert.equal(estadoTrasAplicar('APLICADA', 0, 0), 'APLICADA')
  assert.equal(estadoTrasAplicar('APLICADA_PARCIAL', 0, 0), 'APLICADA_PARCIAL')
})

test('pero si las empresas nuevas fallan, deja de estar limpia', () => {
  assert.equal(estadoTrasAplicar('APLICADA', 0, 3), 'APLICADA_PARCIAL')
})

test('el estado nuevo tiene etiqueta y color propios', () => {
  for (const e of CAMPANA_ESTADOS) assert.ok(CAMPANA_ESTADO_LABELS[e], `${e} sin etiqueta`)
  assert.equal(CAMPANA_ESTADO_LABELS.APLICADA_PARCIAL, 'Aplicada con errores')
  // En ámbar, no en verde: pintarlo igual que un reparto perfecto era el
  // problema original trasladado al color.
  assert.match(PAGE, /APLICADA_PARCIAL: 'bg-warning\/15 text-warning'/)
})

test('la fecha de aplicación solo se toca si salió algo', () => {
  // Si no, seguiría diciendo «aplicada el martes» sobre un reparto que no
  // ocurrió.
  assert.match(ACCIONES, /\.\.\.\(creadas > 0 \? \{ aplicadaAt: new Date\(\) \} : \{\}\)/)
})

// ───────────── M89, M90 · el rastro ─────────────

/**
 * El reparto creaba planes y promociones con `tx.plan.create` directos,
 * saltándose la bitácora del catálogo: la operación que más filas escribe del
 * panel no dejaba ni una línea sobre las filas que creaba.
 */
test('cada copia creada deja su línea en la bitácora', () => {
  assert.match(ACCIONES, /accion: 'PLAN_CREADO'/)
  assert.match(ACCIONES, /accion: 'PROMOCION_CREADA'/)
  // Y va en la MISMA transacción que la fila creada: no puede existir una
  // promoción en la empresa de otro sin constancia de quién la puso ahí.
  const bloque = ACCIONES.slice(ACCIONES.indexOf('async function auditarCopia'))
  assert.match(bloque, /tx\.auditLog\.create/)
})

test('la línea dice que vino de una campaña, no del negocio', () => {
  assert.match(ACCIONES, /origen: 'CAMPANA_CONJUNTA'/)
})

test('aplicar y archivar tienen su propia acción, no NOTA_INTERNA', () => {
  // Iban como `NOTA_INTERNA` con un `payload.tipo` que ni siquiera estaba en
  // `SUBTIPO_LABEL`: salían en crudo y no se podían filtrar en Auditoría.
  assert.match(ACCIONES, /accion: 'CAMPANA_APLICADA'/)
  assert.match(ACCIONES, /accion: 'CAMPANA_ARCHIVADA'/)
  const codigo = sinComentarios(ACCIONES)
  assert.ok(
    !/CAMPANA_GLOBAL_APLICADA|CAMPANA_GLOBAL_ARCHIVADA/.test(codigo),
    'los subtipos sin etiqueta no pueden volver'
  )
})

test('archivar registra el nombre de la campaña', () => {
  // Sin él, la línea dice cuántas ofertas se apagaron pero no de qué campaña.
  const bloque = ACCIONES.slice(ACCIONES.indexOf("accion: 'CAMPANA_ARCHIVADA'"))
  assert.match(bloque, /campana: campana\.nombre/)
})

// ───────────── M91 · autorizar antes de abrir la transacción ─────────────

test('la autorización va fuera de la transacción', () => {
  // Estaba dentro: se tomaba una conexión del pool para averiguar después si
  // quien llamaba podía.
  for (const fn of ['crearCampanaGlobal', 'aplicarCampanaGlobal', 'archivarCampanaGlobal']) {
    const i = ACCIONES.indexOf(`export async function ${fn}`)
    assert.ok(i > 0, `no se encontró ${fn}`)
    const bloque = ACCIONES.slice(i, i + 900)
    const auth = bloque.indexOf('await soloSuperadmin()')
    const tx = bloque.indexOf('sinEmpresa(')
    assert.ok(auth > 0, `${fn} tiene que autorizar`)
    assert.ok(auth < tx || tx === -1, `${fn} autoriza DESPUÉS de abrir la transacción`)
  }
})

// ───────────── M92 · las de práctica ─────────────

test('«todas las empresas» deja fuera las de práctica', () => {
  // Recibían la oferta real como cualquier negocio, sin avisar — y encima al
  // VOLVER a aplicar, mucho después de crear la campaña.
  const veces = [...ACCIONES.matchAll(/isActive: true, esDemo: false/g)].length
  assert.equal(veces, 2, 'hay que excluirlas al crear Y al volver a aplicar')
})

test('pero se pueden seguir eligiendo a mano', () => {
  // La lista del formulario no las filtra: excluirlas de «todas» no es
  // esconderlas.
  assert.match(ACCIONES, /where: \{ id: \{ in: elegidas \} \}/)
  assert.match(PAGE, /Empresas de práctica/)
})

// ───────────── M93 · una transacción por empresa ─────────────

/**
 * El reparto entero corría dentro de un solo `sinEmpresa`. Con doscientas
 * empresas es una transacción larguísima sosteniendo una conexión, y si agotaba
 * su tiempo se perdía TODO — incluidas las copias ya creadas.
 */
test('cada copia va en su propia transacción', () => {
  assert.match(ACCIONES, /await conEmpresa\(paso\.companyId, async \(tx\) => \{/)
  assert.match(ACCIONES, /await conEmpresa\(p\.companyId, async \(tx\) => \{/)
})

test('la marca de aplicada viaja con la fila que la justifica', () => {
  // Si se escribieran aparte, un corte entre las dos dejaría una promoción sin
  // registro —que se duplicaría al volver a aplicar— o al revés.
  const inicio = ACCIONES.indexOf('await conEmpresa(p.companyId')
  assert.ok(inicio > 0, 'no se encontró el reparto por empresa')
  // Se busca el cierre DESDE ahí: la rama de cadena tiene su propio `creadas++`
  // más arriba, y buscarlo desde el principio daba un tramo vacío.
  const bloque = ACCIONES.slice(inicio, ACCIONES.indexOf('creadas++', inicio))
  assert.match(bloque, /tx\.campanaGlobalEmpresa\.update/)
  assert.match(bloque, /auditarCopia\(tx, \{/)
})

// ───────────── M94 · editar el borrador ─────────────

test('solo se puede editar mientras sea BORRADOR, y lo decide el servidor', () => {
  // Aplicada, las copias ya viven en empresas ajenas: cambiar la plantilla no
  // las tocaría, así que la campaña diría una cosa y las empresas otra.
  const bloque = ACCIONES.slice(ACCIONES.indexOf('export async function editarCampanaBorrador'))
  assert.match(bloque, /campana\.estado !== 'BORRADOR'/)
  assert.match(bloque, /const user = await soloSuperadmin\(\)/)
})

// ───────────── M96 · la plantilla completa el plan ─────────────

test('la plantilla de plan lleva beneficios y orden', () => {
  const p = leerPlantilla('PLAN', {
    nombre: 'X',
    beneficios: ['uno', '  ', 'dos'],
    orden: 3,
  }) as PlantillaPlan
  assert.deepEqual(p.beneficios, ['uno', 'dos'], 'las líneas vacías se descartan')
  assert.equal(p.orden, 3)
})

test('y una plantilla vieja sin esos campos se sigue leyendo', () => {
  // Las campañas guardadas antes de este cambio no pueden romperse.
  const p = leerPlantilla('PLAN', { nombre: 'X', precio: 100 }) as PlantillaPlan
  assert.deepEqual(p.beneficios, [])
  assert.equal(p.orden, 0)
})

test('la copia usa esos campos en vez de nacer vacía', () => {
  assert.match(ACCIONES, /beneficios: t\.beneficios \?\? \[\]/)
  assert.match(ACCIONES, /orden: t\.orden \?\? 0/)
  assert.ok(
    !/beneficios: \[\],/.test(sinComentarios(ACCIONES)),
    'la copia ya no nace sin la lista de lo que incluye'
  )
})

// ───────────── M95 · filtros ─────────────

test('sin parámetros: todo, página 1', () => {
  assert.deepEqual(leerFiltroCampanas({}), { q: '', estado: 'todos', pagina: 1 })
  assert.equal(hayFiltro(leerFiltroCampanas({})), false)
})

test('un valor inventado degrada al de por defecto', () => {
  assert.equal(leerFiltroCampanas({ estado: 'LO_QUE_SEA' }).estado, 'todos')
  assert.equal(leerFiltroCampanas({ pagina: '-2' }).pagina, 1)
})

test('«con errores» es una pregunta, no un estado guardado', () => {
  assert.equal(leerFiltroCampanas({ estado: 'con-errores' }).estado, 'con-errores')
  // Se resuelve en la base con un filtro de relación, no trayendo todo.
  assert.match(MODULO, /participantes: \{ some: \{ error: \{ not: null \} \} \}/)
})

test('todo filtro de estado tiene etiqueta', () => {
  for (const e of FILTROS_ESTADO) assert.ok(FILTRO_ESTADO_LABEL[e], `${e} saldría en crudo`)
})

test('paginar conserva los filtros y la página 1 no ensucia la URL', () => {
  const f = leerFiltroCampanas({ q: 'verano', estado: 'con-errores' })
  const url = hrefCampanas(f, '/x', { pagina: 2 })
  assert.ok(url.includes('q=verano') && url.includes('estado=con-errores') && url.includes('pagina=2'))
  assert.equal(hrefCampanas(leerFiltroCampanas({}), '/x'), '/x')
})

test('la lista pagina en la base', () => {
  assert.match(MODULO, /skip: \(f\.pagina - 1\) \* POR_PAGINA/)
  assert.ok(!/take: 100/.test(sinComentarios(MODULO)), 'el tope fijo dejaba la 101 inalcanzable')
})

// ───────────── M97, M98 · la pantalla ─────────────

test('la insignia de errores lleva a la campaña', () => {
  // Era un `<span>` que no se podía pulsar: el detalle del fallo había que
  // buscarlo a mano.
  const i = PAGE.indexOf('c.conError > 0')
  assert.ok(i > 0)
  assert.match(PAGE.slice(i, i + 400), /<Link\s+href=\{`\$\{BASE\}\/\$\{c\.id\}`\}/)
})

test('el encabezado dice de qué es el «3/5»', () => {
  assert.match(PAGE, />Empresas con su copia</)
})

test('la confirmación es la del sistema, no la del navegador', () => {
  const codigo = sinComentarios(BOTONES)
  assert.ok(!/window\.confirm/.test(codigo), 'usa ConfirmDialog')
  assert.match(BOTONES, /<ConfirmDialog/)
  // Y la de archivar sigue marcada como peligrosa.
  assert.match(BOTONES, /isDangerous/)
})

test('los plurales no se escriben a mano', () => {
  const codigo = sinComentarios(BOTONES)
  assert.ok(!/\$\{[^}]*!== 1 \? 's' : ''\}/.test(codigo))
  assert.ok(!/=== 1 \? '' : 's'/.test(codigo))
  assert.match(BOTONES, /from '@\/lib\/plural'/)
})

test('un reparto sin ninguna copia se avisa como error, no como éxito', () => {
  // El aviso tiene que decir lo mismo que el estado.
  assert.match(BOTONES, /if \(creadas === 0 && fallos > 0\)/)
  assert.match(BOTONES, /toast\.error\(`No se creó ninguna copia/)
})

test('la tabla es legible para quien no la ve', () => {
  assert.match(PAGE, /<caption className="sr-only">/)
  assert.match(PAGE, /scope="col"/)
})
