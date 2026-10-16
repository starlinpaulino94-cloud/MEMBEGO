import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * FASE 4 · los botones «Revisar» de `/admin/conciliacion` ya no mandan a pantallas que no enseñan el caso (H7).
 *
 * Antes: «Cobros sin transacción» → `/admin/pagos` (solo colas de validación), «Cobrados con entrega pendiente» →
 * `/admin/reportes/finanzas` (una cifra) y «Cajas abiertas» → `/admin/app/carwash/turnos` (exige la capacidad TURNOS). Ahora
 * cada hallazgo trae su LISTA de casos y cada caso su acción. Estas aserciones vigilan el cableado; lo que hacen las acciones
 * lo prueba `tests/postgres/pagos-conciliacion.db.test.ts`.
 */

const fuente = (f: string) => readFileSync(f, 'utf8')
const MOTOR = fuente('src/modules/observabilidad/conciliacion.ts')
const ACCIONES = fuente('src/modules/observabilidad/conciliacion-actions.ts')
const SERVICIO = fuente('src/modules/observabilidad/conciliacion-servicio.ts')
const PAGINA = fuente('src/app/(admin)/admin/conciliacion/page.tsx')
const CASOS = fuente('src/components/conciliacion/CasosDeHallazgo.tsx')

const hrefs = () => Object.fromEntries([...MOTOR.matchAll(/clave: '([a-z-]+)'[\s\S]*?href: ([^,\n]+),/g)].map((m) => [m[1]!, m[2]!.trim()]))

test('H7 · los hallazgos que trae lista de casos ya no mandan a una pantalla ajena', () => {
  const e = hrefs()
  for (const clave of ['cobro-sin-transaccion', 'cobrado-sin-entregar', 'entrega-sin-registrar', 'caja-abierta', 'caja-descuadrada']) {
    assert.equal(e[clave], 'null', `${clave}: el caso y su acción están en el propio hallazgo, no en otra pantalla`)
  }
  for (const viejo of ["'/admin/pagos'", "'/admin/reportes/finanzas'", "'/admin/app/carwash/turnos'", "'/admin/reportes'"]) {
    assert.ok(!MOTOR.includes(`href: ${viejo}`), `ya no se usa ${viejo}`)
  }
  assert.match(PAGINA, /<CasosDeHallazgo/, 'la pantalla pinta la lista de casos de cada hallazgo')
})

test('H7 · las cajas abiertas llevan a la caja de esa sucursal (no a una pantalla del vertical car wash)', () => {
  assert.match(CASOS, /\/empleado\/caja\?caja=\$\{caso\.id\}/)
  assert.doesNotMatch(CASOS, /carwash\/turnos/)
  assert.doesNotMatch(PAGINA, /TURNOS/)
})

test('H7 · cada acción del servidor exige la misma función que confirmar un pago y toma la empresa de la sesión', () => {
  assert.match(ACCIONES, /requireSection\('pagos', 'confirmar_pago'\)/)
  assert.match(ACCIONES, /user\.metadata\.companyId|user\?\.metadata\.companyId/)
  assert.doesNotMatch(ACCIONES, /formData|companyId:\s*string\)/, 'la empresa no viene del cliente')
  for (const accion of ['generarComprobanteAccion', 'reintentarEntregaAccion', 'marcarEntregadaAccion']) {
    assert.match(ACCIONES, new RegExp(`export async function ${accion}`))
  }
})

test('H7 · las tres acciones asientan la bitácora y ninguna recobra', () => {
  for (const accion of ['CONCILIACION_COMPROBANTE_GENERADO', 'CONCILIACION_ENTREGA_REINTENTADA', 'CONCILIACION_ENTREGA_MARCADA']) {
    assert.match(SERVICIO, new RegExp(accion))
  }
  assert.doesNotMatch(SERVICIO, /cobrar|cardnet|purchase|autorizar/i, 'la conciliación no toca la pasarela: el dinero ya entró')
})

test('H7 · «Marcar entregada» exige nota y la interfaz no deja enviarla vacía', () => {
  assert.match(SERVICIO, /al menos 5 caracteres/)
  assert.match(CASOS, /disabled=\{!valida \|\| pendiente\}/)
})
