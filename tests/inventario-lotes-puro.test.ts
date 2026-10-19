import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CODIGO_SIN_LOTE,
  DIAS_AVISO_POR_DEFECTO,
  MAX_LOTES_POR_LINEA,
  asignacionDeReserva,
  diasEntre,
  disponibleDeLote,
  esDiaValido,
  esVendible,
  estadoDeLote,
  fusionarReparto,
  lotesVendibles,
  normalizarCodigoLote,
  ordenFefo,
  parsearVencimiento,
  planDeBarrido,
  planDeConsumo,
  repartirFefo,
  repartoDeDevolucion,
  sumaDeReparto,
  textoVencimiento,
  validarCodigoDeLoteNuevo,
  validarDiasAviso,
  validarLotesDeLinea,
  validarMovimientoEntreLotes,
  type LoteConSaldo,
} from '../src/modules/inventory/lotes'

/**
 * INV-5a.2 · LOTES Y VENCIMIENTO, las reglas puras: códigos, fechas de calendario, FEFO, apartados, devoluciones, barrido y líneas de
 * entrada con lotes. Sin base de datos ni servidor.
 *
 * Ejecutar: npm test
 */

const HOY = '2027-06-15'

let n = 0
/** Un lote con lo dado; por omisión, sin vencimiento y con 10 disponibles. */
function lote(o: Partial<LoteConSaldo> & { codigo?: string } = {}): LoteConSaldo {
  n++
  return { loteId: `l${String(n).padStart(3, '0')}`, codigo: o.codigo ?? `L-${n}`, vencimiento: null, legado: false, creadoEn: n, onHand: 10, reserved: 0, damaged: 0, ...o }
}

const cantidades = (r: ReturnType<typeof repartirFefo>) => (r.ok ? r.reparto.map((x) => [x.loteId, x.cantidad]) : null)

// ── Códigos ──────────────────────────────────────────────────────────────────

test('el código se normaliza: sin espacios sobrantes, un solo espacio entre palabras, en mayúsculas', () => {
  assert.deepEqual(normalizarCodigoLote('  lote  a-12  '), { ok: true, valor: 'LOTE A-12' })
  assert.deepEqual(normalizarCodigoLote('lote a-12'), normalizarCodigoLote('LOTE A-12'), 'mayúsculas y minúsculas son el mismo lote')
  assert.deepEqual(normalizarCodigoLote('año-ñ1'), { ok: true, valor: 'AÑO-Ñ1' }, 'letras de cualquier idioma')
  assert.deepEqual(normalizarCodigoLote('a1-b2_c3.d4/e5#f6+g7:h8'), { ok: true, valor: 'A1-B2_C3.D4/E5#F6+G7:H8' }, 'los signos que traen los códigos reales')
  assert.deepEqual(normalizarCodigoLote('0123456789'), { ok: true, valor: '0123456789' })
})

test('el código tiene entre 1 y 60 caracteres y solo la forma de un código', () => {
  assert.equal(normalizarCodigoLote('X'.repeat(60)).ok, true, '60 caben')
  assert.equal(normalizarCodigoLote('X'.repeat(61)).ok, false, '61 no')
  for (const malo of ['', '   ', '-A', '.A', ' ', 'A,B', 'A;B', 'A"B', "A'B", 'A\u0007B', 'A*B', 'A%B', 'A<B>', 'A\\B']) {
    assert.equal(normalizarCodigoLote(malo).ok, false, JSON.stringify(malo))
  }
  for (const noTexto of [null, undefined, 12, {}, [], true]) assert.equal(normalizarCodigoLote(noTexto).ok, false)
  // El tab y el salto de línea se tratan como espacio al reducir (el código guardado nunca los lleva); un carácter de control, no pasa.
  assert.deepEqual(normalizarCodigoLote('A\tB'), { ok: true, valor: 'A B' })
  assert.deepEqual(normalizarCodigoLote('A\nB'), { ok: true, valor: 'A B' })
})

test('«SIN LOTE» es el legado: se reconoce, y no se puede crear como un lote nuevo (ni escrito de otra manera)', () => {
  assert.deepEqual(normalizarCodigoLote('sin lote'), { ok: true, valor: CODIGO_SIN_LOTE })
  for (const intento of ['SIN LOTE', 'sin lote', ' Sin   Lote ']) assert.equal(validarCodigoDeLoteNuevo(intento).ok, false, intento)
  assert.deepEqual(validarCodigoDeLoteNuevo('SIN LOTE 2'), { ok: true, valor: 'SIN LOTE 2' }, 'solo ese texto exacto está reservado')
  assert.deepEqual(validarCodigoDeLoteNuevo('lote-1'), { ok: true, valor: 'LOTE-1' })
})

// ── Fechas ───────────────────────────────────────────────────────────────────

test('un día de calendario es de verdad un día', () => {
  for (const ok of ['2027-02-28', '2028-02-29', '2000-01-01', '2100-12-31', '2027-12-31']) assert.equal(esDiaValido(ok), true, ok)
  for (const mal of ['2027-02-29', '2027-02-30', '2027-13-01', '2027-00-10', '2027-04-31', '2027-2-3', '27-02-03', '2027/02/03', '2027-02-03T00:00:00Z', '', ' 2027-02-03', null, 20270203]) {
    assert.equal(esDiaValido(mal), false, String(mal))
  }
})

test('el vencimiento: vacío es «no vence»; si no, un día real entre el 2000 y el 2100', () => {
  for (const vacio of [undefined, null, '', '   ']) assert.deepEqual(parsearVencimiento(vacio), { ok: true, valor: null }, String(vacio))
  assert.deepEqual(parsearVencimiento(' 2027-05-31 '), { ok: true, valor: '2027-05-31' })
  assert.deepEqual(parsearVencimiento('2000-01-01'), { ok: true, valor: '2000-01-01' }, 'el límite de abajo cabe')
  assert.deepEqual(parsearVencimiento('2100-12-31'), { ok: true, valor: '2100-12-31' }, 'el de arriba también')
  for (const mal of ['1999-12-31', '2101-01-01', '0225-01-01', '2205-01-01', '2027-02-30', '31/05/2027', 'mañana', 20270531, {}]) {
    assert.equal(parsearVencimiento(mal).ok, false, String(mal))
  }
})

test('los días entre dos fechas cuentan días de calendario, sin que un cambio de hora ni de año los mueva', () => {
  assert.equal(diasEntre('2027-06-15', '2027-06-15'), 0)
  assert.equal(diasEntre('2027-06-15', '2027-06-16'), 1)
  assert.equal(diasEntre('2027-06-15', '2027-06-14'), -1)
  assert.equal(diasEntre('2027-12-31', '2028-01-01'), 1, 'cambio de año')
  assert.equal(diasEntre('2028-02-28', '2028-03-01'), 2, 'año bisiesto')
  assert.equal(diasEntre('2027-03-13', '2027-03-14'), 1, 'cambio de hora de primavera')
  assert.equal(diasEntre('2027-11-06', '2027-11-07'), 1, 'cambio de hora de otoño')
  assert.equal(diasEntre('2027-01-01', '2027-12-31'), 364)
})

test('el estado de un lote: vence hoy todavía se vende; vencido es desde mañana; por vencer cuenta los días de aviso', () => {
  assert.equal(DIAS_AVISO_POR_DEFECTO, 30)
  assert.equal(estadoDeLote(null, HOY), 'SIN_VENCIMIENTO')
  assert.equal(estadoDeLote('2027-06-14', HOY), 'VENCIDO', 'venció ayer')
  assert.equal(estadoDeLote('2027-06-15', HOY), 'POR_VENCER', 'vence hoy: todavía es vendible')
  assert.equal(estadoDeLote('2027-07-15', HOY), 'POR_VENCER', 'justo a 30 días')
  assert.equal(estadoDeLote('2027-07-16', HOY), 'VIGENTE', 'a 31 días')
  assert.equal(estadoDeLote('2027-07-16', HOY, 31), 'POR_VENCER', 'con 31 días de aviso')
  assert.equal(estadoDeLote('2027-06-16', HOY, 0), 'VIGENTE', 'con 0 días de aviso solo lo de hoy es «por vencer»')
  assert.equal(estadoDeLote('2027-06-15', HOY, 0), 'POR_VENCER')
  assert.equal(esVendible(null, HOY), true)
  assert.equal(esVendible('2027-06-15', HOY), true, 'el último día se vende')
  assert.equal(esVendible('2027-06-14', HOY), false)
})

test('el texto del vencimiento', () => {
  assert.equal(textoVencimiento(null, HOY), 'No vence')
  assert.equal(textoVencimiento('2027-06-15', HOY), 'Vence hoy')
  assert.equal(textoVencimiento('2027-06-16', HOY), 'Vence mañana')
  assert.equal(textoVencimiento('2027-06-27', HOY), 'Vence en 12 días')
  assert.equal(textoVencimiento('2027-06-14', HOY), 'Venció ayer')
  assert.equal(textoVencimiento('2027-06-12', HOY), 'Venció hace 3 días')
})

test('los días de aviso: enteros de 0 a 365 (también como texto)', () => {
  assert.deepEqual(validarDiasAviso(0), { ok: true, valor: 0 })
  assert.deepEqual(validarDiasAviso('45'), { ok: true, valor: 45 })
  assert.deepEqual(validarDiasAviso(365), { ok: true, valor: 365 })
  for (const mal of [-1, 366, 1.5, '', 'x', null, undefined, NaN]) assert.equal(validarDiasAviso(mal).ok, false, String(mal))
})

// ── FEFO ─────────────────────────────────────────────────────────────────────

test('FEFO: sale primero lo que antes vence; lo que no vence, al final; a igual día, el legado y luego el más antiguo', () => {
  const sinFecha = lote({ codigo: 'B-SIN' })
  const legado = lote({ codigo: CODIGO_SIN_LOTE, legado: true, creadoEn: 1 })
  const junio = lote({ vencimiento: '2027-06-20' })
  const mayo = lote({ vencimiento: '2027-05-01' })
  const junioLegado = lote({ vencimiento: '2027-06-20', legado: true })
  const junioViejo = lote({ vencimiento: '2027-06-20', creadoEn: 0, codigo: 'Z' })
  const todos = [sinFecha, legado, junio, mayo, junioLegado, junioViejo]
  const orden = [...todos].sort(ordenFefo).map((l) => l.loteId)
  assert.deepEqual(orden, [mayo, junioLegado, junioViejo, junio, legado, sinFecha].map((l) => l.loteId))
})

test('FEFO: el orden no depende del orden en que llegaron las filas (todas las permutaciones)', () => {
  const lotes = [lote({ vencimiento: '2027-07-01' }), lote({ vencimiento: '2027-07-01', codigo: 'A' }), lote(), lote({ vencimiento: '2027-06-20' })]
  const permutaciones = (a: LoteConSaldo[]): LoteConSaldo[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutaciones([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])))
  const esperado = [...lotes].sort(ordenFefo).map((l) => l.loteId)
  for (const p of permutaciones(lotes)) assert.deepEqual([...p].sort(ordenFefo).map((l) => l.loteId), esperado)
})

test('FEFO: a igual día y a igual antigüedad, el empate lo cierra el código y, si hace falta, el id (nunca el orden de llegada)', () => {
  const mismoMomento = { vencimiento: '2027-07-01', creadoEn: 500 }
  const b = lote({ ...mismoMomento, codigo: 'B' })
  const a = lote({ ...mismoMomento, codigo: 'A' })
  assert.deepEqual([b, a].sort(ordenFefo).map((l) => l.codigo), ['A', 'B'])
  assert.deepEqual([a, b].sort(ordenFefo).map((l) => l.codigo), ['A', 'B'])
  // Mismo código y mismo momento (no ocurre dentro de un producto, pero el orden sigue siendo total): decide el id.
  const x1 = { ...lote({ ...mismoMomento, codigo: 'X' }), loteId: 'id-1' }
  const x2 = { ...lote({ ...mismoMomento, codigo: 'X' }), loteId: 'id-2' }
  assert.deepEqual([x2, x1].sort(ordenFefo).map((l) => l.loteId), ['id-1', 'id-2'])
  assert.deepEqual([x1, x2].sort(ordenFefo).map((l) => l.loteId), ['id-1', 'id-2'])
  assert.equal(ordenFefo(x1, { ...x1 }), 0, 'el mismo lote consigo mismo empata')
})

test('repartir: toma de cada lote lo que tiene, en orden FEFO, y para cuando alcanza', () => {
  const a = lote({ vencimiento: '2027-06-20', onHand: 3 })
  const b = lote({ vencimiento: '2027-07-10', onHand: 5 })
  const c = lote({ onHand: 100 })
  assert.deepEqual(cantidades(repartirFefo([c, b, a], 2, HOY)), [[a.loteId, 2]], 'cabe en el primero')
  assert.deepEqual(cantidades(repartirFefo([c, b, a], 3, HOY)), [[a.loteId, 3]], 'justo el primero')
  assert.deepEqual(cantidades(repartirFefo([c, b, a], 4, HOY)), [[a.loteId, 3], [b.loteId, 1]], 'salta al siguiente')
  assert.deepEqual(cantidades(repartirFefo([c, b, a], 20, HOY)), [[a.loteId, 3], [b.loteId, 5], [c.loteId, 12]], 'y al que no vence')
  assert.deepEqual(cantidades(repartirFefo([a], 3, HOY)), [[a.loteId, 3]], 'todo lo que hay')
})

test('repartir: lo apartado no se reparte, lo vencido no cuenta y dice cuánto falta', () => {
  const apartado = lote({ vencimiento: '2027-06-20', onHand: 10, reserved: 8 })
  const vencido = lote({ vencimiento: '2027-06-01', onHand: 7 })
  const vigente = lote({ vencimiento: '2027-08-01', onHand: 4 })
  assert.equal(disponibleDeLote(apartado), 2)
  assert.deepEqual(cantidades(repartirFefo([vencido, apartado, vigente], 6, HOY)), [[apartado.loteId, 2], [vigente.loteId, 4]])
  const corto = repartirFefo([vencido, apartado, vigente], 7, HOY)
  assert.deepEqual(corto, { ok: false, faltan: 1, vendible: 6, vencido: 7 }, 'hay 7 vencidos pero no se pueden vender')
  assert.deepEqual(repartirFefo([], 1, HOY), { ok: false, faltan: 1, vendible: 0, vencido: 0 })
  assert.deepEqual(lotesVendibles([vencido, apartado, vigente, lote({ onHand: 5, reserved: 5 })], HOY).map((l) => l.loteId), [apartado.loteId, vigente.loteId], 'sin disponible no es vendible')
})

test('repartir: el último día de un lote todavía se vende; el día siguiente ya no', () => {
  const l = lote({ vencimiento: '2027-06-15', onHand: 5 })
  assert.equal(repartirFefo([l], 5, '2027-06-15').ok, true)
  assert.equal(repartirFefo([l], 5, '2027-06-16').ok, false)
})

test('repartir: una cantidad que no es un entero positivo no reparte nada', () => {
  const l = lote({ onHand: 5 })
  for (const mala of [0, -1, 1.5, NaN]) assert.equal(repartirFefo([l], mala, HOY).ok, false, String(mala))
})

test('repartir (propiedad): el reparto suma lo pedido, no pasa del disponible de ningún lote, no toca lo vencido y va en orden FEFO', () => {
  let semilla = 20270615
  const azar = (max: number) => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla % max
  }
  const fechas = [null, '2027-05-01', '2027-06-14', '2027-06-15', '2027-06-16', '2027-07-01', '2027-12-31']
  for (let ronda = 0; ronda < 400; ronda++) {
    const lotes = Array.from({ length: 1 + azar(6) }, () => {
      const onHand = azar(12)
      return lote({ vencimiento: fechas[azar(fechas.length)], onHand, reserved: azar(onHand + 1), legado: azar(5) === 0 })
    })
    const pedido = 1 + azar(40)
    const r = repartirFefo(lotes, pedido, HOY)
    const vendible = lotesVendibles(lotes, HOY).reduce((s, l) => s + disponibleDeLote(l), 0)
    if (!r.ok) {
      assert.ok(vendible < pedido, 'solo falla si de verdad no alcanza')
      assert.equal(r.faltan, pedido - vendible)
      continue
    }
    assert.ok(vendible >= pedido)
    assert.equal(sumaDeReparto(r.reparto), pedido)
    const orden = lotesVendibles(lotes, HOY)
    let indice = -1
    for (const parte of r.reparto) {
      const i = orden.findIndex((l) => l.loteId === parte.loteId)
      assert.ok(i > indice, 'va en orden FEFO y sin repetir lote')
      indice = i
      assert.ok(parte.cantidad > 0 && parte.cantidad <= disponibleDeLote(orden[i]), 'nunca más de lo que el lote tiene disponible')
    }
    // Solo el último lote tocado puede quedar a medias.
    for (const parte of r.reparto.slice(0, -1)) assert.equal(parte.cantidad, disponibleDeLote(orden.find((l) => l.loteId === parte.loteId)!), 'se vacía un lote antes de pasar al siguiente')
  }
})

test('fusionar un reparto suma el mismo lote, quita los ceros y respeta la primera aparición', () => {
  assert.deepEqual(fusionarReparto([{ loteId: 'a', cantidad: 2 }, { loteId: 'b', cantidad: 1 }, { loteId: 'a', cantidad: 3 }, { loteId: 'c', cantidad: 0 }]), [
    { loteId: 'a', cantidad: 5 },
    { loteId: 'b', cantidad: 1 },
  ])
  assert.deepEqual(fusionarReparto([{ loteId: 'a', cantidad: 2 }, { loteId: 'a', cantidad: -2 }]), [], 'lo que se anula desaparece')
  assert.equal(sumaDeReparto([{ loteId: 'a', cantidad: 2 }, { loteId: 'b', cantidad: 5 }]), 7)
})

// ── Lo apartado ──────────────────────────────────────────────────────────────

test('de qué lote es una reserva: lo que dice su historia; lo que la historia no explica es del legado', () => {
  // Apartada después de activar: 3 del lote A y 2 del B.
  assert.deepEqual(asignacionDeReserva([{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 2 }], 5, 'LEG'), { ok: true, reparto: [{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 2 }] })
  // Apartada ANTES de activar: no tiene reparto, todo es del legado.
  assert.deepEqual(asignacionDeReserva([], 5, 'LEG'), { ok: true, reparto: [{ loteId: 'LEG', cantidad: 5 }] })
  // Un faltante parcial también va al legado.
  assert.deepEqual(asignacionDeReserva([{ loteId: 'A', cantidad: 3 }], 5, 'LEG'), { ok: true, reparto: [{ loteId: 'A', cantidad: 3 }, { loteId: 'LEG', cantidad: 2 }] })
  // Los renglones del mismo lote se netean (apartar 3 y liberar 3 de A deja cero).
  assert.deepEqual(asignacionDeReserva([{ loteId: 'A', cantidad: 3 }, { loteId: 'A', cantidad: -1 }, { loteId: 'B', cantidad: 2 }], 4, 'LEG'), { ok: true, reparto: [{ loteId: 'A', cantidad: 2 }, { loteId: 'B', cantidad: 2 }] })
})

test('de qué lote es una reserva: si el ledger no cuadra con ella, se dice', () => {
  assert.equal(asignacionDeReserva([{ loteId: 'A', cantidad: -1 }], 5, 'LEG').ok, false, 'liberó más de lo que apartó')
  assert.equal(asignacionDeReserva([{ loteId: 'A', cantidad: 6 }], 5, 'LEG').ok, false, 'repartida de más')
  assert.equal(asignacionDeReserva([{ loteId: 'A', cantidad: 5 }], 5, 'LEG').ok, true)
})

test('consumir una reserva: si ningún lote venció, se vende de donde se apartó', () => {
  const a = lote({ vencimiento: '2027-06-20', onHand: 5, reserved: 3 })
  const b = lote({ onHand: 10, reserved: 2 })
  const plan = planDeConsumo([{ loteId: a.loteId, cantidad: 3 }, { loteId: b.loteId, cantidad: 2 }], [a, b], HOY)
  assert.deepEqual(plan, { ok: true, vender: [{ loteId: a.loteId, cantidad: 3 }, { loteId: b.loteId, cantidad: 2 }], liberar: [], reapartar: [] })
})

test('consumir una reserva cuyo lote venció: no se entrega vencido; se libera y se aparta del siguiente que se vende', () => {
  const vencido = lote({ vencimiento: '2027-06-10', onHand: 5, reserved: 3 })
  const bueno = lote({ vencimiento: '2027-07-20', onHand: 6, reserved: 1 })
  const sinFecha = lote({ onHand: 50 })
  const plan = planDeConsumo([{ loteId: vencido.loteId, cantidad: 3 }, { loteId: bueno.loteId, cantidad: 1 }], [vencido, bueno, sinFecha], HOY)
  assert.equal(plan.ok, true)
  if (plan.ok) {
    assert.deepEqual(plan.liberar, [{ loteId: vencido.loteId, cantidad: 3 }])
    // Lo que sobra disponible: bueno 6-1=5 (cabe las 3), así que se apartan 3 de bueno.
    assert.deepEqual(plan.reapartar, [{ loteId: bueno.loteId, cantidad: 3 }])
    assert.deepEqual(plan.vender, [{ loteId: bueno.loteId, cantidad: 4 }], 'la 1 que ya tenía apartada + las 3 de reposición, del mismo lote')
    assert.equal(sumaDeReparto(plan.vender), 4, 'se vende exactamente lo apartado')
  }
  // Sin con qué reponer, la venta no se puede completar.
  const sinReponer = planDeConsumo([{ loteId: vencido.loteId, cantidad: 3 }], [vencido], HOY)
  assert.deepEqual(sinReponer, { ok: false, faltan: 3, vendible: 0, vencido: 2 })
})

// ── Devoluciones ─────────────────────────────────────────────────────────────

test('devolver: vuelve a los lotes de que salió, y lo que los movimientos no explican, al legado', () => {
  const vendido = [{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 2 }]
  assert.deepEqual(repartoDeDevolucion(vendido, 5, 'LEG'), [{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 2 }], 'todo')
  assert.deepEqual(repartoDeDevolucion(vendido, 2, 'LEG'), [{ loteId: 'A', cantidad: 2 }], 'parte, en el orden en que salió')
  assert.deepEqual(repartoDeDevolucion(vendido, 4, 'LEG'), [{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 1 }])
  assert.deepEqual(repartoDeDevolucion(vendido, 7, 'LEG'), [{ loteId: 'A', cantidad: 3 }, { loteId: 'B', cantidad: 2 }, { loteId: 'LEG', cantidad: 2 }], 'el resto, al legado')
  assert.deepEqual(repartoDeDevolucion([], 4, 'LEG'), [{ loteId: 'LEG', cantidad: 4 }], 'una venta anterior a los lotes')
  assert.deepEqual(repartoDeDevolucion([{ loteId: 'LEG', cantidad: 1 }], 3, 'LEG'), [{ loteId: 'LEG', cantidad: 3 }], 'el legado se junta, no se repite')
  assert.deepEqual(repartoDeDevolucion(vendido, 0, 'LEG'), [])
  assert.deepEqual(repartoDeDevolucion([{ loteId: 'A', cantidad: 0 }, { loteId: 'B', cantidad: 2 }], 1, 'LEG'), [{ loteId: 'B', cantidad: 1 }], 'ignora lo que ya volvió')
  assert.equal(sumaDeReparto(repartoDeDevolucion(vendido, 9, 'LEG')), 9, 'siempre suma lo devuelto')
})

// ── Mover unidades de un lote a otro ─────────────────────────────────────────

test('mover unidades entre lotes: distintos, y solo lo disponible del origen', () => {
  const origen = lote({ codigo: 'MAL', onHand: 10, reserved: 4 })
  const destino = lote({ codigo: 'BIEN' })
  assert.equal(validarMovimientoEntreLotes({ origen, destino, cantidad: 6 }), null, 'justo lo disponible')
  assert.match(validarMovimientoEntreLotes({ origen, destino, cantidad: 7 }) ?? '', /solo tiene 6 unidades disponibles/, 'lo apartado no se mueve')
  assert.match(validarMovimientoEntreLotes({ origen, destino: origen, cantidad: 1 }) ?? '', /el mismo/)
  for (const mala of [0, -2, 1.5]) assert.notEqual(validarMovimientoEntreLotes({ origen, destino, cantidad: mala }), null, String(mala))
})

// ── Barrido ──────────────────────────────────────────────────────────────────

test('el barrido saca lo disponible de lo vencido, y solo eso', () => {
  const nivel = (nivelId: string, l: LoteConSaldo) => ({ ...l, nivelId })
  const vencidoConApartado = lote({ vencimiento: '2027-06-01', onHand: 9, reserved: 4 })
  const vencidoLimpio = lote({ vencimiento: '2027-06-14', onHand: 3 })
  const venceHoy = lote({ vencimiento: '2027-06-15', onHand: 8 })
  const sinFecha = lote({ onHand: 8 })
  const vencidoSinNada = lote({ vencimiento: '2027-01-01', onHand: 2, reserved: 2 })
  const plan = planDeBarrido(
    [nivel('n2', vencidoLimpio), nivel('n1', vencidoConApartado), nivel('n1', venceHoy), nivel('n1', sinFecha), nivel('n1', vencidoSinNada)],
    HOY
  )
  assert.deepEqual(plan, [
    { nivelId: 'n1', loteId: vencidoConApartado.loteId, cantidad: 5 },
    { nivelId: 'n2', loteId: vencidoLimpio.loteId, cantidad: 3 },
  ])
})

// ── Lotes en una línea de entrada ────────────────────────────────────────────

test('lotes de una línea: cada renglón con su código, su vencimiento y su cantidad; la suma es la de la línea', () => {
  const r = validarLotesDeLinea([{ codigo: 'a-1', vencimiento: '2027-12-31', cantidad: 6 }, { codigo: 'B-2', cantidad: 4 }], 10, { exigirVencimiento: false })
  assert.deepEqual(r, { ok: true, lotes: [{ codigo: 'A-1', vencimiento: '2027-12-31', cantidad: 6 }, { codigo: 'B-2', vencimiento: null, cantidad: 4 }] })
  // «SIN LOTE» sirve para lo que llega sin etiquetar.
  assert.deepEqual(validarLotesDeLinea([{ codigo: 'sin lote', cantidad: 3 }], 3, { exigirVencimiento: true }), { ok: true, lotes: [{ codigo: CODIGO_SIN_LOTE, vencimiento: null, cantidad: 3 }] }, 'ni siquiera si el producto exige vencimiento')
  // El mismo código dos veces se junta si trae el mismo vencimiento.
  assert.deepEqual(validarLotesDeLinea([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 2 }, { codigo: ' a ', vencimiento: '2027-12-31', cantidad: 3 }], 5, { exigirVencimiento: false }), { ok: true, lotes: [{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 5 }] })
})

test('lotes de una línea: cada error con su código', () => {
  const cod = (lotes: unknown, cantidad: number, exigir = false) => {
    const r = validarLotesDeLinea(lotes, cantidad, { exigirVencimiento: exigir })
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(cod(undefined, 3), 'LOTES_FALTAN')
  assert.equal(cod([], 3), 'LOTES_FALTAN')
  assert.equal(cod('A', 3), 'LOTES_FALTAN')
  assert.equal(cod(Array.from({ length: MAX_LOTES_POR_LINEA + 1 }, (_, i) => ({ codigo: `L${i}`, cantidad: 1 })), MAX_LOTES_POR_LINEA + 1), 'DEMASIADOS_LOTES')
  assert.equal(cod(Array.from({ length: MAX_LOTES_POR_LINEA }, (_, i) => ({ codigo: `L${i}`, cantidad: 1 })), MAX_LOTES_POR_LINEA), 'OK', 'el máximo cabe')
  assert.equal(cod([{ codigo: '', cantidad: 3 }], 3), 'LOTE_INVALIDO')
  assert.equal(cod([{ codigo: 'A,B', cantidad: 3 }], 3), 'LOTE_INVALIDO')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-02-30', cantidad: 3 }], 3), 'VENCIMIENTO_INVALIDO')
  assert.equal(cod([{ codigo: 'SIN LOTE', vencimiento: '2027-12-31', cantidad: 3 }], 3), 'SIN_LOTE_CON_VENCIMIENTO')
  assert.equal(cod([{ codigo: 'A', cantidad: 3 }], 3, true), 'VENCIMIENTO_OBLIGATORIO')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 3 }], 3, true), 'OK')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 0 }], 0), 'CANTIDAD_INVALIDA')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 1.5 }], 2), 'CANTIDAD_INVALIDA')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 2 }, { codigo: 'A', vencimiento: '2028-01-01', cantidad: 1 }], 3), 'VENCIMIENTO_DISTINTO', 'un lote tiene un solo vencimiento')
  assert.equal(cod([{ codigo: 'A', vencimiento: '2027-12-31', cantidad: 2 }, { codigo: 'A', cantidad: 1 }], 3), 'VENCIMIENTO_DISTINTO', 'con y sin vencimiento tampoco')
  assert.equal(cod([{ codigo: 'A', cantidad: 2 }], 3), 'LOTES_NO_CUADRAN', 'de menos')
  assert.equal(cod([{ codigo: 'A', cantidad: 4 }], 3), 'LOTES_NO_CUADRAN', 'de más')
  assert.equal(cod([null], 3), 'LOTE_INVALIDO')
})
