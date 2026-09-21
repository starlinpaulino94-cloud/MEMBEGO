/**
 * CICLO DE VIDA DE MEMBRESÍAS · Fase 3.
 *
 * El reporte lee `membresia_eventos` y no el estado de las membresías, que es
 * la diferencia entera: una membresía renovada tres veces sigue siendo UNA fila
 * ACTIVA, así que el estado nunca podría responder «cuántas se renovaron en
 * agosto».
 *
 * Lo que más se vigila aquí no es una fórmula: es que el reporte DIGA hasta
 * dónde llega su dato. Un mes anterior al corte enseña las activaciones en cero
 * sin haberlo estado, y sin el aviso alguien compara agosto con octubre y
 * concluye que el negocio se hundió.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tasaRenovacion } from '../src/modules/membresia/eventosNucleo'

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ── Tasa de renovación ───────────────────────────────────────────────────────

test('la tasa de renovación es renovadas sobre renovadas más bajas', () => {
  assert.equal(tasaRenovacion(8, 2), 80)
  assert.equal(tasaRenovacion(1, 1), 50)
  assert.equal(tasaRenovacion(3, 0), 100)
})

test('sin base es «sin dato», nunca 0 %', () => {
  // 0 % afirma que nadie renovó pudiendo hacerlo. Es una conclusión, no un
  // dato: enseñarla porque la división no se puede hacer sería inventar una
  // mala noticia.
  assert.equal(tasaRenovacion(0, 0), null)
})

test('todas las bajas y ninguna renovación sí es 0 %', () => {
  // Aquí el cero SÍ es verdad: hubo diez oportunidades y no se renovó ninguna.
  assert.equal(tasaRenovacion(0, 10), 0)
})

test('se redondea a entero, no se arrastran decimales', () => {
  assert.equal(tasaRenovacion(1, 2), 33)
  assert.equal(tasaRenovacion(2, 1), 67)
})

// ── Que el reporte no mienta sobre su propio alcance ─────────────────────────

test('el reporte calcula el corte de datos y la pantalla lo pinta', () => {
  const motor = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(motor, /reconstruido: false/, 'el corte se mide con los eventos propios')
  assert.match(motor, /rangoIncompleto/)

  const vista = fuente('src', 'components', 'reportes', 'ReporteMembresiasVista.tsx')
  assert.match(vista, /corte\.rangoIncompleto/, 'la vista no avisa del corte')
})

test('la exportación lleva el corte dentro del archivo', () => {
  // Un CSV de agosto con las activaciones en cero, sin esa línea, es
  // indistinguible de un agosto en el que no se activó nada.
  const src = fuente('src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'export', 'route.ts')
  assert.match(src, /Historial de primera mano desde/)
  assert.match(src, /Periodo anterior al registro/)
})

// ── Aislamiento y permisos ───────────────────────────────────────────────────

test('todas las consultas del reporte filtran por empresa', () => {
  const src = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(src, /conEmpresa\(companyId/)
  // El `companyId` va también en el WHERE, no solo en el contexto: RLS es la
  // segunda barrera, no la única.
  assert.match(src, /"companyId" = \$\{companyId\}/, 'la consulta cruda debe filtrar por empresa')
})

test('las tres pantallas nuevas exigen el permiso de reportes', () => {
  for (const ruta of [
    ['src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'page.tsx'],
    ['src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'detalle', 'page.tsx'],
  ]) {
    assert.match(fuente(...ruta), /requireSection\('reportes', 'ver'\)/, ruta.join('/'))
  }
  const exportar = fuente(
    'src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'export', 'route.ts'
  )
  assert.match(exportar, /requireSection\('reportes', 'exportar'\)/)
})

// ── Reglas de docs/REPORTES.md que este reporte tenía que respetar ───────────

test('los totales salen de count/groupBy, no del largo de una lista', () => {
  const motor = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(motor, /groupBy\(/)
  assert.doesNotMatch(motor, /\.length\s*\}?\s*$/m)

  // El detalle recorta a 300 filas pero su total sale de un `count`: si no,
  // diría 300 cuando hubo 4.000.
  const detalle = fuente(
    'src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'detalle', 'page.tsx'
  )
  assert.match(detalle, /membresiaEvento\.count\(/)
})

test('el día se corta en la zona horaria del negocio', () => {
  const motor = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(motor, /AT TIME ZONE/)
})

test('un fallo se dice, no se enseña como cero', () => {
  const motor = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(motor, /incompleto: fallos\.n > 0/)
})

test('los cambios de plan se clasifican con los precios guardados', () => {
  // Nunca con los del plan hoy: un plan que suba de tarifa mañana convertiría
  // retroactivamente en bajadas los cambios que fueron subidas.
  const motor = fuente('src', 'modules', 'reportes', 'membresias.ts')
  assert.match(motor, /clasificarCambioPlan\(/)
  assert.match(motor, /precioAnterior: true, precioNuevo: true/)
})

test('cada cifra se puede abrir hasta sus filas', () => {
  // Un panel donde «12 cancelaciones» no se puede abrir obliga a creer el
  // número o a no usarlo, y lo segundo es lo que acaba pasando.
  const vista = fuente('src', 'components', 'reportes', 'ReporteMembresiasVista.tsx')
  for (const tipo of ['ACTIVADA', 'RENOVADA', 'CANCELADA', 'VENCIDA', 'CAMBIO_PLAN']) {
    assert.ok(vista.includes(`detalle('${tipo}')`), `falta el detalle de ${tipo}`)
  }
})

test('el detalle hereda el rango de la pantalla, no lo recalcula', () => {
  // Si lo recalculara por su cuenta, el detalle de «12» podría enseñar once
  // filas y nadie sabría cuál de las dos pantallas miente.
  const detalle = fuente(
    'src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'detalle', 'page.tsx'
  )
  assert.match(detalle, /leerRango\(sp, timeZone\)/)
})

test('las filas reconstruidas se marcan en el detalle', () => {
  const detalle = fuente(
    'src', 'app', '(admin)', 'admin', 'reportes', 'membresias', 'detalle', 'page.tsx'
  )
  assert.match(detalle, /reconstruido/)
})
