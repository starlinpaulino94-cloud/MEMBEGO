import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETIQUETA_ESTADO_ORDEN,
  MAX_LINEAS_ORDEN,
  TRANSICIONES_ORDEN,
  costoParaCampo,
  esEstadoOrden,
  estaCerrada,
  exigirPasoDeEstado,
  fechaPrevistaATexto,
  fusionarLineasOrden,
  parsearFechaPrevista,
  pendienteDeOrden,
  planDeRecepcionOrden,
  puedePasarA,
  puedeRecibirse,
  resumirOrden,
  validarCabeceraOrden,
  validarCancelacionDeOrden,
  validarLineasOrden,
  validarProveedor,
  validarVinculo,
  valorPedido,
  valorPendiente,
  type EstadoOrden,
  type LineaDeOrden,
} from '../src/modules/inventory/compras'
import { CANTIDAD_MAXIMA } from '../src/modules/inventory/domain'
import { formatearMonto, parsearCosto, type Costo } from '../src/modules/inventory/costos'
import { consultaDeFiltrosOrdenes, leerFiltrosOrdenes } from '../src/modules/inventory/filtros'
import { ordenToCsv, type OrdenParaCsv } from '../src/modules/inventory/exportacion'

const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, `«${t}» debía ser un costo válido`)
  return r.valor
}
const ESTADOS: EstadoOrden[] = ['DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED']

// ── Estados ──────────────────────────────────────────────────────────────────

test('la tabla de transiciones es la del diseño: borrador→pedida|cancelada, pedida→parcial|recibida|cancelada, parcial→recibida; lo cerrado no sale', () => {
  assert.deepEqual(TRANSICIONES_ORDEN, {
    DRAFT: ['ORDERED', 'CANCELLED'],
    ORDERED: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
    PARTIAL: ['RECEIVED'],
    RECEIVED: [],
    CANCELLED: [],
  })
  const permitidas = new Set(Object.entries(TRANSICIONES_ORDEN).flatMap(([d, hs]) => hs.map((h) => `${d}>${h}`)))
  for (const d of ESTADOS) {
    for (const h of ESTADOS) assert.equal(puedePasarA(d, h), permitidas.has(`${d}>${h}`), `${d} → ${h}`)
  }
  assert.throws(() => exigirPasoDeEstado('PARTIAL', 'CANCELLED'), /no se puede pasar de PARTIAL a CANCELLED/)
  assert.doesNotThrow(() => exigirPasoDeEstado('ORDERED', 'PARTIAL'))
})

test('cada estado tiene su etiqueta, se reconoce, y solo pedida/parcial reciben mercancía; solo recibida/cancelada están cerradas', () => {
  for (const e of ESTADOS) {
    assert.ok(ETIQUETA_ESTADO_ORDEN[e].length > 2)
    assert.ok(esEstadoOrden(e))
  }
  assert.equal(esEstadoOrden('SENT'), false)
  assert.equal(esEstadoOrden(undefined), false)
  assert.deepEqual(ESTADOS.filter(puedeRecibirse), ['ORDERED', 'PARTIAL'])
  assert.deepEqual(ESTADOS.filter(estaCerrada), ['RECEIVED', 'CANCELLED'])
})

// ── Proveedor ────────────────────────────────────────────────────────────────

test('un proveedor: solo el nombre es obligatorio; los textos se recortan y juntan espacios; vacío = no hay', () => {
  const r = validarProveedor({ nombre: '  Distribuidora   Norte ', rnc: ' 101-1 ', contacto: '', telefono: undefined, correo: ' a@b.co ', diasCredito: '30', notas: null })
  assert.ok(r.ok)
  assert.deepEqual(r.valor, { nombre: 'Distribuidora Norte', rnc: '101-1', contacto: null, telefono: null, correo: 'a@b.co', diasCredito: 30, notas: null })
  const solo = validarProveedor({ nombre: 'X' })
  assert.ok(solo.ok)
  assert.deepEqual(solo.valor, { nombre: 'X', rnc: null, contacto: null, telefono: null, correo: null, diasCredito: 0, notas: null })
})

test('un proveedor mal formado dice QUÉ está mal', () => {
  const codigo = (e: unknown) => {
    const r = validarProveedor(e)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(codigo(undefined), 'NOMBRE_OBLIGATORIO')
  assert.equal(codigo({}), 'NOMBRE_OBLIGATORIO')
  assert.equal(codigo({ nombre: '   ' }), 'NOMBRE_OBLIGATORIO')
  assert.equal(codigo({ nombre: 'x'.repeat(121) }), 'NOMBRE_INVALIDO')
  assert.equal(codigo({ nombre: 'x'.repeat(120) }), 'OK')
  assert.equal(codigo({ nombre: 5 }), 'NOMBRE_INVALIDO')
  assert.equal(codigo({ nombre: 'a\u0000b' }), 'NOMBRE_INVALIDO', 'sin caracteres de control')
  assert.equal(codigo({ nombre: 'X', rnc: 'r'.repeat(31) }), 'RNC_INVALIDO')
  assert.equal(codigo({ nombre: 'X', contacto: 'c'.repeat(121) }), 'CONTACTO_INVALIDO')
  assert.equal(codigo({ nombre: 'X', telefono: 't'.repeat(41) }), 'TELEFONO_INVALIDO')
  assert.equal(codigo({ nombre: 'X', correo: 'sin-arroba' }), 'CORREO_INVALIDO')
  assert.equal(codigo({ nombre: 'X', correo: 'a b@c.co' }), 'CORREO_INVALIDO')
  assert.equal(codigo({ nombre: 'X', correo: 'a@b' }), 'CORREO_INVALIDO')
  assert.equal(codigo({ nombre: 'X', notas: 'n'.repeat(501) }), 'NOTAS_INVALIDAS')
  for (const dias of [-1, 366, 1.5, 'abc', '1.5', '-3', '1e2', Number.NaN, {}, true]) assert.equal(codigo({ nombre: 'X', diasCredito: dias }), 'DIAS_CREDITO_INVALIDOS', `días ${String(dias)}`)
  for (const dias of [0, 365, '0', '365', ' 15 ', '', null, undefined]) assert.equal(codigo({ nombre: 'X', diasCredito: dias }), 'OK', `días ${String(dias)}`)
})

test('el vínculo producto↔proveedor: código y días opcionales; «preferido» solo si es exactamente true', () => {
  const r = validarVinculo({ codigoProveedor: ' AB  12 ', diasEntrega: '5', preferido: true })
  assert.ok(r.ok)
  assert.deepEqual(r.valor, { codigoProveedor: 'AB 12', diasEntrega: 5, preferido: true })
  const vacio = validarVinculo({})
  assert.ok(vacio.ok)
  assert.deepEqual(vacio.valor, { codigoProveedor: null, diasEntrega: null, preferido: false })
  const casi = validarVinculo({ preferido: 'true' })
  assert.ok(casi.ok)
  assert.equal(casi.valor.preferido, false, 'un texto no cuenta como true')
  for (const malo of [{ diasEntrega: 366 }, { diasEntrega: -1 }, { diasEntrega: 'x' }, { diasEntrega: 1.5 }]) {
    const m = validarVinculo(malo)
    assert.ok(!m.ok && m.codigo === 'DIAS_ENTREGA_INVALIDOS')
  }
  const largo = validarVinculo({ codigoProveedor: 'c'.repeat(81) })
  assert.ok(!largo.ok && largo.codigo === 'CODIGO_INVALIDO')
  assert.ok(validarVinculo({ diasEntrega: 0 }).ok, 'cero días (mismo día) es válido')
})

// ── Cabecera y fecha ─────────────────────────────────────────────────────────

test('la fecha prevista: un día real entre 2000 y 2100, vacío = sin fecha, guardado como medianoche UTC', () => {
  for (const v of [undefined, null, '', '   ']) {
    const r = parsearFechaPrevista(v)
    assert.ok(r.ok && r.valor === null, String(v))
  }
  const ok = parsearFechaPrevista('2028-02-29')
  assert.ok(ok.ok && ok.valor)
  assert.equal(ok.valor.toISOString(), '2028-02-29T00:00:00.000Z')
  assert.equal(fechaPrevistaATexto(ok.valor), '2028-02-29')
  assert.equal(fechaPrevistaATexto(null), '')
  for (const malo of ['2027-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', 'mañana', '1999-12-31', '2101-01-01', 20260101, '2026-01-01T00:00']) {
    assert.equal(parsearFechaPrevista(malo).ok, false, String(malo))
  }
  assert.ok(parsearFechaPrevista('2000-01-01').ok)
  assert.ok(parsearFechaPrevista('2100-12-31').ok)
})

test('la cabecera exige proveedor y sucursal; referencia y nota se acotan', () => {
  const ok = validarCabeceraOrden({ proveedorId: ' p1 ', sucursalId: 's1', referencia: ' Cot   7 ', nota: '', fechaPrevista: '2030-05-06' })
  assert.ok(ok.ok)
  assert.equal(ok.valor.proveedorId, 'p1')
  assert.equal(ok.valor.referencia, 'Cot 7')
  assert.equal(ok.valor.nota, null)
  assert.equal(ok.valor.fechaPrevista?.toISOString(), '2030-05-06T00:00:00.000Z')
  const codigo = (e: unknown) => {
    const r = validarCabeceraOrden(e)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(codigo({ sucursalId: 's' }), 'PROVEEDOR_OBLIGATORIO')
  assert.equal(codigo({ proveedorId: '', sucursalId: 's' }), 'PROVEEDOR_OBLIGATORIO')
  assert.equal(codigo({ proveedorId: 'x'.repeat(121), sucursalId: 's' }), 'PROVEEDOR_OBLIGATORIO')
  assert.equal(codigo({ proveedorId: 'p' }), 'SUCURSAL_OBLIGATORIA')
  assert.equal(codigo({ proveedorId: 'p', sucursalId: 's', referencia: 'r'.repeat(121) }), 'REFERENCIA_INVALIDA')
  assert.equal(codigo({ proveedorId: 'p', sucursalId: 's', nota: 'n'.repeat(501) }), 'NOTA_INVALIDA')
  assert.equal(codigo({ proveedorId: 'p', sucursalId: 's', fechaPrevista: '2026-02-30' }), 'FECHA_INVALIDA')
  assert.equal(codigo(null), 'PROVEEDOR_OBLIGATORIO')
})

// ── Líneas ───────────────────────────────────────────────────────────────────

test('las líneas de una orden: cantidad entera y COSTO obligatorio; cero es un costo válido (mercancía de regalo)', () => {
  const r = validarLineasOrden([
    { varianteId: 'a', cantidad: 10, costo: '5' },
    { varianteId: ' b ', cantidad: 3, costo: ' 12.5 ' },
    { varianteId: 'c', cantidad: 1, costo: 0 },
    { varianteId: 'd', cantidad: 4, costo: '0.0001' },
  ])
  assert.ok(r.ok)
  assert.deepEqual(
    r.lineas.map((l) => [l.varianteId, l.cantidad, l.costo]),
    [
      ['a', 10, '5.0000'],
      ['b', 3, '12.5000'],
      ['c', 1, '0.0000'],
      ['d', 4, '0.0001'],
    ]
  )
  assert.equal(r.unidades, 18)
  assert.equal(r.valor, c('50') + c('37.5') + c('0') + c('0.0004'))
  assert.equal(formatearMonto(r.valor), '87.50')
})

test('las líneas inválidas se rechazan con su código y dicen en qué línea', () => {
  const cod = (lineas: unknown) => {
    const r = validarLineasOrden(lineas)
    return r.ok ? 'OK' : r.codigo
  }
  const msg = (lineas: unknown) => {
    const r = validarLineasOrden(lineas)
    return r.ok ? '' : r.error
  }
  assert.equal(cod(undefined), 'ORDEN_SIN_LINEAS')
  assert.equal(cod([]), 'ORDEN_SIN_LINEAS')
  assert.equal(cod('x'), 'ORDEN_SIN_LINEAS')
  assert.equal(cod([null]), 'LINEA_INVALIDA')
  assert.equal(cod([{ varianteId: '', cantidad: 1, costo: '1' }]), 'LINEA_INVALIDA')
  assert.equal(cod([{ varianteId: 'a', cantidad: 1, costo: '1' }, { varianteId: 'a', cantidad: 2, costo: '1' }]), 'LINEA_REPETIDA')
  for (const q of [0, -1, 1.5, '3', null, undefined, CANTIDAD_MAXIMA + 1]) assert.equal(cod([{ varianteId: 'a', cantidad: q, costo: '1' }]), 'CANTIDAD_INVALIDA', `cantidad ${String(q)}`)
  assert.equal(cod([{ varianteId: 'a', cantidad: CANTIDAD_MAXIMA, costo: '1' }]), 'OK')
  for (const k of [undefined, null, '', '   ']) assert.equal(cod([{ varianteId: 'a', cantidad: 1, costo: k }]), 'COSTO_OBLIGATORIO', `costo ${String(k)}`)
  for (const k of ['1,5', '-1', 'abc', '1.23456', '100000001', '1e3', '$5', '١٢']) assert.equal(cod([{ varianteId: 'a', cantidad: 1, costo: k }]), 'COSTO_INVALIDO', `costo ${k}`)
  assert.match(msg([{ varianteId: 'a', cantidad: 1, costo: '1' }, { varianteId: 'b', cantidad: 0, costo: '1' }]), /^Línea 2:/)
  assert.match(msg([{ varianteId: 'a', cantidad: 1, costo: '1' }, { varianteId: 'b', cantidad: 1, costo: '' }]), /^Línea 2:/)
  assert.match(msg([{ varianteId: 'a', cantidad: 1, costo: 'x' }]), /^Línea 1:/)
})

test('el tope de líneas: 200 sí, 201 no; el tope se puede ajustar', () => {
  const hacer = (n: number) => Array.from({ length: n }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1, costo: '1' }))
  assert.ok(validarLineasOrden(hacer(MAX_LINEAS_ORDEN)).ok)
  const r = validarLineasOrden(hacer(MAX_LINEAS_ORDEN + 1))
  assert.ok(!r.ok && r.codigo === 'DEMASIADAS_LINEAS')
  assert.ok(!validarLineasOrden(hacer(11), 10).ok)
})

test('el valor es EXACTO (enteros, no flotantes): 3 × 0.1 es 0.3 y 200 líneas de 999999.9999 no pierden un diezmilésimo', () => {
  const r = validarLineasOrden([{ varianteId: 'a', cantidad: 3, costo: '0.1' }])
  assert.ok(r.ok)
  assert.equal(r.valor, c('0.3'))
  const grande = validarLineasOrden(Array.from({ length: 200 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1_000_000, costo: '99999999.9999' })))
  assert.ok(grande.ok)
  assert.equal(grande.valor, BigInt(200) * BigInt(1_000_000) * c('99999999.9999'))
  assert.equal(grande.unidades, 200_000_000, 'cabe en el entero de 32 bits de la base')
})

test('fusionar líneas suma cantidades por producto (con tope) y conserva el costo de la primera', () => {
  const f = fusionarLineasOrden([
    { varianteId: 'a', cantidad: 2, costo: '5.0000' },
    { varianteId: 'b', cantidad: 1, costo: '1.0000' },
    { varianteId: 'a', cantidad: 3, costo: '9.0000' },
    { varianteId: 'b', cantidad: CANTIDAD_MAXIMA, costo: '1.0000' },
  ])
  assert.deepEqual(f, [
    { varianteId: 'a', cantidad: 5, costo: '5.0000' },
    { varianteId: 'b', cantidad: CANTIDAD_MAXIMA, costo: '1.0000' },
  ])
})

test('el costo para un campo no lleva ceros de relleno ni se come los significativos', () => {
  const casos: Array<[string, string]> = [
    ['5', '5'],
    ['5.0000', '5'],
    ['12.5', '12.5'],
    ['0', '0'],
    ['0.0525', '0.0525'],
    ['100', '100'],
    ['20.05', '20.05'],
    ['1000000', '1000000'],
    ['100000000', '100000000'],
    ['0.0001', '0.0001'],
    ['10.1', '10.1'],
    ['100.01', '100.01'],
  ]
  for (const [entrada, esperado] of casos) assert.equal(costoParaCampo(c(entrada)), esperado, entrada)
  // Y vuelve al mismo valor.
  for (const [entrada] of casos) assert.equal(c(costoParaCampo(c(entrada))), c(entrada))
})

// ── Lo que va llegando ───────────────────────────────────────────────────────

const orden = (...x: Array<[string, number, number, number]>): LineaDeOrden[] => x.map(([varianteId, pedido, recibido, cancelado]) => ({ varianteId, pedido, recibido, cancelado }))

test('pendiente y resumen: lo pedido menos lo recibido menos lo cerrado como faltante', () => {
  const l = orden(['a', 10, 4, 0], ['b', 5, 5, 0], ['c', 8, 2, 3])
  assert.deepEqual(l.map(pendienteDeOrden), [6, 0, 3])
  assert.deepEqual(resumirOrden(l), { pedidas: 23, recibidas: 11, canceladas: 3, pendientes: 9 })
  assert.deepEqual(resumirOrden([]), { pedidas: 0, recibidas: 0, canceladas: 0, pendientes: 0 })
})

test('recibir todo lo que falta cierra la orden sola, sin pedir motivo', () => {
  const l = orden(['a', 10, 4, 0], ['b', 5, 0, 0])
  const p = planDeRecepcionOrden(l, 'TODO', false, null)
  assert.ok(p.ok)
  assert.deepEqual(p.recibir, [{ varianteId: 'a', cantidad: 6 }, { varianteId: 'b', cantidad: 5 }])
  assert.deepEqual([p.cerrar, p.estadoFinal, p.pendienteDespues], [[], 'RECEIVED', 0])
  const explicito = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 6 }, { varianteId: 'b', cantidad: 5 }], false, null)
  assert.ok(explicito.ok && explicito.estadoFinal === 'RECEIVED')
})

test('recibir una parte deja la orden «recibida en parte» y dice cuánto falta', () => {
  const l = orden(['a', 10, 0, 0], ['b', 5, 0, 0])
  const p = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 3 }], false, null)
  assert.ok(p.ok)
  assert.deepEqual([p.recibir, p.cerrar, p.estadoFinal, p.pendienteDespues], [[{ varianteId: 'a', cantidad: 3 }], [], 'PARTIAL', 12])
  // Recibir 0 de una línea es no tocarla; las demás cuentan.
  const cero = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 0 }, { varianteId: 'b', cantidad: 5 }], false, null)
  assert.ok(cero.ok)
  assert.deepEqual(cero.recibir, [{ varianteId: 'b', cantidad: 5 }])
})

test('NO se recibe más de lo pedido: el mensaje dice cuánto falta y qué hacer con lo de sobra', () => {
  const l = orden(['a', 10, 7, 0], ['b', 5, 5, 0], ['c', 6, 2, 3])
  const mas = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 4 }], false, null)
  assert.ok(!mas.ok && mas.codigo === 'RECIBE_MAS_DE_LO_PEDIDO')
  assert.match(mas.error, /Solo faltan 3 por llegar/)
  assert.match(mas.error, /entrada aparte/)
  const completa = planDeRecepcionOrden(l, [{ varianteId: 'b', cantidad: 1 }], false, null)
  assert.ok(!completa.ok && completa.codigo === 'RECIBE_MAS_DE_LO_PEDIDO')
  assert.match(completa.error, /ya llegó completo/)
  // Lo cerrado como faltante tampoco se puede recibir después: de «c» solo falta 1.
  const cerrada = planDeRecepcionOrden(l, [{ varianteId: 'c', cantidad: 2 }], false, null)
  assert.ok(!cerrada.ok && cerrada.codigo === 'RECIBE_MAS_DE_LO_PEDIDO')
  assert.ok(planDeRecepcionOrden(l, [{ varianteId: 'c', cantidad: 1 }], false, null).ok)
})

test('una recepción mal formada se rechaza: producto ajeno, repetido, cantidad inválida o nada', () => {
  const l = orden(['a', 10, 0, 0])
  const cod = (p: Parameters<typeof planDeRecepcionOrden>[1], cerrar = false, motivo: string | null = null) => {
    const r = planDeRecepcionOrden(l, p, cerrar, motivo)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(cod([{ varianteId: 'z', cantidad: 1 }]), 'LINEA_AJENA')
  assert.equal(cod([{ varianteId: 'a', cantidad: 1 }, { varianteId: 'a', cantidad: 1 }]), 'LINEA_REPETIDA')
  for (const q of [-1, 1.5, Number.NaN, CANTIDAD_MAXIMA + 1]) assert.equal(cod([{ varianteId: 'a', cantidad: q }]), 'CANTIDAD_INVALIDA', String(q))
  assert.equal(cod([]), 'SIN_CANTIDADES')
  assert.equal(cod([{ varianteId: 'a', cantidad: 0 }]), 'SIN_CANTIDADES')
  assert.equal(cod('TODO'), 'OK')
  assert.equal(planDeRecepcionOrden(orden(['a', 5, 5, 0]), 'TODO', false, null).ok, false, 'no queda nada por recibir')
  const nada = planDeRecepcionOrden(orden(['a', 5, 5, 0]), [], true, 'cerrar lo que no existe')
  assert.ok(!nada.ok && nada.codigo === 'SIN_CANTIDADES', 'tampoco se «cierra» una orden a la que no le queda nada')
})

test('cerrar con faltante: exige motivo, cierra lo que falta línea por línea y nunca sin que haya llegado algo', () => {
  const l = orden(['a', 10, 0, 0], ['b', 6, 2, 0])
  const sinMotivo = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 4 }], true, null)
  assert.ok(!sinMotivo.ok && sinMotivo.codigo === 'MOTIVO_OBLIGATORIO')
  const vacio = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 4 }], true, '   ')
  assert.ok(!vacio.ok && vacio.codigo === 'MOTIVO_OBLIGATORIO')
  const ok = planDeRecepcionOrden(l, [{ varianteId: 'a', cantidad: 4 }], true, 'No hay existencias')
  assert.ok(ok.ok)
  assert.deepEqual(ok.recibir, [{ varianteId: 'a', cantidad: 4 }])
  assert.deepEqual(ok.cerrar, [{ varianteId: 'a', cantidad: 6 }, { varianteId: 'b', cantidad: 4 }])
  assert.deepEqual([ok.estadoFinal, ok.pendienteDespues], ['RECEIVED', 0])
  // Cerrar una orden PARCIAL sin recibir nada nuevo es válido (ya llegó algo).
  const parcial = planDeRecepcionOrden(l, [], true, 'Ya no lo mandan')
  assert.ok(parcial.ok)
  assert.deepEqual(parcial.recibir, [])
  assert.deepEqual(parcial.cerrar, [{ varianteId: 'a', cantidad: 10 }, { varianteId: 'b', cantidad: 4 }])
  // Pero si NO ha llegado nada en toda la orden, eso es cancelar.
  const nada = planDeRecepcionOrden(orden(['a', 10, 0, 0]), [], true, 'No llegó')
  assert.ok(!nada.ok && nada.codigo === 'NADA_RECIBIDO')
  assert.match(nada.error, /cancélala/)
  // Y no se pide motivo si no falta nada.
  const completo = planDeRecepcionOrden(orden(['a', 10, 0, 0]), [{ varianteId: 'a', cantidad: 10 }], true, null)
  assert.ok(completo.ok && completo.cerrar.length === 0 && completo.estadoFinal === 'RECEIVED')
})

test('PROPIEDAD: 2.000 recepciones al azar nunca pasan lo pedido, cuadran con el estado final y no pierden unidades', () => {
  let semilla = 12345
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  let cerradas = 0
  for (let iter = 0; iter < 2000; iter++) {
    const n = 1 + Math.floor(azar() * 4)
    let lineas: LineaDeOrden[] = Array.from({ length: n }, (_, i) => ({ varianteId: `v${i}`, pedido: 1 + Math.floor(azar() * 20), recibido: 0, cancelado: 0 }))
    const pedido = lineas.reduce((s, l) => s + l.pedido, 0)
    for (let paso = 0; paso < 8; paso++) {
      const faltan = lineas.filter((l) => pendienteDeOrden(l) > 0)
      if (faltan.length === 0) break
      const cerrar = azar() < 0.2
      const pedidas = azar() < 0.2 ? ('TODO' as const) : faltan.filter(() => azar() < 0.7).map((l) => ({ varianteId: l.varianteId, cantidad: Math.floor(azar() * (pendienteDeOrden(l) + 1)) }))
      const p = planDeRecepcionOrden(lineas, pedidas, cerrar, cerrar ? 'motivo' : null)
      if (!p.ok) {
        assert.ok(['SIN_CANTIDADES', 'NADA_RECIBIDO'].includes(p.codigo), `rechazo inesperado ${p.codigo}`)
        continue
      }
      const rec = new Map(p.recibir.map((x) => [x.varianteId, x.cantidad]))
      const cer = new Map(p.cerrar.map((x) => [x.varianteId, x.cantidad]))
      lineas = lineas.map((l) => ({ ...l, recibido: l.recibido + (rec.get(l.varianteId) ?? 0), cancelado: l.cancelado + (cer.get(l.varianteId) ?? 0) }))
      for (const l of lineas) {
        assert.ok(l.recibido >= 0 && l.cancelado >= 0 && l.recibido + l.cancelado <= l.pedido, 'nunca pasa de lo pedido')
      }
      const r = resumirOrden(lineas)
      assert.equal(r.pendientes, p.pendienteDespues, 'lo que dice el plan es lo que queda')
      assert.equal(r.recibidas + r.canceladas + r.pendientes, pedido, 'las unidades cuadran')
      assert.equal(p.estadoFinal === 'RECEIVED', r.pendientes === 0, 'recibida si y solo si no queda nada')
      if (p.estadoFinal === 'RECEIVED') {
        assert.ok(r.recibidas > 0, 'una orden recibida recibió algo')
        cerradas++
        break
      }
    }
  }
  assert.ok(cerradas > 300, `la prueba debe cerrar órdenes de verdad (${cerradas})`)
})

// ── Cancelar ─────────────────────────────────────────────────────────────────

test('cancelar: el borrador se descarta sin motivo; la pedida lo exige; la parcial no se cancela; lo cerrado no cambia', () => {
  const v = (e: EstadoOrden, m?: unknown) => validarCancelacionDeOrden(e, m)
  const d = v('DRAFT')
  assert.ok(d.ok && d.motivo === null)
  const dm = v('DRAFT', '  Ya no hace   falta ')
  assert.ok(dm.ok && dm.motivo === 'Ya no hace falta')
  const sin = v('ORDERED')
  assert.ok(!sin.ok && sin.codigo === 'MOTIVO_OBLIGATORIO')
  const blanco = v('ORDERED', '   ')
  assert.ok(!blanco.ok && blanco.codigo === 'MOTIVO_OBLIGATORIO')
  const pedida = v('ORDERED', 'El proveedor cerró')
  assert.ok(pedida.ok && pedida.motivo === 'El proveedor cerró')
  const largo = v('ORDERED', 'm'.repeat(301))
  assert.ok(!largo.ok && largo.codigo === 'MOTIVO_INVALIDO')
  assert.ok(v('ORDERED', 'm'.repeat(300)).ok)
  const parcial = v('PARTIAL', 'quiero cancelar')
  assert.ok(!parcial.ok && parcial.codigo === 'ORDEN_CON_RECEPCIONES')
  assert.match(parcial.error, /faltante/)
  for (const e of ['RECEIVED', 'CANCELLED'] as const) {
    const r = v(e, 'tarde')
    assert.ok(!r.ok && r.codigo === 'ORDEN_CERRADA', e)
  }
  // Cada transición permitida hacia CANCELLED es una que esta función acepta, y a la inversa.
  for (const e of ESTADOS) assert.equal(v(e, 'motivo').ok, puedePasarA(e, 'CANCELLED'), e)
})

// ── Valores ──────────────────────────────────────────────────────────────────

test('el valor pedido y el pendiente se calculan con los costos de cada línea', () => {
  const lineas = [
    { varianteId: 'a', pedido: 10, recibido: 4, cancelado: 0, costo: c('5') },
    { varianteId: 'b', pedido: 3, recibido: 0, cancelado: 1, costo: c('12.5') },
  ]
  assert.equal(valorPedido(lineas), c('50') + c('37.5'))
  assert.equal(valorPendiente(lineas), c('30') + c('25'))
  assert.equal(valorPedido([]), BigInt(0))
})

// ── Filtros de la lista ──────────────────────────────────────────────────────

test('los filtros de la lista de órdenes se leen de la URL con las mismas reglas y vuelven a la misma URL', () => {
  const { filtros, cursor } = leerFiltrosOrdenes({ q: ' OC-2026 ', proveedor: 'prov1', sucursal: 'suc1', estado: 'PARTIAL', desde: '2026-10-05', hasta: '2026-10-01', cursor: 'no-es-un-cursor' })
  assert.deepEqual(filtros, { q: 'OC-2026', proveedorId: 'prov1', sucursalId: 'suc1', estado: 'PARTIAL', desde: '2026-10-01', hasta: '2026-10-05' })
  assert.equal(cursor, null, 'un cursor inventado se ignora')
  const consulta = consultaDeFiltrosOrdenes(filtros)
  const p = new URLSearchParams(consulta)
  assert.equal(p.get('estado'), 'PARTIAL')
  assert.equal(p.get('proveedor'), 'prov1')
  assert.equal(p.get('sucursal'), 'suc1')
  assert.deepEqual(leerFiltrosOrdenes(Object.fromEntries(p)).filtros, filtros)
  assert.equal(consultaDeFiltrosOrdenes({}), '')
  assert.ok(consultaDeFiltrosOrdenes({}, '2026-10-01T00:00:00.000Z|abc').includes('cursor='))
})

test('un estado, un proveedor o una fecha inventados en la URL no filtran nada', () => {
  assert.deepEqual(leerFiltrosOrdenes({ estado: 'SENT' }).filtros, {})
  assert.deepEqual(leerFiltrosOrdenes({ estado: 'draft' }).filtros, {})
  assert.deepEqual(leerFiltrosOrdenes({ proveedor: 'con espacio' }).filtros, {})
  assert.deepEqual(leerFiltrosOrdenes({ proveedor: 'x'.repeat(200) }).filtros, {})
  assert.deepEqual(leerFiltrosOrdenes({ desde: '2026-02-31', hasta: 'ayer' }).filtros, {})
  assert.deepEqual(leerFiltrosOrdenes({ estado: ['RECEIVED', 'DRAFT'] }).filtros, { estado: 'RECEIVED' }, 'si viene repetido manda el primero')
  for (const e of ESTADOS) assert.deepEqual(leerFiltrosOrdenes({ estado: e }).filtros, { estado: e })
})

// ── CSV ──────────────────────────────────────────────────────────────────────

const ORDEN_CSV: OrdenParaCsv = {
  numero: 'OC-2026-000007',
  estado: 'RECEIVED',
  proveedorNombre: '=HYPERLINK("http://malo")',
  sucursalNombre: 'Principal',
  referencia: '+cotización',
  nota: null,
  creadoEn: new Date('2026-10-01T15:00:00Z'),
  pedidoEn: new Date('2026-10-01T15:05:00Z'),
  previstaEn: new Date('2026-10-09T00:00:00Z'),
  cerradoEn: new Date('2026-10-10T20:00:00Z'),
  creadoPorNombre: 'Ana',
  pedidoPorNombre: 'Ana',
  cerradoPorNombre: '@Luis',
  motivoCierre: '-no llegó',
  valor: '1,250.50',
  valorRecibido: '1,000.00',
  valorPendiente: '0.00',
  detalle: [
    { sku: 'A-1', barcode: null, itemNombre: 'Aceite', nombreVariante: '1 L', esDefault: false, pedido: 10, recibido: 8, cancelado: 2, pendiente: 0, costo: '1,250.50', valor: '12,505.00' },
    { sku: '=SUMA(1)', barcode: '7501', itemNombre: 'Sal', nombreVariante: 'Única', esDefault: true, pedido: 5, recibido: 5, cancelado: 0, pendiente: 0, costo: '2.00', valor: '10.00' },
  ],
  entradas: [{ numero: 'ENT-2026-000010', creadoEn: new Date('2026-10-05T14:00:00Z'), referencia: 'FAC-1', unidades: 13, usuarioNombre: 'Luis' }],
}

test('el CSV de una orden: bloques de resumen, líneas y entradas; montos planos que Excel suma; textos libres sin fórmulas', () => {
  const csv = ordenToCsv(ORDEN_CSV, 'America/Santo_Domingo')
  assert.ok(csv.startsWith('﻿'), 'con BOM para que Excel lea los acentos')
  for (const bloque of ['Orden de compra', 'Líneas', 'Entradas de mercancía']) assert.match(csv, new RegExp(`^\\uFEFF?${bloque}$`, 'm'))
  assert.match(csv, /Valor pedido;1250\.50/, 'sin separador de miles')
  assert.match(csv, /Aceite · 1 L;1250\.50;10;8;2;0;12505\.00/)
  assert.match(csv, /Sal;2\.00;5;5;0;0;10\.00/, 'el producto por defecto no repite la variante')
  assert.match(csv, /Fecha prevista;2026-10-09/, 'la fecha prevista es un día, no un instante en la zona de la empresa')
  assert.match(csv, /ENT-2026-000010;/)
  // Nada que Excel evalúe: los textos libres que empiezan por = + - @ llevan apóstrofo delante.
  for (const peligroso of ['=HYPERLINK', '+cotización', '@Luis', '-no llegó', '=SUMA(1)']) {
    assert.ok(!new RegExp(`(^|;)"?${peligroso.replace(/[()+]/g, '\\$&')}`, 'm').test(csv), `«${peligroso}» no debe quedar sin neutralizar`)
    assert.ok(csv.includes(`'${peligroso}`), `«${peligroso}» debe llevar apóstrofo`)
  }
  assert.match(csv, /Unidades pedidas;15/)
  assert.match(csv, /Unidades recibidas;13/)
  assert.match(csv, /Unidades cerradas como faltante;2/)
  assert.match(csv, /Unidades por llegar;0/)
})

test('el CSV de una orden sin entradas ni cierre sale completo, con vacíos donde no hay dato', () => {
  const csv = ordenToCsv(
    { ...ORDEN_CSV, estado: 'DRAFT', pedidoEn: null, previstaEn: null, cerradoEn: null, pedidoPorNombre: null, cerradoPorNombre: null, motivoCierre: null, entradas: [], detalle: [{ ...ORDEN_CSV.detalle[1], recibido: 0, pendiente: 5 }] },
    'America/Santo_Domingo'
  )
  assert.match(csv, /Estado;Borrador/)
  assert.match(csv, /^Pedida;$/m)
  assert.match(csv, /^Fecha prevista;$/m)
  assert.match(csv, /^Cerrada;$/m)
  assert.match(csv, /^Entradas de mercancía$/m)
})
