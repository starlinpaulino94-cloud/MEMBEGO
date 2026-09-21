import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * OPERACIÓN · EL DETALLE CANJE POR CANJE (reportes · Fase 6).
 *
 * El reporte decía «418 canjes» y ahí se acababa. Lo que estas guardias fijan:
 *
 *  1. Que cada pestaña use EL MISMO criterio que la cifra que abre —las
 *     revertidas por `revertidaAt`, las demás por `fechaVisita`—. Si difirieran,
 *     el reporte diría 12 y el detalle enseñaría once filas, y nadie sabría
 *     cuál de las dos pantallas miente.
 *  2. Que filas y total compartan el where, por lo mismo.
 *  3. Que `ver_empleados` mande EN LA CONSULTA: sin el permiso, los nombres de
 *     personas no se piden a la base. Esconder la columna en la vista dejaría
 *     el dato viajando igual.
 *  4. Que el detalle esté ENLAZADO. Un detalle que no se alcanza no existe:
 *     es exactamente el estado del que venimos.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')

const DETALLE = 'src/app/(admin)/admin/reportes/operacion/detalle/page.tsx'
const VISTA = 'src/components/reportes/ReporteOperacionVista.tsx'
const PAGINA = 'src/app/(admin)/admin/reportes/operacion/page.tsx'

test('las revertidas se fechan por cuándo se revirtieron, como la cifra del reporte', () => {
  const src = leer(DETALLE)
  assert.match(
    src,
    /vista === 'REVERTIDAS'[\s\S]{0,200}revertidaAt: \{ gte: rango\.desde, lt: rango\.hasta \}/,
    'la pestaña de revertidas no usa el mismo criterio que la cifra del reporte'
  )
  // Y se ordenan por lo mismo: una lista de «revertidas este mes» ordenada por
  // la fecha de la visita pone arriba la más vieja de revertir.
  //
  // Desde que el orden se puede cambiar (Fase 7 del rediseño) eso ya no está
  // escrito en la consulta: es el PRIMER campo que `camposDe` devuelve para esa
  // pestaña, que es el que se usa mientras la URL no pida otro.
  assert.match(
    src.slice(src.indexOf('return vista === ')),
    /return vista === 'REVERTIDAS' \? \[revertida,/,
    'la pestaña de revertidas ya no arranca ordenada por cuándo se revirtió'
  )
  assert.match(
    src,
    /clave: 'revertida'[\s\S]{0,200}orderBy: \(d\) => \[\{ revertidaAt: d \}/,
    'el campo «revertida» ya no ordena por revertidaAt'
  )
})

test('cada pestaña recorta la cifra que dice abrir', () => {
  const src = leer(DETALLE)
  assert.match(src, /vista === 'DESCONTADOS' \? \{ descontado: true \}/, 'DESCONTADOS no filtra')
  assert.match(src, /vista === 'SIN_DESCONTAR' \? \{ descontado: false \}/, 'SIN_DESCONTAR no filtra')
})

test('filas y total comparten el MISMO where', () => {
  const src = leer(DETALLE)
  assert.match(src, /tx\.visit\.count\(\{ where \}\)/, 'el total no usa el mismo where que las filas')
  assert.match(src, /tx\.visit\.findMany\(\{\n\s*where,/, 'las filas no usan el where compartido')
})

test('el where lleva SIEMPRE la empresa: un id ajeno en la URL no abre nada de otro inquilino', () => {
  const src = leer(DETALLE)
  const where = src.slice(src.indexOf('const where = {'), src.indexOf('const [filasCrudas'))
  assert.match(where, /^\s*companyId,$/m, 'el where del detalle no acota por empresa')
})

test('sin ver_empleados los nombres de personas NI SE PIDEN a la base', () => {
  const src = leer(DETALLE)
  assert.match(
    src,
    /\.\.\.\(verEmpleados\s*\n?\s*\? \{\s*\n?\s*empleado: \{ select: \{ name: true \} \},\s*\n?\s*revertidaPor: \{ select: \{ name: true \} \},/,
    'el select trae los nombres de empleado sin comprobar el permiso'
  )
  // Y el filtro por empleado tampoco se lee sin permiso: si se leyera, viajaría
  // pegado a las pestañas y a los enlaces de vuelta.
  assert.match(src, /verEmpleados \? leerParam\('empleado'\) : ''/)
})

test('el detalle está ENLAZADO desde el reporte, no escondido', () => {
  const vista = leer(VISTA)
  assert.match(vista, /Ver el detalle canje por canje/, 'el enlace prominente al detalle desapareció')
  for (const v of ['CANJES', 'DESCONTADOS', 'SIN_DESCONTAR', 'REVERTIDAS']) {
    assert.match(vista, new RegExp(`detalle\\('${v}'\\)`), `la cifra ${v} no se puede abrir`)
  }
})

test('el detalle hereda el MISMO periodo y los MISMOS filtros que el reporte', () => {
  // Si el detalle recalculara el rango por su cuenta, el de «12» podría
  // enseñar once filas. Y si perdiera el filtro de sucursal, abriría la cifra
  // de otra.
  const page = leer(PAGINA)
  assert.match(page, /qs=\{qsExport\}/, 'el reporte no le pasa su periodo y filtros al detalle')
  const src = leer(DETALLE)
  assert.match(src, /leerRango\(sp, timeZone\)/, 'el detalle recalcula el periodo por su cuenta')
  assert.match(src, /leerParam\('sucursal'\)/, 'el detalle ignora el filtro de sucursal')
})

test('una visita revertida no se disfraza de canje normal fuera de su pestaña', () => {
  assert.match(
    leer(DETALLE),
    /!esRevertidas && f\.revertidaAt/,
    'la marca de «revertida» desapareció de las demás pestañas'
  )
})

test('los desplegables del detalle tienen nombre accesible', () => {
  const src = leer(DETALLE)
  assert.match(src, /aria-label="Buscar por cliente"/)
  assert.match(src, /aria-label="Filtrar por sucursal"/)
  assert.match(src, /aria-label="Filtrar por empleado"/)
})
