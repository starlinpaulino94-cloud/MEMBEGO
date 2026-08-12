import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoAnterior, variacion, whereCobrado } from '../src/modules/pagos/cobrado'

const D = (s: string) => new Date(s)

/** `AND` es `X | X[]` en el tipo de Prisma; aquí siempre lo construimos array. */
const condiciones = (w: { AND?: unknown }) => w.AND as Record<string, unknown>[]

test('cobrado exige pago confirmado', () => {
  const w = whereCobrado(D('2026-08-01T00:00:00Z'))
  assert.deepEqual(condiciones(w)[0], { pagoConfirmado: true })
})

/**
 * EL RESPALDO NO PUEDE CONTAR DOS VECES.
 *
 * `updatedAt` se mira SOLO cuando no hay `fechaPago`. Escrito como dos ramas
 * sueltas de un `OR`, un cobro con fecha propia que además se tocó dentro del
 * rango entraría por las dos y el mes cerraría de más. Que la segunda rama lleve
 * `fechaPago: null` es lo que lo impide.
 */
test('el respaldo por updatedAt solo aplica sin fechaPago', () => {
  const w = whereCobrado(D('2026-08-01T00:00:00Z'))
  const or = condiciones(w)[1].OR as Record<string, unknown>[]
  assert.equal(or.length, 2)
  assert.equal(or[1].fechaPago, null)
})

test('con `hasta` el rango es semiabierto: gte … lt', () => {
  const w = whereCobrado(D('2026-08-01T00:00:00Z'), D('2026-09-01T00:00:00Z'))
  const or = condiciones(w)[1].OR as Record<string, unknown>[]
  const rango = or[0].fechaPago as { gte: Date; lt?: Date }
  assert.ok(rango.lt, 'el fin tiene que ser exclusivo para que dos meses seguidos no compartan un instante')
  assert.equal(rango.gte.toISOString(), '2026-08-01T00:00:00.000Z')
  assert.equal(rango.lt.toISOString(), '2026-09-01T00:00:00.000Z')
})

test('la acotación extra entra en el mismo AND, sin pisar el OR', () => {
  const w = whereCobrado(D('2026-08-01T00:00:00Z'), undefined, { companyId: 'c1' })
  assert.equal(condiciones(w).length, 3)
  assert.deepEqual(condiciones(w)[2], { companyId: 'c1' })
})

test('el periodo anterior mide lo mismo que el actual', () => {
  const desde = D('2026-08-01T00:00:00Z')
  const hasta = D('2026-08-31T00:00:00Z')
  const prev = periodoAnterior(desde, hasta)
  assert.equal(prev.hasta.getTime(), desde.getTime())
  assert.equal(hasta.getTime() - desde.getTime(), prev.hasta.getTime() - prev.desde.getTime())
})

test('variación: sin base previa no se inventa un porcentaje', () => {
  assert.equal(variacion(3, 0), null)
  assert.equal(variacion(0, 0), null)
  assert.equal(variacion(150, 100), 50)
  assert.equal(variacion(50, 100), -50)
})
