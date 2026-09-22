import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  alternarCifra,
  CIFRAS_RESUMEN,
  hayPreferencias,
  leerPreferencias,
  moverCifra,
  PREFERENCIAS_VACIAS,
  resolverCifras,
} from '@/modules/reportes/preferencias'

/**
 * QUÉ CIFRAS VE CADA QUIEN (rediseño de reportes · Fase 11).
 *
 * El resumen ejecutivo enseñaba las mismas cinco a todo el mundo. Cinco
 * tarjetas donde dos sobran hacen que las tres que importan se lean peor.
 *
 * Lo que estas pruebas vigilan, por orden de lo que más daño haría:
 *
 *  1. Que una cifra NUEVA aparezca sola para todos. Es la razón de que se
 *     guarde lo oculto y no lo visible: con una lista de «las que sí se ven»,
 *     la métrica que se añada mañana queda escondida para todo el que haya
 *     personalizado alguna vez, y nada falla.
 *  2. Que el permiso mande sobre la preferencia. Un sobre no puede enseñar
 *     dinero a quien no puede verlo.
 *  3. Que nunca se quede el resumen sin cifras.
 *  4. Que un sobre corrupto no tumbe la pantalla.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const TODAS = { verFinancieros: true }
const claves = (pref: Parameters<typeof resolverCifras>[0], o = TODAS) =>
  resolverCifras(pref, o).map((c) => c.clave)

// ────────────── lo que más daño haría: esconder lo nuevo ──────────────

test('se guarda lo OCULTO, nunca la lista de lo visible', () => {
  // Si el sobre guardara «las que sí se ven», una cifra añadida después no
  // estaría en ningún sobre y quedaría escondida sin que nada fallara.
  const nucleo = leer('src/modules/reportes/preferencias.ts')
  assert.match(nucleo, /ocultas: string\[\]/)
  assert.equal(
    /\bvisibles: string\[\]/.test(nucleo),
    false,
    'el sobre empezó a guardar lo visible: lo que se añada mañana quedaría escondido'
  )
})

test('una cifra nueva aparece para quien ya había personalizado', () => {
  // Se simula el caso real: alguien ocultó una, y después el código gana una
  // cifra que su sobre no nombra.
  const pref = leerPreferencias({ v: 1, ocultas: ['entregas'], orden: [] })
  const vistas = claves(pref)
  for (const c of CIFRAS_RESUMEN) {
    if (c.clave === 'entregas') continue
    assert.ok(vistas.includes(c.clave), `«${c.clave}» no le aparece a quien personalizó`)
  }
})

// ────────────── el permiso manda sobre la preferencia ──────────────

test('sin permiso financiero no hay cifras de dinero, diga lo que diga el sobre', () => {
  const pref = leerPreferencias({ v: 1, ocultas: [], orden: ['ingresosCaja'] })
  const vistas = claves(pref, { verFinancieros: false })
  for (const c of CIFRAS_RESUMEN.filter((x) => x.financiera)) {
    assert.equal(vistas.includes(c.clave), false, `«${c.clave}» se coló sin permiso`)
  }
  assert.ok(vistas.length > 0, 'sin permiso financiero el resumen se quedó vacío')
})

test('la acción vuelve a comprobar el permiso, no se fía del formulario', () => {
  // Una server action se despacha por su id desde cualquier ruta permitida:
  // esconder el formulario no la protege.
  const acciones = leer('src/modules/reportes/preferenciasActions.ts')
  assert.match(acciones, /requireSection\('reportes', 'ver'\)/)
  assert.match(acciones, /puedeFuncion\('reportes', 'ver_financieros'\)/)
  // Y el sobre nuevo lo arma el núcleo a partir del guardado, no el formulario.
  assert.equal(
    /data: \{ preferenciasReportes: (?!\{ \.\.\.nuevo)/.test(acciones),
    false,
    'la acción escribe algo que no salió del núcleo puro'
  )
})

// ────────────── nunca un resumen vacío ──────────────

test('no se puede apagar la última cifra', () => {
  let pref = PREFERENCIAS_VACIAS
  for (const c of CIFRAS_RESUMEN) pref = alternarCifra(pref, c.clave, false, TODAS)
  const vistas = claves(pref)
  assert.equal(vistas.length, 1, `quedaron ${vistas.length} cifras; tenía que quedar una`)
})

test('aunque el sobre las oculte todas, el resumen enseña una', () => {
  // Un sobre escrito por una versión anterior, o a mano en la base.
  const pref = leerPreferencias({ v: 1, ocultas: CIFRAS_RESUMEN.map((c) => c.clave), orden: [] })
  assert.equal(claves(pref).length, 1)
  assert.equal(claves(pref, { verFinancieros: false }).length, 1)
})

test('volver a encender una cifra siempre se puede', () => {
  const pref = alternarCifra(PREFERENCIAS_VACIAS, 'entregas', false, TODAS)
  assert.equal(claves(pref).includes('entregas'), false)
  const vuelta = alternarCifra(pref, 'entregas', true, TODAS)
  assert.ok(claves(vuelta).includes('entregas'))
})

// ────────────── el orden ──────────────

test('el orden elegido manda, y lo que no nombra queda detrás', () => {
  const pref = leerPreferencias({ v: 1, ocultas: [], orden: ['clientesNuevos', 'ventas'] })
  const vistas = claves(pref)
  assert.deepEqual(vistas.slice(0, 2), ['clientesNuevos', 'ventas'])
  assert.equal(vistas.length, CIFRAS_RESUMEN.length)
})

test('subir y bajar una cifra intercambia con su vecina, y en los bordes no hace nada', () => {
  const orden0 = claves(PREFERENCIAS_VACIAS)
  const subida = moverCifra(PREFERENCIAS_VACIAS, orden0[1], 'arriba', TODAS)
  assert.deepEqual(claves(subida).slice(0, 2), [orden0[1], orden0[0]])

  // En el primero, subir no puede reordenar nada.
  assert.deepEqual(claves(moverCifra(PREFERENCIAS_VACIAS, orden0[0], 'arriba', TODAS)), orden0)
  const ultima = orden0[orden0.length - 1]
  assert.deepEqual(claves(moverCifra(PREFERENCIAS_VACIAS, ultima, 'abajo', TODAS)), orden0)
})

test('mover una cifra oculta no la enciende por la puerta de atrás', () => {
  const pref = alternarCifra(PREFERENCIAS_VACIAS, 'entregas', false, TODAS)
  const movida = moverCifra(pref, 'entregas', 'arriba', TODAS)
  assert.equal(claves(movida).includes('entregas'), false)
})

// ────────────── un sobre corrupto no tumba la pantalla ──────────────

test('lo que venga en la columna nunca lanza', () => {
  for (const basura of [
    null,
    undefined,
    'texto',
    42,
    [],
    {},
    { v: 2, ocultas: ['ventas'] },
    { v: 1, ocultas: 'ventas' },
    { v: 1, ocultas: [1, 2, 3], orden: null },
    { v: 1, ocultas: ['no-existe', 'ventas', 'ventas'], orden: ['tampoco'] },
  ]) {
    const pref = leerPreferencias(basura)
    assert.equal(pref.v, 1)
    assert.ok(Array.isArray(pref.ocultas) && Array.isArray(pref.orden))
    assert.ok(claves(pref).length > 0, `un sobre raro dejó el resumen vacío: ${JSON.stringify(basura)}`)
  }
  // Las claves que ya no existen se descartan al leer, no más adelante.
  const limpio = leerPreferencias({ v: 1, ocultas: ['no-existe', 'ventas', 'ventas'], orden: [] })
  assert.deepEqual(limpio.ocultas, ['ventas'])
})

test('hayPreferencias distingue quien tocó algo de quien no', () => {
  assert.equal(hayPreferencias(PREFERENCIAS_VACIAS), false)
  assert.equal(hayPreferencias(alternarCifra(PREFERENCIAS_VACIAS, 'ventas', false, TODAS)), true)
})

// ────────────── la pantalla ──────────────

test('la rejilla de cifras no se arma con una clase construida al vuelo', () => {
  // Tailwind lee las clases del código fuente: `lg:grid-cols-${n}` no llega al
  // CSS y el síntoma sería una rejilla de una columna sin que nada falle.
  const vista = leer('src/components/reportes/ReporteEmpresaVista.tsx')
  assert.match(vista, /const REJILLA: Record<number, string>/)
  // Se mira el CÓDIGO: el comentario del mapa cita la forma prohibida para
  // explicar por qué no se usa, que es justo lo que hay que conservar.
  const codigo = vista.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.equal(
    /grid-cols-\$\{/.test(codigo),
    false,
    'una clase de rejilla armada en tiempo de ejecución no existe en el CSS'
  )
})

test('el panel de personalización no se imprime y las ocultas siguen listadas', () => {
  const panel = leer('src/components/reportes/PersonalizarResumen.tsx')
  assert.match(panel, /print:hidden/, 'en el papel no hay nada que pulsar')
  // Si las ocultas desaparecieran de la lista no habría forma de encenderlas.
  assert.match(panel, /ofrecidas\.filter\(\(c\) => !clavesVisibles\.has\(c\.clave\)\)/)
  // Y se puede volver atrás: una personalización sin vuelta es una trampa.
  assert.match(panel, /restablecerCifrasResumen/)
})

test('la columna nueva tiene su migración idempotente', () => {
  const sql = leer('prisma/migrations/20260929_reportes_preferencias/migration.sql')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "preferenciasReportes" JSONB/)
  assert.match(leer('prisma/schema/identidad.prisma'), /preferenciasReportes Json\?/)
  // Y está sellada, o `migrate dev` pedirá un reset al siguiente que toque el esquema.
  assert.match(leer('prisma/migrations/SUMAS.txt'), /20260929_reportes_preferencias/)
})
