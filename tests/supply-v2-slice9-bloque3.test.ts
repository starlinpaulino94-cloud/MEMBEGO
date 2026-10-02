import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  INCIDENTE_VIVO,
  MOTIVOS,
  RESOLUCIONES,
  abreIncidente,
  claveDeIncidente,
  compararDinero,
  diferenciaDeMonto,
  exigeServicioFinanciero,
  reconciliarEstadoPago,
  veredictoDeTransaccionDuplicada,
  type EstadoExterno,
  type EstadoInterno,
} from '../src/modules/supply-v2/operations/conciliacion-dominio'
import { estadoExternoDeEvento } from '../src/modules/supply-v2/operations/pasarela'
import { pagoDelPayload } from '../src/modules/supply-v2/operations/barrido-conciliacion'
import {
  FINANCE_INCIDENT_SEVERITY_LABELS,
  FINANCE_INCIDENT_STATUS_LABELS,
  FINANCE_INCIDENT_TYPE_LABELS,
  PAYMENT_INCIDENT_RESOLUTION_LABELS,
  etiquetaDeMotivoDePago,
} from '../src/modules/supply-v2/core/catalogo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 3 · DOMINIO (§21).
 *
 * La matriz de estados, el emparejamiento de monto y moneda, la identidad del
 * problema, las resoluciones y las etiquetas. Todo puro: sin base, sin red.
 *
 * `npm test`.
 */

const interno = (estado: EstadoInterno, total: string | null = '1000.00', moneda: string | null = 'DOP') => ({
  estado,
  total,
  moneda,
})
const externo = (estado: EstadoExterno, monto: string | null = '1000.00', moneda: string | null = 'DOP') => ({
  estado,
  monto,
  moneda,
})

// ── 1 a 4 · la matriz de estados ────────────────────────────────────────────

test('1 · PAGADO / PAGADO con el mismo importe: cuadran', () => {
  const v = reconciliarEstadoPago(interno('PAID'), externo('PAID'))
  assert.equal(v.resultado, 'MATCHED')
  assert.equal(v.motivo, null)
  assert.equal(v.severidad, 'LOW')
  assert.equal(abreIncidente(v), false, 'lo que cuadra no abre tarea')
})

test('2 · PENDIENTE / PAGADO no se confirma solo: queda para que una persona lo ejecute', () => {
  // Es el caso tentador: la pasarela dice que cobró el importe exacto. Y aun
  // así NO se toca el dinero desde la conciliación: el camino seguro del
  // bloque 2 es el que confirma, y si no lo hizo, algo lo impidió.
  for (const estado of ['PENDING', 'AWAITING_PAYMENT'] as EstadoInterno[]) {
    const v = reconciliarEstadoPago(interno(estado), externo('PAID'))
    assert.equal(v.resultado, 'MISMATCH', `${estado} con cobro externo abre incidente`)
    assert.equal(v.motivo, MOTIVOS.STATE_CONFLICT)
    assert.equal(v.severidad, 'MEDIUM', 'no es lo más grave: el importe cuadra')
    assert.match(v.explicacion, /sin confirmarse/)
  }
})

test('3 · PAGADO / FALLIDO es grave: cobramos algo que la pasarela dice que no cobró', () => {
  const v = reconciliarEstadoPago(interno('PAID'), externo('FAILED', null))
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.STATE_CONFLICT)
  assert.equal(v.severidad, 'HIGH')
})

test('3a · PAGADO / DESCONOCIDO tampoco se ignora, y esa es la dirección que se suele olvidar', () => {
  // Membego dice pagado, la pasarela no sabe nada. Si acaba en nada, es dinero
  // que Membego entregó sin haber cobrado.
  for (const estado of ['UNKNOWN', 'PENDING'] as EstadoExterno[]) {
    const v = reconciliarEstadoPago(interno('PAID'), externo(estado, null))
    assert.equal(v.resultado, 'MISMATCH', `PAID contra ${estado}`)
    assert.equal(v.severidad, 'HIGH')
    assert.match(v.explicacion, /no confirma|falló/)
  }
})

test('4 · CANCELADA, VENCIDA o RECHAZADA contra un cobro: incidente grave', () => {
  for (const estado of ['CANCELLED', 'EXPIRED', 'PAYMENT_REJECTED'] as EstadoInterno[]) {
    const v = reconciliarEstadoPago(interno(estado), externo('PAID'))
    assert.equal(v.resultado, 'MISMATCH', estado)
    assert.equal(v.motivo, MOTIVOS.STATE_CONFLICT)
    assert.equal(v.severidad, 'HIGH')
  }
})

test('4a · los dos lados sin cobro: cuadran, y no hay nada que investigar', () => {
  const v = reconciliarEstadoPago(interno('PENDING'), externo('FAILED', null))
  assert.equal(v.resultado, 'MATCHED')
  assert.equal(abreIncidente(v), false)
})

test('4b · la pasarela todavía no sabe y nosotros no hemos cobrado: se espera', () => {
  for (const estado of ['PENDING', 'UNKNOWN'] as EstadoExterno[]) {
    const v = reconciliarEstadoPago(interno('PENDING'), externo(estado, null))
    assert.equal(v.resultado, 'WAITING', `externo ${estado}`)
    assert.equal(abreIncidente(v), false, 'esperar no es un problema: es esperar')
  }
})

// ── 5 y 6 · monto y moneda ──────────────────────────────────────────────────

test('5 · el importe se compara con Decimal, con la tolerancia del checkout', () => {
  assert.equal(reconciliarEstadoPago(interno('PAID', '1000.00'), externo('PAID', '1000.00')).resultado, 'MATCHED')
  // Un centavo de tolerancia, el mismo criterio que `montoCuadra`.
  assert.equal(reconciliarEstadoPago(interno('PAID', '1000.00'), externo('PAID', '1000.009')).resultado, 'MATCHED')

  const v = reconciliarEstadoPago(interno('PAID', '1000.00'), externo('PAID', '999.00'))
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.AMOUNT_MISMATCH)
  assert.equal(v.severidad, 'HIGH')
  assert.match(v.explicacion, /999\.00/)
  assert.match(v.explicacion, /1000\.00/)
})

test('5a · importes que un double habría estropeado', () => {
  // 0.1 + 0.2 en coma flotante no es 0.3. Con Decimal, sí.
  assert.equal(reconciliarEstadoPago(interno('PAID', '0.30'), externo('PAID', '0.30')).resultado, 'MATCHED')
  assert.equal(reconciliarEstadoPago(interno('PAID', '19999999.99'), externo('PAID', '19999999.99')).resultado, 'MATCHED')
  assert.equal(reconciliarEstadoPago(interno('PAID', '19999999.99'), externo('PAID', '19999999.98')).resultado, 'MISMATCH')
})

test('5b · dice que cobró y no dice cuánto: no se da por bueno', () => {
  const v = reconciliarEstadoPago(interno('PAID'), externo('PAID', null))
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.AMOUNT_MISMATCH)
  assert.match(v.explicacion, /no informa el importe/)
})

test('6 · otra moneda nunca cuadra, aunque el número sea el mismo', () => {
  const v = reconciliarEstadoPago(interno('PAID', '1000.00', 'DOP'), externo('PAID', '1000.00', 'USD'))
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.CURRENCY_MISMATCH)
  assert.equal(v.severidad, 'HIGH')
  assert.match(v.explicacion, /USD/)
  assert.match(v.explicacion, /DOP/)
  // La moneda se compara sin distinguir mayúsculas ni espacios.
  assert.equal(compararDinero(interno('PAID', '1000.00', 'dop'), externo('PAID', '1000.00', ' DOP ')), null)
})

test('6a · la moneda se decide ANTES del importe: el motivo no puede ser el equivocado', () => {
  // Otra moneda Y otro importe: lo que se dice es que la moneda no cuadra,
  // porque comparar importes entre monedas distintas no significa nada.
  const v = reconciliarEstadoPago(interno('PAID', '1000.00', 'DOP'), externo('PAID', '17.50', 'USD'))
  assert.equal(v.motivo, MOTIVOS.CURRENCY_MISMATCH)
})

test('6b · la diferencia se calcula con Decimal y en la dirección útil', () => {
  assert.equal(diferenciaDeMonto('1000.00', '900.00')?.toFixed(2), '-100.00', 'cobró 100 menos')
  assert.equal(diferenciaDeMonto('1000.00', '1100.00')?.toFixed(2), '100.00', 'cobró 100 más')
  assert.equal(diferenciaDeMonto('1000.00', null), null)
  assert.equal(diferenciaDeMonto(null, '1000.00'), null)
  assert.equal(diferenciaDeMonto('1000.00', 'no-es-un-numero'), null)
})

// ── 7 · orden desconocida ───────────────────────────────────────────────────

test('7 · cobró una compra que no existe: lo más grave que puede pasar', () => {
  const v = reconciliarEstadoPago({ estado: 'UNKNOWN' }, externo('PAID'))
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.UNKNOWN_ORDER)
  assert.equal(v.severidad, 'HIGH')
  assert.match(v.explicacion, /no existe/)
})

test('7a · sin compra y sin cobro no es asunto nuestro', () => {
  const v = reconciliarEstadoPago({ estado: 'UNKNOWN' }, externo('FAILED', null))
  assert.equal(v.resultado, 'IGNORED')
  assert.equal(abreIncidente(v), false, 'no se abre una tarea por un evento que no nos concierne')
})

// ── 8 · transacción duplicada ───────────────────────────────────────────────

test('8 · la misma transacción en dos compras: grave, y no sale de la matriz', () => {
  // Los dos lados pueden cuadrar perfectamente y seguir siendo un problema: un
  // identificador de transacción es único en el sistema del proveedor.
  const v = veredictoDeTransaccionDuplicada('TX-9', 'MBG-SO-000123')
  assert.equal(v.resultado, 'MISMATCH')
  assert.equal(v.motivo, MOTIVOS.DUPLICATE_TRANSACTION)
  assert.equal(v.severidad, 'HIGH')
  assert.match(v.explicacion, /TX-9/)
  assert.match(v.explicacion, /MBG-SO-000123/)
  assert.match(v.explicacion, /no se acepta la segunda/)
})

// ── 9 y 10 · severidad y motivos ────────────────────────────────────────────

test('9 · la severidad ordena la cola: lo que puede costar dinero va arriba', () => {
  const grave = [
    reconciliarEstadoPago({ estado: 'UNKNOWN' }, externo('PAID')),
    reconciliarEstadoPago(interno('PAID'), externo('FAILED', null)),
    reconciliarEstadoPago(interno('CANCELLED'), externo('PAID')),
    reconciliarEstadoPago(interno('PAID', '1000.00'), externo('PAID', '1.00')),
    reconciliarEstadoPago(interno('PAID', '1000.00', 'DOP'), externo('PAID', '1000.00', 'USD')),
    veredictoDeTransaccionDuplicada('TX-1', 'MBG-SO-1'),
  ]
  for (const v of grave) assert.equal(v.severidad, 'HIGH', v.explicacion)

  // Y lo que no cuesta dinero, no.
  assert.equal(reconciliarEstadoPago(interno('PENDING'), externo('PENDING', null)).severidad, 'LOW')
  assert.equal(reconciliarEstadoPago(interno('PAID'), externo('PAID')).severidad, 'LOW')
})

test('10 · cada motivo existe, es estable y tiene una etiqueta legible', () => {
  const esperados = ['AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNKNOWN_ORDER', 'STATE_CONFLICT', 'DUPLICATE_TRANSACTION']
  assert.deepEqual(Object.keys(MOTIVOS).sort(), [...esperados].sort())
  for (const m of esperados) {
    const etiqueta = etiquetaDeMotivoDePago(m)
    assert.ok(etiqueta.length > 0 && etiqueta !== m, `${m} tiene etiqueta en español`)
  }
  // Un motivo futuro —la columna es texto a propósito— no rompe la pantalla.
  assert.equal(etiquetaDeMotivoDePago('MOTIVO_QUE_NO_EXISTE_AUN'), 'MOTIVO_QUE_NO_EXISTE_AUN')
  assert.equal(etiquetaDeMotivoDePago(null), 'Sin motivo registrado')
})

test('10a · toda etiqueta de los enums nuevos está puesta', () => {
  assert.ok(FINANCE_INCIDENT_TYPE_LABELS.EXTERNAL_PAYMENT_MISMATCH)
  assert.ok(FINANCE_INCIDENT_STATUS_LABELS.INVESTIGATING)
  assert.deepEqual(Object.keys(FINANCE_INCIDENT_SEVERITY_LABELS).sort(), ['HIGH', 'LOW', 'MEDIUM'])
  assert.deepEqual(Object.keys(PAYMENT_INCIDENT_RESOLUTION_LABELS).sort(), [
    'ACCEPT_EXTERNAL',
    'ACCEPT_INTERNAL',
    'MANUAL_CORRECTION_REQUIRED',
    'MARK_FALSE_POSITIVE',
  ])
})

// ── 11 · identidad del incidente ────────────────────────────────────────────

test('11 · el mismo problema tiene la misma identidad, y problemas distintos no', () => {
  const base = { provider: 'TEST_GATEWAY', externalTransactionId: 'TX-9', orderId: 'ord_1', motivo: MOTIVOS.AMOUNT_MISMATCH }
  // La misma cosa vista otra vez es la misma cosa: ni la fecha ni el hilo
  // entran en la identidad.
  assert.equal(claveDeIncidente(base), claveDeIncidente({ ...base }))
  assert.equal(claveDeIncidente(base), claveDeIncidente({ ...base, externalEventId: 'otro-evento' }))
  // El proveedor no distingue mayúsculas.
  assert.equal(claveDeIncidente(base), claveDeIncidente({ ...base, provider: 'test_gateway' }))

  // Pero «el monto no cuadra» y «la moneda no cuadra» sobre la misma
  // transacción son dos cosas que un operador quiere ver por separado.
  assert.notEqual(claveDeIncidente(base), claveDeIncidente({ ...base, motivo: MOTIVOS.CURRENCY_MISMATCH }))
  assert.notEqual(claveDeIncidente(base), claveDeIncidente({ ...base, orderId: 'ord_2' }))
  assert.notEqual(claveDeIncidente(base), claveDeIncidente({ ...base, externalTransactionId: 'TX-10' }))
})

test('11a · sin transacción se cae en el evento, y sin ninguno de los dos aún hay identidad', () => {
  const sinTx = claveDeIncidente({ provider: 'TEST_GATEWAY', externalEventId: 'evt_1', orderId: null, motivo: MOTIVOS.UNKNOWN_ORDER })
  assert.match(sinTx, /evt_1/)
  assert.match(sinTx, /sin-orden/, 'un evento sin compra sigue teniendo identidad propia')
  const sinNada = claveDeIncidente({ provider: 'TEST_GATEWAY', orderId: null, motivo: MOTIVOS.UNKNOWN_ORDER })
  assert.match(sinNada, /sin-referencia/)
  assert.notEqual(sinTx, sinNada)
})

// ── 12 a 15 · resolución, nota y actor ──────────────────────────────────────

test('12 · los estados vivos son los que todavía necesitan a alguien', () => {
  assert.deepEqual([...INCIDENTE_VIVO], ['OPEN', 'INVESTIGATING'])
  assert.ok(!(INCIDENTE_VIVO as readonly string[]).includes('RESOLVED'), 'resuelto ya no necesita a nadie')
  // No hay IGNORED: un falso positivo se RESUELVE, con nombre y nota. Dos
  // formas de decir «ya está» obligarían a cada consulta a conocer las dos.
  assert.ok(!(INCIDENTE_VIVO as readonly string[]).includes('IGNORED'))
  assert.ok(!('IGNORED' in FINANCE_INCIDENT_STATUS_LABELS))
})

test('13 · las cuatro resoluciones existen y solo una implica mover dinero', () => {
  assert.deepEqual(Object.keys(RESOLUCIONES).sort(), [
    'ACCEPT_EXTERNAL',
    'ACCEPT_INTERNAL',
    'MANUAL_CORRECTION_REQUIRED',
    'MARK_FALSE_POSITIVE',
  ])
  assert.equal(exigeServicioFinanciero(RESOLUCIONES.ACCEPT_EXTERNAL), true)
  for (const r of [RESOLUCIONES.ACCEPT_INTERNAL, RESOLUCIONES.MARK_FALSE_POSITIVE, RESOLUCIONES.MANUAL_CORRECTION_REQUIRED]) {
    assert.equal(exigeServicioFinanciero(r), false, `${r} no mueve dinero`)
  }
})

// ── 19 y 20 · el hilo, y lo que NO es un incidente financiero ───────────────

test('19 · el estado externo se traduce del vocabulario del inbox sin adivinar', () => {
  assert.equal(estadoExternoDeEvento('PAYMENT_CONFIRMED'), 'PAID')
  assert.equal(estadoExternoDeEvento('PAYMENT_REJECTED'), 'FAILED')
  assert.equal(estadoExternoDeEvento('PAYMENT_UNKNOWN', 'APPROVED'), 'PAID')
  assert.equal(estadoExternoDeEvento('PAYMENT_UNKNOWN', 'PENDING'), 'PENDING')
  // Lo que no sabemos traducir es UNKNOWN, no «aprobado porque no dice lo
  // contrario». Y UNKNOWN contra una compra pagada es un caso que se mira.
  assert.equal(estadoExternoDeEvento('PAYMENT_DISPUTE_OPENED'), 'UNKNOWN')
  assert.equal(estadoExternoDeEvento('PAYMENT_UNKNOWN', 'EN_REVISION'), 'UNKNOWN')
})

test('19a · el pago se lee de lo que el adaptador interpretó, no del cuerpo crudo', () => {
  // Es el defecto que el bloque 1 cerró y que no se reintroduce: la referencia
  // y el importe salen de `payload.pago`, no de adivinar nombres de campo.
  const guardado = {
    pago: { orderNumber: 'MBG-SO-1', amount: '1000.00', currency: 'DOP', orderId: null },
    cuerpo: { externalTransactionId: 'TX-9', providerStatus: 'APPROVED', order_reference: 'MBG-SO-1' },
  }
  const p = pagoDelPayload(guardado)
  assert.equal(p.orderNumber, 'MBG-SO-1')
  assert.equal(p.amount, '1000.00')
  assert.equal(p.currency, 'DOP')
  assert.equal(p.externalTransactionId, 'TX-9')
  assert.equal(p.providerStatus, 'APPROVED')

  // Y un payload que no tiene nada no revienta: devuelve nulos.
  for (const basura of [null, undefined, 'texto', [], 42, {}]) {
    const v = pagoDelPayload(basura)
    assert.equal(v.amount, null)
    assert.equal(v.externalTransactionId, null)
  }
})

test('20 · un fallo de la puerta NO es un desacuerdo financiero', () => {
  // Firma inválida, replay, cuerpo ilegible y proveedor desconocido se
  // rechazan ANTES de tocar la base (bloque 2): no llegan a la conciliación, no
  // tienen estado externo que comparar y no pueden abrir un incidente
  // financiero. Es seguridad de la integración, no finanzas, y mezclarlas
  // llenaría la cola de finanzas de basura de entrada.
  const codigosDeLaPuerta = ['INVALID_SIGNATURE', 'REPLAY_REJECTED', 'INVALID_PAYLOAD', 'UNKNOWN_PROVIDER']
  for (const c of codigosDeLaPuerta) {
    assert.ok(!(c in MOTIVOS), `${c} no es un motivo de incidente financiero`)
  }
  // Y ninguno de los motivos financieros habla de firmas ni de cuerpos.
  for (const m of Object.keys(MOTIVOS)) {
    assert.ok(!/SIGNATURE|REPLAY|PAYLOAD|PROVIDER_UNKNOWN/.test(m), m)
  }
})

test('20a · la matriz es total: ninguna combinación se queda sin veredicto', () => {
  const internos: EstadoInterno[] = ['PENDING', 'AWAITING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED', 'PAYMENT_REJECTED', 'UNKNOWN']
  const externos: EstadoExterno[] = ['PAID', 'PENDING', 'FAILED', 'UNKNOWN']
  const permitidos = ['MATCHED', 'MISMATCH', 'WAITING', 'IGNORED']
  let combinaciones = 0
  for (const i of internos) {
    for (const e of externos) {
      const v = reconciliarEstadoPago(interno(i), externo(e, e === 'PAID' ? '1000.00' : null))
      assert.ok(permitidos.includes(v.resultado), `${i}/${e} → ${v.resultado}`)
      assert.ok(v.explicacion.length > 10, `${i}/${e} se explica en palabras`)
      if (v.resultado === 'MISMATCH') assert.ok(v.motivo, `${i}/${e} dice por qué`)
      else assert.equal(v.motivo, null, `${i}/${e} no inventa un motivo`)
      combinaciones++
    }
  }
  assert.equal(combinaciones, internos.length * externos.length, '28 combinaciones, todas decididas')
})
