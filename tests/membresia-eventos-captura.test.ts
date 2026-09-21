import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TODO CAMBIO DE UNA MEMBRESÍA DEJA SU EVENTO (reportes · Fase 2).
 *
 * El reporte de ciclo de vida lee `membresia_eventos`; lo que no se escribe ahí
 * no existe para quien pregunta «¿qué pasó con esta membresía?». La auditoría
 * encontró cuatro caminos que cambiaban la membresía SIN dejar su evento:
 *
 *   · extender la vigencia («la fecha de lavado») → solo una nota genérica
 *   · ajustar los lavados (panel y superadmin)    → solo una nota genérica
 *   · el cambio de plan APROBADO (a solicitud)    → sin evento (el directo sí)
 *   · crear la membresía (PENDIENTE)              → cero rastro
 *   · rechazar un cambio de plan                  → cero rastro
 *
 * Estas guardias fijan que cada camino escribe lo suyo. Estructurales a
 * propósito: la escritura es glue de Prisma; la lógica del evento ya se prueba
 * en el núcleo.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8').replace(/\r\n/g, '\n')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** El cuerpo de una función exportada, acotado a la SIGUIENTE exportación. */
function cuerpoDe(src: string, nombre: string): string {
  const i = src.indexOf(`export async function ${nombre}`)
  assert.notEqual(i, -1, `no se encontró ${nombre}`)
  const fin = src.indexOf('\nexport ', i + 1)
  return src.slice(i, fin === -1 ? undefined : fin)
}

test('el enum y el tipo conocen AJUSTADA (vigencia extendida / lavados corregidos)', () => {
  assert.match(leer('prisma/schema/membresias.prisma'), /\n\s*AJUSTADA\n/)
  assert.match(codigo('src/modules/membresia/eventosNucleo.ts'), /'AJUSTADA'/)
  // Y su migración existe y es aditiva.
  const sql = leer('prisma/migrations/20260928_membresia_evento_ajustada/migration.sql')
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'AJUSTADA'/)
})

test('extender la vigencia escribe su evento AJUSTADA, no solo la nota', () => {
  const fn = cuerpoDe(codigo('src/modules/superadmin/membresiaActions.ts'), 'ajustarVencimientoMembresia')
  assert.match(fn, /registrarEventoMembresia\(/, 'no escribe la historia de la membresía')
  assert.match(fn, /tipo: 'AJUSTADA'/)
  assert.match(fn, /ajuste: 'VENCIMIENTO'/)
})

test('ajustar lavados escribe su evento AJUSTADA en los DOS paneles', () => {
  const superadmin = cuerpoDe(codigo('src/modules/superadmin/membresiaActions.ts'), 'ajustarLavadosMembresia')
  assert.match(superadmin, /tipo: 'AJUSTADA'/)
  assert.match(superadmin, /ajuste: 'LAVADOS'/)

  const admin = cuerpoDe(codigo('src/modules/admin/ajusteLavadosActions.ts'), 'ajustarLavados')
  assert.match(admin, /tipo: 'AJUSTADA'/)
  assert.match(admin, /ajuste: 'LAVADOS'/)
})

test('el cambio de plan APROBADO escribe el mismo CAMBIO_PLAN que el directo', () => {
  // Dos caminos del mismo hecho no pueden dejar historias distintas: el
  // aprobado solo escribía un PAGO_APROBADO y el reporte no lo veía.
  const src = codigo('src/modules/admin/actions.ts')
  const aprobar = cuerpoDe(src, 'aprobarCambioPlan')
  assert.match(aprobar, /tipo: 'CAMBIO_PLAN'/)
  // Con los DOS precios del momento, como el directo: sin ellos la clase
  // (subida/bajada) se inventaría con tarifas de hoy.
  assert.match(aprobar, /precioAnterior:/)
  assert.match(aprobar, /precioNuevo:/)
})

test('crear una membresía deja su primera línea de historia (CREADA)', () => {
  const fn = cuerpoDe(codigo('src/modules/admin/actions.ts'), 'crearMembresia')
  assert.match(fn, /tipo: 'CREADA'/)
  assert.match(fn, /estadoNuevo: 'PENDIENTE'/)
})

test('rechazar un cambio de plan deja rastro con su motivo', () => {
  const fn = cuerpoDe(codigo('src/modules/admin/actions.ts'), 'rechazarCambioPlan')
  assert.match(fn, /CAMBIO_PLAN_RECHAZADO/)
  assert.match(fn, /motivo/)
})
