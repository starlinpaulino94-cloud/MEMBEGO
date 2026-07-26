/**
 * Canje de recompensas · pruebas de las reglas que deciden si un QR se puede
 * usar. Ejecutar: npm test
 *
 * Complementa a `tests/referidos-e6.test.ts` (que cubre los casos base de
 * `validarConsumoCompra`) con lo que NO estaba cubierto: los BORDES, que es
 * donde se cuelan los canjes indebidos — el instante exacto del vencimiento,
 * la medianoche en la zona horaria del negocio, y el último uso disponible.
 *
 * También cubre la máquina de estados de la COLA de vehículos, que se envió
 * sin pruebas.
 */

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarConsumoCompra } from '../src/modules/promociones/compra'
import {
  COLA_ACTIVOS,
  COLA_ESTADOS,
  COLA_ESTADO_LABELS,
  COLA_TRANSICIONES,
  type ColaEstado,
} from '../src/modules/carwash/cola'

const TZ = 'America/Santo_Domingo'
const SIN_RESTRICCION = { diasPermitidos: [] as number[], horaDesde: null, horaHasta: null }

/** Compra activa con un uso disponible y sin vencimiento, salvo lo que se pise. */
function compraActiva(over: Partial<Parameters<typeof validarConsumoCompra>[0]> = {}) {
  return {
    estado: 'ACTIVA' as const,
    fechaVencimiento: null,
    usosRestantes: 1,
    ...over,
  }
}

// ── Bordes del vencimiento ───────────────────────────────────────────────────

test('en el INSTANTE exacto del vencimiento el canje ya no procede', () => {
  const momento = new Date('2026-03-10T15:00:00Z')
  const r = validarConsumoCompra(
    compraActiva({ fechaVencimiento: momento }),
    SIN_RESTRICCION,
    momento,
    TZ
  )
  assert.equal(r.puedeUsar, false)
  assert.equal(r.expiro, true, 'debe marcarse para expirar (lazy)')
})

test('un segundo ANTES del vencimiento el canje sí procede', () => {
  const vence = new Date('2026-03-10T15:00:00Z')
  const ahora = new Date('2026-03-10T14:59:59Z')
  const r = validarConsumoCompra(
    compraActiva({ fechaVencimiento: vence }),
    SIN_RESTRICCION,
    ahora,
    TZ
  )
  assert.equal(r.puedeUsar, true)
})

// ── Bordes de los usos ───────────────────────────────────────────────────────

test('el ÚLTIMO uso disponible se puede canjear', () => {
  const r = validarConsumoCompra(compraActiva({ usosRestantes: 1 }), SIN_RESTRICCION, new Date(), TZ)
  assert.equal(r.puedeUsar, true)
})

test('sin usos restantes se rechaza (no se canjea dos veces)', () => {
  const r = validarConsumoCompra(compraActiva({ usosRestantes: 0 }), SIN_RESTRICCION, new Date(), TZ)
  assert.equal(r.puedeUsar, false)
  assert.match(r.mensaje ?? '', /usos/i)
})

test('un contador negativo también se rechaza (defensa ante datos corruptos)', () => {
  const r = validarConsumoCompra(compraActiva({ usosRestantes: -1 }), SIN_RESTRICCION, new Date(), TZ)
  assert.equal(r.puedeUsar, false)
})

// ── Zona horaria: el día del negocio, no el del servidor ─────────────────────

test('la medianoche se evalúa en la zona del negocio, no en UTC', () => {
  // 2026-03-10T03:30:00Z son las 23:30 del LUNES 9 en Santo Domingo (UTC−4).
  // Si se evaluara en UTC, el sistema creería que es martes 10 y aplicaría el
  // día equivocado: un cliente podría canjear en un día no permitido.
  const instante = new Date('2026-03-10T03:30:00Z')
  const soloLunes = { diasPermitidos: [1], horaDesde: null, horaHasta: null }
  const soloMartes = { diasPermitidos: [2], horaDesde: null, horaHasta: null }

  assert.equal(
    validarConsumoCompra(compraActiva(), soloLunes, instante, TZ).puedeUsar,
    true,
    'en RD sigue siendo lunes'
  )
  assert.equal(
    validarConsumoCompra(compraActiva(), soloMartes, instante, TZ).puedeUsar,
    false,
    'todavía no es martes en RD'
  )
})

test('el horario permitido se respeta en los extremos', () => {
  // 14:00 en Santo Domingo = 18:00 UTC.
  const instante = new Date('2026-03-10T18:00:00Z')
  const ventana = { diasPermitidos: [] as number[], horaDesde: '14:00', horaHasta: '18:00' }
  assert.equal(
    validarConsumoCompra(compraActiva(), ventana, instante, TZ).puedeUsar,
    true,
    'justo al abrir la ventana debe permitirse'
  )

  const antes = new Date('2026-03-10T17:59:00Z') // 13:59 local
  assert.equal(validarConsumoCompra(compraActiva(), ventana, antes, TZ).puedeUsar, false)
})

// ── Estados no canjeables ────────────────────────────────────────────────────

test('una compra ya consumida o cancelada nunca se canjea', () => {
  for (const estado of ['CONSUMIDA', 'CANCELADA', 'EXPIRADA', 'RECHAZADA'] as const) {
    const r = validarConsumoCompra(compraActiva({ estado }), SIN_RESTRICCION, new Date(), TZ)
    assert.equal(r.puedeUsar, false, `${estado} no debería permitir canje`)
    assert.ok(r.mensaje, `${estado} debe explicar el motivo al empleado`)
  }
})

// ── Cola de vehículos: máquina de estados ────────────────────────────────────

test('todo estado de la cola tiene etiqueta y transiciones declaradas', () => {
  for (const e of COLA_ESTADOS) {
    assert.ok(COLA_ESTADO_LABELS[e], `falta etiqueta de ${e}`)
    assert.ok(Array.isArray(COLA_TRANSICIONES[e]), `falta transición de ${e}`)
  }
})

test('el flujo normal avanza en un solo sentido', () => {
  assert.deepEqual(COLA_TRANSICIONES.EN_ESPERA, ['EN_SERVICIO', 'CANCELADO'])
  assert.deepEqual(COLA_TRANSICIONES.EN_SERVICIO, ['LISTO', 'CANCELADO'])
  assert.deepEqual(COLA_TRANSICIONES.LISTO, ['ENTREGADO', 'CANCELADO'])
})

test('no se puede saltar pasos: de EN_ESPERA no se entrega directo', () => {
  assert.equal(COLA_TRANSICIONES.EN_ESPERA.includes('ENTREGADO'), false)
  assert.equal(COLA_TRANSICIONES.EN_ESPERA.includes('LISTO'), false)
})

test('entregado y cancelado son finales: no se reabren', () => {
  assert.deepEqual(COLA_TRANSICIONES.ENTREGADO, [])
  assert.deepEqual(COLA_TRANSICIONES.CANCELADO, [])
})

test('no hay marcha atrás (ninguna transición retrocede en el flujo)', () => {
  const orden: ColaEstado[] = ['EN_ESPERA', 'EN_SERVICIO', 'LISTO', 'ENTREGADO']
  for (const [desde, destinos] of Object.entries(COLA_TRANSICIONES)) {
    const i = orden.indexOf(desde as ColaEstado)
    if (i < 0) continue
    for (const d of destinos) {
      if (d === 'CANCELADO') continue // salida válida desde cualquier estado activo
      assert.ok(orden.indexOf(d) > i, `${desde} → ${d} retrocede el flujo`)
    }
  }
})

test('el tablero solo muestra los estados activos (los terminados salen)', () => {
  assert.deepEqual(COLA_ACTIVOS, ['EN_ESPERA', 'EN_SERVICIO', 'LISTO'])
  assert.equal(COLA_ACTIVOS.includes('ENTREGADO' as ColaEstado), false)
  assert.equal(COLA_ACTIVOS.includes('CANCELADO' as ColaEstado), false)
})
