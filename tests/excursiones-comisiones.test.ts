import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reglaAplicable,
  calcularComision,
  netoComision,
  ajustePorCancelacion,
  puedeTransicionar,
  motivoTransicionInvalida,
  normalizarEscalones,
  validarRegla,
  type ReglaComision,
  type ContextoVenta,
} from '../src/modules/excursiones/comisiones/nucleo'

/**
 * Excursiones · Fase 6 — el motor de comisiones decide cuánto se le debe a una
 * persona. Se prueba puro y con fechas fijas: aquí no hay margen para «casi».
 */

const AHORA = new Date('2026-08-17T12:00:00Z')

const ctx: ContextoVenta = {
  vendedorId: 'juan',
  excursionId: 'saona',
  categoria: 'PLAYA',
  total: 1180, // con 18% de impuesto
  baseComisionable: 1000, // lo que la empresa ingresa de verdad
  adultos: 2,
  ninos: 1,
  fecha: AHORA,
}

const regla = (p: Partial<ReglaComision> & { id: string }): ReglaComision => ({
  ambito: 'GENERAL',
  tipoCalculo: 'PORCENTAJE',
  valor: 10,
  activa: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...p,
})

// ── Jerarquía ────────────────────────────────────────────────────────────────

test('gana la regla más específica: vendedor+excursión sobre todas las demás', () => {
  const reglas = [
    regla({ id: 'general', ambito: 'GENERAL' }),
    regla({ id: 'categoria', ambito: 'CATEGORIA', categoria: 'PLAYA' }),
    regla({ id: 'excursion', ambito: 'EXCURSION', excursionId: 'saona' }),
    regla({ id: 'vendedor', ambito: 'VENDEDOR', vendedorId: 'juan' }),
    regla({ id: 'ambos', ambito: 'VENDEDOR_EXCURSION', vendedorId: 'juan', excursionId: 'saona' }),
  ]
  assert.equal(reglaAplicable(reglas, ctx)?.id, 'ambos')
  // Quitando la más específica, baja un escalón, no salta al principio.
  assert.equal(reglaAplicable(reglas.slice(0, 4), ctx)?.id, 'vendedor')
  assert.equal(reglaAplicable(reglas.slice(0, 3), ctx)?.id, 'excursion')
})

test('a igual especificidad manda la más reciente', () => {
  const vieja = regla({ id: 'vieja', ambito: 'VENDEDOR', vendedorId: 'juan', createdAt: new Date('2026-01-01T00:00:00Z') })
  const nueva = regla({ id: 'nueva', ambito: 'VENDEDOR', vendedorId: 'juan', createdAt: new Date('2026-06-01T00:00:00Z') })
  assert.equal(reglaAplicable([vieja, nueva], ctx)?.id, 'nueva')
})

test('una regla de otro vendedor, inactiva o fuera de vigencia no aplica', () => {
  assert.equal(reglaAplicable([regla({ id: 'x', ambito: 'VENDEDOR', vendedorId: 'ana' })], ctx), null)
  assert.equal(reglaAplicable([regla({ id: 'x', activa: false })], ctx), null)
  assert.equal(
    reglaAplicable([regla({ id: 'x', vigenciaDesde: new Date('2026-12-01T00:00:00Z') })], ctx),
    null
  )
  assert.equal(
    reglaAplicable([regla({ id: 'x', vigenciaHasta: new Date('2026-01-31T00:00:00Z') })], ctx),
    null
  )
})

test('sin ninguna regla no hay comisión: no se inventa una deuda', () => {
  assert.equal(reglaAplicable([], ctx), null)
  // Un ámbito sin su referencia tampoco aplica a nadie.
  assert.equal(reglaAplicable([regla({ id: 'x', ambito: 'EXCURSION', excursionId: null })], ctx), null)
})

// ── Cálculo ──────────────────────────────────────────────────────────────────

test('el porcentaje se aplica sobre el neto, jamás sobre el impuesto', () => {
  const c = calcularComision(regla({ id: 'r', valor: 10 }), ctx)
  assert.equal(c.base, 1000) // no 1180
  assert.equal(c.monto, 100)
  assert.match(c.desglose, /10% sobre 1000/)
  assert.equal(c.snapshot.reglaId, 'r')
  assert.equal(c.snapshot.valor, 10)
})

test('los montos fijos cuentan lo que dicen contar', () => {
  assert.equal(calcularComision(regla({ id: 'r', tipoCalculo: 'FIJO_VENTA', valor: 250 }), ctx).monto, 250)
  assert.equal(calcularComision(regla({ id: 'r', tipoCalculo: 'FIJO_PASAJERO', valor: 100 }), ctx).monto, 300)
  assert.equal(calcularComision(regla({ id: 'r', tipoCalculo: 'FIJO_ADULTO', valor: 100 }), ctx).monto, 200)
  assert.equal(calcularComision(regla({ id: 'r', tipoCalculo: 'FIJO_NINO', valor: 100 }), ctx).monto, 100)
})

test('los escalones pagan por el tramo del número de pasajeros', () => {
  const r = regla({
    id: 'r',
    tipoCalculo: 'ESCALON',
    escalones: [
      { desde: 1, hasta: 2, pct: 5 },
      { desde: 3, hasta: 9, pct: 10 },
      { desde: 10, hasta: null, pct: 15 },
    ],
  })
  assert.equal(calcularComision(r, ctx).monto, 100) // 3 pax → 10%
  assert.equal(calcularComision(r, { ...ctx, adultos: 1, ninos: 0 }).monto, 50) // 1 pax → 5%
  assert.equal(calcularComision(r, { ...ctx, adultos: 12, ninos: 0 }).monto, 150) // 12 pax → 15%
  // Un hueco en la tabla no paga a ciegas: paga cero y lo dice.
  const conHueco = regla({ id: 'r', tipoCalculo: 'ESCALON', escalones: [{ desde: 5, hasta: 9, pct: 10 }] })
  const c = calcularComision(conHueco, ctx)
  assert.equal(c.monto, 0)
  assert.match(c.desglose, /no caen en ningún escalón/)
})

test('la comisión nunca supera la base: se topa y se explica', () => {
  const c = calcularComision(regla({ id: 'r', tipoCalculo: 'FIJO_VENTA', valor: 5000 }), ctx)
  assert.equal(c.monto, 1000)
  assert.match(c.desglose, /topado a la base/)
})

test('los escalones que llegan sucios se limpian antes de decidir dinero', () => {
  const limpios = normalizarEscalones([
    { desde: '3', hasta: '9', pct: '10' },
    { desde: 1, hasta: 2, pct: 500 }, // % imposible → se topa a 100
    { desde: 'x', pct: 5 }, // basura → fuera
  ])
  assert.equal(limpios.length, 2)
  assert.deepEqual(limpios[0], { desde: 1, hasta: 2, pct: 100 })
  assert.deepEqual(limpios[1], { desde: 3, hasta: 9, pct: 10 })
})

// ── Estados y ajustes ────────────────────────────────────────────────────────

test('una comisión pagada es terminal: se corrige con ajuste, no con estado', () => {
  assert.equal(puedeTransicionar('GENERADA', 'APROBADA'), true)
  assert.equal(puedeTransicionar('APROBADA', 'PENDIENTE_PAGO'), true)
  assert.equal(puedeTransicionar('PENDIENTE_PAGO', 'PAGADA'), true)
  assert.equal(puedeTransicionar('PAGADA', 'ANULADA'), false)
  assert.equal(puedeTransicionar('GENERADA', 'PAGADA'), false) // no se salta la aprobación
  assert.match(motivoTransicionInvalida('PAGADA', 'ANULADA') ?? '', /ajuste/)
  assert.equal(motivoTransicionInvalida('GENERADA', 'APROBADA'), null)
})

test('el neto suma los ajustes firmados y nunca deja al vendedor debiendo', () => {
  assert.equal(netoComision(100, []), 100)
  assert.equal(netoComision(100, [{ monto: -40 }]), 60)
  assert.equal(netoComision(100, [{ monto: -40 }, { monto: 25 }]), 85)
  assert.equal(netoComision(100, [{ monto: -500 }]), 0)
})

test('cancelar una venta genera el ajuste negativo, no borra la comisión', () => {
  const a = ajustePorCancelacion(100, 'Cliente canceló el viaje')
  assert.equal(a?.monto, -100)
  assert.equal(a?.motivo, 'Cliente canceló el viaje')
  // Ya en cero no hay nada que ajustar: no se duplica el descuento.
  assert.equal(ajustePorCancelacion(0, 'x'), null)
})

// ── Validación ───────────────────────────────────────────────────────────────

test('una regla mal definida se rechaza con el motivo del negocio', () => {
  assert.equal(validarRegla({ ambito: 'INVENTADO', tipoCalculo: 'PORCENTAJE', valor: '10' }).ok, false)
  assert.equal(validarRegla({ ambito: 'PORCENTAJE', tipoCalculo: 'X', valor: '10' }).ok, false)
  assert.equal(validarRegla({ ambito: 'EXCURSION', tipoCalculo: 'PORCENTAJE', valor: '10' }).ok, false)
  assert.equal(validarRegla({ ambito: 'VENDEDOR', tipoCalculo: 'PORCENTAJE', valor: '10' }).ok, false)
  assert.equal(validarRegla({ ambito: 'GENERAL', tipoCalculo: 'PORCENTAJE', valor: '150' }).ok, false)
  assert.equal(validarRegla({ ambito: 'GENERAL', tipoCalculo: 'ESCALON', valor: '0' }).ok, false)
  const r = validarRegla({
    ambito: 'VENDEDOR',
    tipoCalculo: 'PORCENTAJE',
    valor: '12.5',
    vendedorId: 'juan',
    excursionId: 'saona', // sobra para este ámbito: se descarta
    vigenciaDesde: '2026-09-01',
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.valor, 12.5)
    assert.equal(r.datos.vendedorId, 'juan')
    assert.equal(r.datos.excursionId, null)
    assert.equal(r.datos.vigenciaDesde?.toISOString(), '2026-09-01T00:00:00.000Z')
  }
})

test('la vigencia no puede terminar antes de empezar', () => {
  const r = validarRegla({
    ambito: 'GENERAL',
    tipoCalculo: 'PORCENTAJE',
    valor: '10',
    vigenciaDesde: '2026-09-01',
    vigenciaHasta: '2026-08-01',
  })
  assert.equal(r.ok, false)
})
