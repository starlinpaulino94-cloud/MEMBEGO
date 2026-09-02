import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularModificacion,
  esModificable,
  POLITICAS_REEMBOLSO_DEFAULT,
  validarReserva,
} from '../src/modules/excursiones/reservas/nucleo'
import { codigoDeCheckin } from '../src/modules/excursiones/checkin/nucleo'
import { resolver } from '../src/modules/excursiones/config'

describe('calcularModificacion', () => {
  const politica = POLITICAS_REEMBOLSO_DEFAULT

  it('calcula reembolso al reducir de 4 a 2 pasajeros', () => {
    const r = calcularModificacion({
      adultosOriginales: 4,
      ninosOriginales: 0,
      adultosNuevos: 2,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 400,
      politica,
      horasRestantes: 48,
    })
    assert.equal(r.permitido, true)
    assert.equal(r.nuevoTotal, 200)
    assert.equal(r.montoReembolso, 200)
    assert.equal(r.montoCobrar, 0)
  })

  it('rechaza si intenta agregar pasajeros', () => {
    const r = calcularModificacion({
      adultosOriginales: 2,
      ninosOriginales: 0,
      adultosNuevos: 3,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 200,
      politica,
      horasRestantes: 48,
    })
    assert.equal(r.permitido, false)
    assert.ok(r.razon?.includes('No se pueden agregar pasajeros'))
  })

  it('respeta anticipación mínima', () => {
    const r = calcularModificacion({
      adultosOriginales: 2,
      ninosOriginales: 0,
      adultosNuevos: 1,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 200,
      politica,
      horasRestantes: 12,
    })
    assert.equal(r.permitido, false)
    assert.ok(r.razon?.includes('anticipación'))
  })

  it('aplica penalización al cancelar', () => {
    const r = calcularModificacion({
      adultosOriginales: 2,
      ninosOriginales: 0,
      adultosNuevos: 0,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 200,
      politica: { ...politica, penalizacionCancelacionPct: 20 },
      horasRestantes: 72,
    })
    assert.equal(r.permitido, true)
    assert.equal(r.nuevoTotal, 0)
    assert.equal(r.montoReembolso, 160) // 200 * (1 - 0.20)
  })

  it('rechaza cancelación si permitirCancelacion es false', () => {
    const r = calcularModificacion({
      adultosOriginales: 2,
      ninosOriginales: 0,
      adultosNuevos: 0,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 200,
      politica: { ...politica, permitirCancelacion: false },
      horasRestantes: 72,
    })
    assert.equal(r.permitido, false)
    assert.ok(r.razon?.includes('no permite cancelaciones'))
  })

  it('rechaza reducción si permitirReduccionPasajeros es false', () => {
    const r = calcularModificacion({
      adultosOriginales: 4,
      ninosOriginales: 0,
      adultosNuevos: 2,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 400,
      politica: { ...politica, permitirReduccionPasajeros: false },
      horasRestantes: 48,
    })
    assert.equal(r.permitido, false)
    assert.ok(r.razon?.includes('no permite reducir pasajeros'))
  })

  it('maneja tipoReembolso NINGUNO', () => {
    const r = calcularModificacion({
      adultosOriginales: 4,
      ninosOriginales: 0,
      adultosNuevos: 2,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 400,
      politica: { ...politica, tipoReembolso: 'NINGUNO' },
      horasRestantes: 48,
    })
    assert.equal(r.permitido, true)
    assert.equal(r.nuevoTotal, 200)
    assert.equal(r.montoReembolso, 0)
  })

  it('maneja tipoReembolso CREDITO', () => {
    const r = calcularModificacion({
      adultosOriginales: 4,
      ninosOriginales: 0,
      adultosNuevos: 2,
      ninosNuevos: 0,
      precioAdulto: 100,
      precioNino: null,
      impuestoPct: null,
      descuentoActual: 0,
      pagado: 400,
      politica: { ...politica, tipoReembolso: 'CREDITO' },
      horasRestantes: 48,
    })
    assert.equal(r.permitido, true)
    assert.equal(r.nuevoTotal, 200)
    assert.equal(r.montoReembolso, 200)
    assert.ok(r.razon?.includes('crédito'))
  })
})

describe('esModificable', () => {
  it('permite modificación con suficiente anticipación', () => {
    const excursion = new Date('2026-09-05T10:00:00Z')
    const ahora = new Date('2026-09-03T10:00:00Z')
    const r = esModificable(excursion, '10:00', ahora, 24)
    assert.equal(r.modificable, true)
    assert.equal(r.horasRestantes, 48)
  })

  it('rechaza modificación sin suficiente anticipación', () => {
    const excursion = new Date('2026-09-04T10:00:00Z')
    const ahora = new Date('2026-09-04T06:00:00Z')
    const r = esModificable(excursion, '10:00', ahora, 24)
    assert.equal(r.modificable, false)
    assert.equal(r.horasRestantes, 4)
  })

  it('usa 8am UTC por defecto si no se especifica hora', () => {
    const excursion = new Date('2026-09-05T00:00:00Z')
    const ahora = new Date('2026-09-04T08:00:00Z')
    const r = esModificable(excursion, null, ahora, 24)
    assert.equal(r.modificable, true)
    assert.equal(r.horasRestantes, 24)
  })
})

// ── Resolver config ──────────────────────────────────────────────────────────

describe('resolver - config completa', () => {
  it('usa defaults cuando no hay config', () => {
    const cfg = resolver(null)
    assert.equal(cfg.politicaAtribucion, 'PRIMERA')
    assert.equal(cfg.monedaDefecto, 'DOP')
    assert.equal(cfg.prefijoCheckin, 'EXC:')
    assert.equal(cfg.maxPasajerosPorReserva, 50)
    assert.equal(cfg.enviarConfirmacionReserva, true)
    assert.deepEqual(cfg.metodosPagoHabilitados, ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'DEPOSITO', 'LINK'])
  })

  it('respeta valores custom de check-in', () => {
    const cfg = resolver({
      diasGraciaCheckin: 5,
      permitirCheckinSinPago: true,
      prefijoCheckin: 'TOUR:',
    })
    assert.equal(cfg.diasGraciaCheckin, 5)
    assert.equal(cfg.permitirCheckinSinPago, true)
    assert.equal(cfg.prefijoCheckin, 'TOUR:')
  })

  it('respeta valores custom de reserva', () => {
    const cfg = resolver({
      anticipacionMinimaReservaHoras: 12,
      anticipacionMaximaReservaDias: 30,
      maxPasajerosPorReserva: 20,
    })
    assert.equal(cfg.anticipacionMinimaReservaHoras, 12)
    assert.equal(cfg.anticipacionMaximaReservaDias, 30)
    assert.equal(cfg.maxPasajerosPorReserva, 20)
  })

  it('respeta valores custom de notificaciones', () => {
    const cfg = resolver({
      enviarConfirmacionReserva: false,
      enviarRecordatorioHoras: 48,
      emailNotificaciones: 'ops@tour.com',
    })
    assert.equal(cfg.enviarConfirmacionReserva, false)
    assert.equal(cfg.enviarRecordatorioHoras, 48)
    assert.equal(cfg.emailNotificaciones, 'ops@tour.com')
  })

  it('respeta metodosPagoHabilitados custom', () => {
    const cfg = resolver({
      metodosPagoHabilitados: ['EFECTIVO', 'LINK'],
    })
    assert.deepEqual(cfg.metodosPagoHabilitados, ['EFECTIVO', 'LINK'])
  })

  it('clampa valores fuera de rango', () => {
    const cfg = resolver({
      diasGraciaCheckin: 100,  // max 30
      maxPasajerosPorReserva: 0,  // min 1
      anticipacionMaximaReservaDias: 500,  // max 365
    })
    assert.equal(cfg.diasGraciaCheckin, 30)
    assert.equal(cfg.maxPasajerosPorReserva, 1)
    assert.equal(cfg.anticipacionMaximaReservaDias, 365)
  })
})

// ── validarReserva · maxPasajeros ────────────────────────────────────────────

describe('validarReserva - maxPasajeros', () => {
  const baseForm = { fecha: '2026-09-10', adultos: '3', ninos: '1' }

  it('acepta reserva dentro del límite', () => {
    const r = validarReserva(baseForm, 10)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.datos.adultos, 3)
      assert.equal(r.datos.ninos, 1)
    }
  })

  it('rechaza reserva que excede el límite', () => {
    const r = validarReserva({ fecha: '2026-09-10', adultos: '5', ninos: '0' }, 2)
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.ok(r.error.includes('al menos un pasajero'))
    }
  })

  it('rechaza si total de pasajeros queda en cero por límite', () => {
    const r = validarReserva({ fecha: '2026-09-10', adultos: '100', ninos: '100' }, 5)
    // Both exceed limit → clamped to 0 each → total 0 → error
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.ok(r.error.includes('al menos un pasajero'))
    }
  })
})

// ── codigoDeCheckin · prefijo ────────────────────────────────────────────────

describe('codigoDeCheckin - prefijo', () => {
  it('usa prefijo por defecto EXC:', () => {
    const codigo = codigoDeCheckin('abc123')
    assert.equal(codigo, 'EXC:abc123')
  })

  it('usa prefijo personalizado', () => {
    const codigo = codigoDeCheckin('abc123', 'TOUR-')
    assert.equal(codigo, 'TOUR-abc123')
  })

  it('maneja prefijo vacío', () => {
    const codigo = codigoDeCheckin('abc123', '')
    assert.equal(codigo, 'abc123')
  })
})
