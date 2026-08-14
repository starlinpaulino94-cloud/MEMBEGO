/**
 * Reversa de un canje · propiedades del contrato y de la ruta.
 * Ejecutar: npm test
 *
 * El servicio toca la base, así que aquí NO se ejecuta: lo que se protege es lo
 * que se puede romper leyendo el código y no se nota hasta que a un cliente le
 * sobran dos lavados. Tres propiedades, y las tres cuestan dinero si se pierden:
 *
 *   1. El doble abono se impide en el WHERE, no en un `if` previo.
 *   2. El saldo solo se devuelve si en su día se descontó.
 *   3. La clave de idempotencia se reserva ANTES de revertir.
 *
 * Son pruebas de código fuente. Se leen raro y valen igual: una condición de
 * carrera no se reproduce en un test unitario, pero SÍ se puede comprobar que
 * el candado sigue donde tiene que estar.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const servicio = readFileSync('src/modules/visitas/reversa.ts', 'utf8')
const ruta = readFileSync(
  'src/app/api/platform/v1/redemptions/[id]/reverse/route.ts',
  'utf8'
)

// ── El candado contra el doble abono ────────────────────────────────────────

test('el guard va en el WHERE del update, no en un if previo', () => {
  // `updateMany({ where: { id, revertidaAt: null } })` es lo que hace imposible
  // que dos peticiones simultáneas devuelvan dos lavados. Un `if
  // (visita.revertidaAt) return` antes del update deja la ventana abierta entre
  // la lectura y la escritura, que es justo donde caben las dos.
  const bloque = servicio.slice(servicio.indexOf('updateMany'))
  assert.ok(
    /where:\s*\{\s*id:[^}]*revertidaAt:\s*null/.test(bloque.slice(0, 400)),
    'el WHERE del updateMany debe exigir revertidaAt: null'
  )
})

test('el lavado se devuelve DESPUÉS de comprobar que el guard ganó', () => {
  const posGuard = servicio.indexOf('marcada.count === 0')
  const posAbono = servicio.indexOf('increment: 1')
  assert.ok(posGuard > 0 && posAbono > posGuard,
    'incrementar el saldo antes del guard devolvería lavados en cada reintento')
})

// ── Ilimitados ──────────────────────────────────────────────────────────────

test('el saldo solo se devuelve si la visita lo descontó', () => {
  // Sumar un lavado a una membresía ilimitada le inventa un saldo que su plan
  // no tiene, y el cliente empieza a ver "1 lavado restante" en un plan sin
  // límite.
  const bloque = servicio.slice(servicio.indexOf('marcada.count === 0'))
  const iDescontado = bloque.indexOf('visita.descontado')
  const iIncrement = bloque.indexOf('increment: 1')
  assert.ok(iDescontado > 0 && iDescontado < iIncrement,
    'el increment debe estar dentro de la condición visita.descontado')
})

// ── Idempotencia ────────────────────────────────────────────────────────────

test('la clave de idempotencia se reserva ANTES de revertir', () => {
  const iReserva = ruta.indexOf('conIdempotencia')
  const iRevertir = ruta.indexOf('revertirVisita(')
  assert.ok(iReserva > 0 && iReserva < iRevertir,
    'revertir y luego reservar deja que dos reintentos reviertan los dos')
})

test('la clave de idempotencia es obligatoria', () => {
  assert.ok(ruta.includes('IDEMPOTENCY_KEY_REQUIRED'),
    'sin clave, un reintento de red devuelve el lavado dos veces')
})

test('un rechazo también se guarda en la idempotencia', () => {
  // Si solo se guardara el éxito, el reintento de un satélite que ya recibió
  // «no existe» volvería a ejecutar y podría encontrarse otra respuesta.
  const bloqueFallo = ruta.slice(ruta.indexOf('if (!resultado.ok)'))
  assert.ok(bloqueFallo.slice(0, 600).includes('idem.guardar'),
    'el camino de rechazo debe guardar su respuesta')
})

// ── El motivo ───────────────────────────────────────────────────────────────

test('revertir sin motivo se rechaza en los DOS lados', () => {
  assert.ok(ruta.includes("reason is required"), 'la ruta lo exige')
  assert.ok(servicio.includes("'SIN_MOTIVO'"), 'y el servicio no se fía de la ruta')
})

// ── La empresa ──────────────────────────────────────────────────────────────

test('la empresa se comprueba contra la de la visita, no se cree', () => {
  assert.ok(
    servicio.includes('actor.companyId !== companyId'),
    'un satélite acotado no puede revertir la visita de otra empresa ni con su id'
  )
})

// ── No se borra ─────────────────────────────────────────────────────────────

test('la reversa NUNCA borra la visita', () => {
  for (const borrado of ['visit.delete', 'visit.deleteMany']) {
    assert.ok(!servicio.includes(borrado),
      `${borrado} dejaría el saldo cuadrado y el historial mintiendo`)
  }
})
