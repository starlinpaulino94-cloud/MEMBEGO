import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * FASE 0 · los botones «Revisar» de `/admin/conciliacion` — caracterización (H7).
 *
 * Cada hallazgo manda a una pantalla que no enseña los casos que el hallazgo cuenta. Estas aserciones fijan el
 * estado actual para que la fase 4 (conciliación accionable) las invierta a la vista, con una lista de casos por
 * hallazgo y acciones auditadas.
 */

const fuente = (f: string) => readFileSync(f, 'utf8')
const enlaces = () => {
  const s = fuente('src/modules/observabilidad/conciliacion.ts')
  return Object.fromEntries([...s.matchAll(/clave: '([a-z-]+)'[\s\S]*?href: '([^']+)'/g)].map((m) => [m[1]!, m[2]!]))
}

test('H7 · «Cobros sin transacción» y «Pagos cobrados con entrega pendiente» mandan a pantallas que no listan esos casos', () => {
  const e = enlaces()
  assert.equal(e['cobro-sin-transaccion'], '/admin/pagos')
  assert.equal(e['cobrado-sin-entregar'], '/admin/reportes/finanzas')

  // `/admin/pagos` solo lista las colas de validación (transferencias, compras en sucursal, cambios de plan): nunca un
  // pago con tarjeta ya aprobado ni una `Transaction` faltante.
  const pagos = fuente('src/app/(admin)/admin/pagos/page.tsx')
  assert.doesNotMatch(pagos, /pagoIntento|cobro-sin-transaccion|transacciones:\s*\{\s*none/, 'DEFECTO H7: no hay lista de cobros sin transacción')

  // `/admin/reportes/finanzas` enseña una CIFRA («N pagos ya se cobraron y su entrega sigue pendiente»), no los pagos ni una acción.
  const vista = fuente('src/components/reportes/ReporteFinanzasVista.tsx')
  assert.match(vista, /cobradoSinEntregar\.total > 0/)
  assert.doesNotMatch(vista, /reintentarEntrega|Reintentar/, 'DEFECTO H7: sin botón para reintentar la entrega')
})

test('H7 · «Cajas abiertas de días anteriores» manda a una pantalla del vertical car wash que exige la capacidad TURNOS', () => {
  assert.equal(enlaces()['caja-abierta'], '/admin/app/carwash/turnos')
  const turnos = fuente('src/app/(admin)/admin/app/carwash/turnos/page.tsx')
  assert.match(turnos, /tieneCapacidad\(companyId, 'TURNOS'\)/, 'DEFECTO H7: un negocio sin esa capacidad no ve ninguna caja')
})

test('H7 · el motor de enlaces es comprobable: los tres hallazgos del sprint tienen un enlace', () => {
  const e = enlaces()
  for (const clave of ['cobro-sin-transaccion', 'cobrado-sin-entregar', 'caja-abierta']) assert.ok(e[clave], clave)
})
