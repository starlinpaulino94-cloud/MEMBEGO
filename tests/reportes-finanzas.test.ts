/**
 * FINANZAS · Fase 4.
 *
 * Lo que más se vigila aquí es una frontera: **cobrado no es proyectado**.
 * `docs/auditoria-clientes-membresias.md` (A-2) documenta el fallo que este
 * reporte no puede repetir — el Resumen enseñaba «Ingresos estimados»
 * multiplicando el PRECIO DE LISTA por las membresías activas, lo que no es
 * una caja sino un catálogo: ignora el precio por categoría de vehículo,
 * ignora lo que el cliente pagó, y arrastra las vencidas que nadie desactivó.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function fuente(...ruta: string[]): string {
  return readFileSync(join(__dirname, '..', ...ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const MOTOR = ['src', 'modules', 'reportes', 'finanzas.ts']
const VISTA = ['src', 'components', 'reportes', 'ReporteFinanzasVista.tsx']
const PAGINA = ['src', 'app', '(admin)', 'admin', 'reportes', 'finanzas', 'page.tsx']
const EXPORTA = ['src', 'app', '(admin)', 'admin', 'reportes', 'finanzas', 'export', 'route.ts']

// ── Cobrado ≠ proyectado ─────────────────────────────────────────────────────

test('el recurrente estimado sale de lo que se pagó, no del precio de lista', () => {
  // Es exactamente el fallo A-2. `plan.precio` aquí sería repetirlo.
  const src = fuente(...MOTOR)
  assert.match(src, /montoPagado: \{ not: null \}/)
  assert.doesNotMatch(src, /precio: true/, 'no debe leer el precio de lista del plan')
})

test('el recurrente solo cuenta membresías VIGENTES, no ACTIVA a secas', () => {
  // Una membresía que venció y que nadie desactivó seguiría sumando todos los
  // meses: es el tercer defecto que A-2 documenta.
  const src = fuente(...MOTOR)
  assert.match(src, /membresiaVigente\(/)
})

test('la estimación va rotulada como tal en pantalla y en el archivo', () => {
  assert.match(fuente(...VISTA), /no es dinero cobrado/i)
  assert.match(fuente(...EXPORTA), /ESTIMACION, no dinero cobrado/)
})

test('los dos flujos de ingreso se devuelven separados', () => {
  // Sumarlos en una sola cifra hace imposible cuadrar el reporte contra la
  // caja del día, que es la comprobación que de verdad se hace.
  const src = fuente(...MOTOR)
  assert.match(src, /ingresosCaja:/)
  assert.match(src, /cobrosMembresias:/)
  assert.match(src, /ingresoTotal:/)
})

// ── Qué cuenta como dinero ───────────────────────────────────────────────────

test('solo APPROVED y APPLIED son dinero', () => {
  // PENDING es una intención: sumarla a un ingreso es contar dinero que
  // todavía no existe.
  const src = fuente(...MOTOR)
  assert.match(src, /const COBRADOS = \['APPROVED', 'APPLIED'\]/)
  assert.doesNotMatch(src, /'PENDING'/)
})

test('las anuladas no restan del ingreso: se cuentan aparte', () => {
  const src = fuente(...MOTOR)
  assert.match(src, /const DESHECHOS = \['CANCELLED', 'REVERTED'\]/)
  assert.match(src, /deshechas:/)
})

test('los cobros de membresía se fechan con whereCobrado', () => {
  // La segunda regla de docs/REPORTES.md. Fechar por `updatedAt` haría que
  // editar una membresía vieja moviera su cobro de mes.
  assert.match(fuente(...MOTOR), /whereCobrado\(/)
})

test('la tasa de aprobación sin intentos cerrados es «sin dato», no 0 %', () => {
  // Un 0 % afirmaría que la pasarela rechazó todo.
  assert.match(fuente(...MOTOR), /cerrados === 0 \? null/)
})

// ── Cobrado sin entregar ─────────────────────────────────────────────────────

test('cobrado sin entregar NO se acota al periodo', () => {
  // Es el único descuadre que el cliente descubre antes que el negocio. Un
  // pago atascado en marzo sigue siendo un problema hoy.
  const src = fuente(...MOTOR)
  const fn = src.slice(src.indexOf('async function cobradoSinEntregar'))
  const cuerpo = fn.slice(0, fn.indexOf('\n}'))
  assert.doesNotMatch(cuerpo, /desde|hasta|createdAt/, 'no debe filtrar por fechas')
  assert.match(cuerpo, /fulfillmentEstado: 'PENDIENTE'/)
})

test('la conciliación también lo vigila', () => {
  const src = fuente('src', 'modules', 'observabilidad', 'conciliacion.ts')
  assert.match(src, /clave: 'cobrado-sin-entregar'/)
  assert.match(src, /severidad: 'ALTA'/)
})

// ── Permisos ─────────────────────────────────────────────────────────────────

test('la pantalla entera exige el permiso financiero', () => {
  // Aquí todo es dinero: esconder tarjetas sueltas dejaría una página vacía y
  // una pregunta.
  assert.match(fuente(...PAGINA), /requireSection\('reportes', 'ver_financieros'\)/)
})

test('la exportación exige LOS DOS permisos', () => {
  // Con solo `exportar`, el filtro financiero de la pantalla se saltaría
  // cambiando de ruta.
  const src = fuente(...EXPORTA)
  assert.match(src, /requireSection\('reportes', 'exportar'\)/)
  assert.match(src, /requireSection\('reportes', 'ver_financieros'\)/)
})

test('el enlace al reporte no aparece sin permiso', () => {
  // La forma cambió cuando los enlaces sueltos pasaron a ser un mapa de
  // categorías: antes era `verFinancieros && (<Link…>)`, ahora es una entrada
  // condicional del array. Lo que NO puede cambiar es la regla — el reporte de
  // dinero no se ofrece a quien no puede verlo, porque una puerta cerrada
  // ofrecida es peor que no ofrecerla.
  const src = fuente('src', 'app', '(admin)', 'admin', 'reportes', 'page.tsx')
  const i = src.indexOf("titulo: 'Finanzas y cobros'")
  assert.notEqual(i, -1, 'desapareció la categoría de finanzas del mapa de reportes')
  // La entrada vive DENTRO del condicional del permiso: se busca hacia atrás
  // desde el título hasta la apertura de la lista.
  const antes = src.slice(0, i)
  assert.match(
    antes.slice(-220),
    /\.\.\.\(verFinancieros\s*\n?\s*\?/,
    'la categoría de finanzas dejó de estar detrás de ver_financieros'
  )
})

// ── Reglas de la casa ────────────────────────────────────────────────────────

test('todo va con contexto de empresa y un fallo se dice', () => {
  const src = fuente(...MOTOR)
  assert.match(src, /conEmpresa\(companyId/)
  assert.match(src, /incompleto: fallos\.n > 0/)
})

test('los totales se agregan en la base', () => {
  const src = fuente(...MOTOR)
  assert.match(src, /\.aggregate\(/)
  assert.match(src, /groupBy\(/)
})

test('el método sin registrar se enseña, no se esconde', () => {
  // Si se ocultara, los subtotales dejarían de sumar el total y nadie sabría
  // por qué.
  assert.match(fuente(...MOTOR), /'Sin registrar'/)
})
