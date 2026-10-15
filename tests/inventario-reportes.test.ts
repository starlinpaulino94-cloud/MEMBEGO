import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAS_EXCESO_COBERTURA,
  DIAS_POCA_COBERTURA,
  ESTADOS_COBERTURA,
  ETIQUETA_ESTADO_COBERTURA,
  PERIODOS_DIAS,
  PERIODO_POR_DEFECTO,
  armarKardex,
  calcularRotacion,
  compararCobertura,
  corteDeDias,
  describirCambioDeCubeta,
  diasDeInventario,
  diasDesde,
  efectoFisico,
  esEstadoCobertura,
  periodoValido,
  sentidoDeMovimiento,
  textoHace,
  type Cubeta,
  type EstadoCobertura,
  type MovimientoParaKardex,
} from '../src/modules/inventory/reportes'
import { parsearCosto, type Costo } from '../src/modules/inventory/costos'
import {
  consultaDeFiltrosKardex,
  consultaDeFiltrosRotacion,
  consultaDeFiltrosSinVentas,
  leerFiltrosKardex,
  leerFiltrosRotacion,
  leerFiltrosSinVentas,
} from '../src/modules/inventory/filtros'
import { kardexToCsv, rotacionToCsv, sinVentasToCsv } from '../src/modules/inventory/exportacion'
import type { KardexVista, RotacionVista, SinVentasVista } from '../src/modules/inventory/reportes-queries'

const c = (t: string): Costo => {
  const r = parsearCosto(t)
  assert.ok(r.ok, `«${t}» debía ser un costo válido`)
  return r.valor
}

// ── Efecto sobre la existencia física ────────────────────────────────────────

const CUBETAS: Array<Cubeta | null> = [null, 'AVAILABLE', 'RESERVED', 'DAMAGED']

test('la existencia física solo cambia si algo entra desde fuera o sale del inventario; pasar de una cubeta a otra no la cambia', () => {
  for (const origen of CUBETAS) {
    for (const destino of CUBETAS) {
      const esperado = origen === null && destino !== null ? 7 : origen !== null && destino === null ? -7 : 0
      assert.equal(efectoFisico({ cantidad: 7, origen, destino }), esperado, `${origen} → ${destino}`)
      const sentido = origen === null && destino !== null ? 'ENTRA' : origen !== null && destino === null ? 'SALE' : 'INTERNO'
      assert.equal(sentidoDeMovimiento({ origen, destino }), sentido, `${origen} → ${destino}`)
    }
  }
})

test('los movimientos reales del ledger caen donde deben: entrada, venta, daño, baja y apartar', () => {
  assert.equal(efectoFisico({ cantidad: 5, origen: null, destino: 'AVAILABLE' }), 5, 'entrada de mercancía')
  assert.equal(efectoFisico({ cantidad: 2, origen: 'AVAILABLE', destino: null }), -2, 'venta directa')
  assert.equal(efectoFisico({ cantidad: 2, origen: 'RESERVED', destino: null }), -2, 'venta de lo apartado')
  assert.equal(efectoFisico({ cantidad: 3, origen: 'AVAILABLE', destino: 'DAMAGED' }), 0, 'dañar: sigue en la sucursal')
  assert.equal(efectoFisico({ cantidad: 3, origen: 'DAMAGED', destino: null }), -3, 'dar de baja lo dañado: sale')
  assert.equal(efectoFisico({ cantidad: 3, origen: 'DAMAGED', destino: 'AVAILABLE' }), 0, 'recuperar lo dañado')
  assert.equal(efectoFisico({ cantidad: 4, origen: 'AVAILABLE', destino: 'RESERVED' }), 0, 'apartar')
})

test('describirCambioDeCubeta dice de dónde a dónde, y nada si el movimiento entra o sale', () => {
  assert.equal(describirCambioDeCubeta({ origen: 'AVAILABLE', destino: 'DAMAGED' }), 'de vendible a dañado')
  assert.equal(describirCambioDeCubeta({ origen: 'DAMAGED', destino: 'AVAILABLE' }), 'de dañado a vendible')
  assert.equal(describirCambioDeCubeta({ origen: 'AVAILABLE', destino: 'RESERVED' }), 'de vendible a apartado')
  assert.equal(describirCambioDeCubeta({ origen: null, destino: 'AVAILABLE' }), null)
  assert.equal(describirCambioDeCubeta({ origen: 'AVAILABLE', destino: null }), null)
  assert.equal(describirCambioDeCubeta({ origen: null, destino: null }), null)
})

// ── Kardex ───────────────────────────────────────────────────────────────────

let n = 0
const mov = (o: Partial<MovimientoParaKardex> & Pick<MovimientoParaKardex, 'origen' | 'destino' | 'cantidad'>): MovimientoParaKardex => ({
  id: `m${++n}`,
  creadoEn: new Date(Date.UTC(2026, 9, 1, 12, n)),
  sucursalId: 's1',
  sucursalNombre: 'Principal',
  tipo: 'PURCHASE',
  motivo: null,
  referenciaTipo: null,
  referenciaId: null,
  usuarioNombre: null,
  costo: null,
  ...o,
})

test('armarKardex: cada fila deja el saldo físico, y el cierre es la apertura más lo que entró menos lo que salió', () => {
  const k = armarKardex(
    10,
    [
      mov({ tipo: 'PURCHASE', origen: null, destino: 'AVAILABLE', cantidad: 20, costo: c('5') }),
      mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 8, costo: c('5') }),
      mov({ tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: 2, costo: c('5') }),
      mov({ tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: null, cantidad: 2, costo: c('5') }),
      mov({ tipo: 'RETURN', origen: null, destino: 'AVAILABLE', cantidad: 1, costo: c('5') }),
    ],
    true
  )
  assert.deepEqual(k.filas.map((f) => f.saldo), [30, 22, 22, 20, 21])
  assert.deepEqual(k.filas.map((f) => [f.entra, f.sale]), [[20, 0], [0, 8], [0, 0], [0, 2], [1, 0]])
  assert.deepEqual(k.filas.map((f) => f.sentido), ['ENTRA', 'SALE', 'INTERNO', 'SALE', 'ENTRA'])
  assert.equal(k.saldoFinal, 21)
  assert.equal(k.saldoFinal, 10 + k.totales.entradas - k.totales.salidas)
  assert.deepEqual([k.totales.entradas, k.totales.salidas], [21, 10])
})

test('armarKardex: valora lo que entra y lo que sale, no lo que solo cambia de cubeta, y cuenta aparte lo que no tiene costo', () => {
  const k = armarKardex(
    0,
    [
      mov({ origen: null, destino: 'AVAILABLE', cantidad: 10, costo: c('4.5') }),
      mov({ origen: null, destino: 'AVAILABLE', cantidad: 6, costo: null }),
      mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 4, costo: c('4.7') }),
      mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 3, costo: null }),
      mov({ tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: 2, costo: c('4.7') }),
    ],
    true
  )
  assert.deepEqual(k.filas.map((f) => f.valor), [c('45'), null, c('18.8'), null, null])
  assert.equal(k.totales.valorEntradas, c('45'))
  assert.equal(k.totales.valorSalidas, c('18.8'))
  assert.equal(k.totales.entradasSinCosto, 6)
  assert.equal(k.totales.salidasSinCosto, 3)
  assert.equal(k.saldoFinal, 9)
})

test('armarKardex sin permiso de costos: ninguna fila ni total lleva costo, y tampoco se cuenta lo que falta', () => {
  const k = armarKardex(
    5,
    [mov({ origen: null, destino: 'AVAILABLE', cantidad: 10, costo: c('4') }), mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 3, costo: null })],
    false
  )
  for (const f of k.filas) assert.deepEqual([f.costo, f.valor], [null, null])
  assert.deepEqual(k.totales, { entradas: 10, salidas: 3, valorEntradas: BigInt(0), valorSalidas: BigInt(0), entradasSinCosto: 0, salidasSinCosto: 0 })
  assert.equal(k.saldoFinal, 12)
})

test('armarKardex: sin movimientos el saldo es la apertura, y las filas conservan sus datos', () => {
  const vacio = armarKardex(7, [], true)
  assert.deepEqual([vacio.filas.length, vacio.saldoFinal, vacio.totales.entradas, vacio.totales.salidas], [0, 7, 0, 0])
  const m = mov({ tipo: 'SALE', origen: 'RESERVED', destino: null, cantidad: 1, motivo: 'x', referenciaTipo: 'ORDER', referenciaId: 'o1', usuarioNombre: 'Ana', sucursalId: 's9', sucursalNombre: 'Norte' })
  const [f] = armarKardex(1, [m], true).filas
  assert.deepEqual([f.id, f.tipo, f.motivo, f.referenciaTipo, f.referenciaId, f.usuarioNombre, f.sucursalId, f.sucursalNombre], [m.id, 'SALE', 'x', 'ORDER', 'o1', 'Ana', 's9', 'Norte'])
  assert.equal(f.saldo, 0)
})

test('armarKardex: una propiedad al azar — el saldo final siempre es apertura + entradas − salidas, y cada saldo es el anterior más el efecto', () => {
  let semilla = 12345
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
    return semilla / 0x7fffffff
  }
  for (let ronda = 0; ronda < 200; ronda++) {
    const apertura = Math.floor(azar() * 50)
    const movs: MovimientoParaKardex[] = []
    for (let i = 0, total = Math.floor(azar() * 12); i < total; i++) {
      const o = CUBETAS[Math.floor(azar() * 4)]
      const d = CUBETAS[Math.floor(azar() * 4)]
      movs.push(mov({ origen: o, destino: d, cantidad: 1 + Math.floor(azar() * 9), costo: azar() < 0.5 ? c(String(1 + Math.floor(azar() * 20))) : null }))
    }
    const k = armarKardex(apertura, movs, azar() < 0.5)
    let esperado = apertura
    k.filas.forEach((f, i) => {
      esperado += efectoFisico(movs[i])
      assert.equal(f.saldo, esperado)
    })
    assert.equal(k.saldoFinal, apertura + k.totales.entradas - k.totales.salidas)
  }
})

// ── Periodos ─────────────────────────────────────────────────────────────────

test('periodoValido: solo los periodos que hay; cualquier otra cosa vuelve a 90', () => {
  assert.deepEqual([...PERIODOS_DIAS], [30, 60, 90, 180, 365])
  assert.equal(PERIODO_POR_DEFECTO, 90)
  for (const p of PERIODOS_DIAS) {
    assert.equal(periodoValido(p), p)
    assert.equal(periodoValido(String(p)), p)
    assert.equal(periodoValido(` ${p} `), p)
  }
  for (const mal of [0, 1, 45, 91, 366, -30, 30.5, 'x', '', null, undefined, {}, [30], Number.NaN, Infinity]) assert.equal(periodoValido(mal), 90, String(mal))
})

test('corteDeDias resta los días exactos y diasDesde cuenta días completos (null si nunca)', () => {
  const ahora = new Date('2026-10-15T12:00:00Z')
  assert.equal(corteDeDias(ahora, 30).toISOString(), '2026-09-15T12:00:00.000Z')
  assert.equal(corteDeDias(ahora, 1).toISOString(), '2026-10-14T12:00:00.000Z')
  assert.equal(diasDesde(null, ahora), null)
  assert.equal(diasDesde(new Date('2026-10-15T11:59:00Z'), ahora), 0)
  assert.equal(diasDesde(new Date('2026-10-14T12:00:00Z'), ahora), 1)
  assert.equal(diasDesde(new Date('2026-10-14T12:01:00Z'), ahora), 0, 'menos de 24 horas es hoy')
  assert.equal(diasDesde(new Date('2026-09-15T12:00:00Z'), ahora), 30)
  assert.equal(diasDesde(new Date('2026-10-16T12:00:00Z'), ahora), 0, 'una fecha del futuro no da días negativos')
})

test('textoHace: nunca, hoy, 1 día y N días', () => {
  assert.equal(textoHace(null), 'Nunca')
  assert.equal(textoHace(0), 'Hoy')
  assert.equal(textoHace(1), 'Hace 1 día')
  assert.equal(textoHace(2), 'Hace 2 días')
  assert.equal(textoHace(400), 'Hace 400 días')
})

// ── Rotación y cobertura ─────────────────────────────────────────────────────

const rot = (o: Partial<Parameters<typeof calcularRotacion>[0]> = {}) => calcularRotacion({ vendidas: 30, existenciaInicial: 40, existenciaFinal: 20, disponible: 20, dias: 30, ...o })

test('calcularRotacion: venta diaria, existencia promedio, veces y cobertura', () => {
  const r = rot()
  assert.equal(r.vendidas, 30)
  assert.equal(r.ventaDiaria, 1)
  assert.equal(r.existenciaPromedio, 30)
  assert.equal(r.veces, 1)
  assert.equal(r.coberturaDias, 20, '20 disponibles a 1 por día')
  assert.equal(r.estado, 'NORMAL')
  const rapida = rot({ vendidas: 90, existenciaInicial: 10, existenciaFinal: 20, disponible: 20, dias: 30 })
  assert.equal(rapida.veces, 6, '90 vendidas sobre un promedio de 15')
  assert.equal(rapida.ventaDiaria, 3)
  assert.equal(rapida.coberturaDias, 20 / 3)
})

test('calcularRotacion: sin ventas no hay cobertura ni urgencia, y lo vendido en negativo se toma como cero', () => {
  for (const vendidas of [0, -5]) {
    const r = rot({ vendidas })
    assert.deepEqual([r.vendidas, r.ventaDiaria, r.coberturaDias, r.estado], [0, 0, null, 'SIN_VENTAS'])
    assert.equal(r.veces, 0, 'con existencia y sin ventas, rotó 0 veces')
  }
  const sinExistencia = rot({ vendidas: 0, existenciaInicial: 0, existenciaFinal: 0, disponible: 0 })
  assert.equal(sinExistencia.veces, null, 'sin existencia promedio la rotación no está definida')
  assert.equal(sinExistencia.estado, 'SIN_VENTAS')
})

test('calcularRotacion: una existencia inicial o final negativa (un descuadre) no se cuela', () => {
  const r = rot({ existenciaInicial: -10, existenciaFinal: 20 })
  assert.equal(r.existenciaPromedio, 10)
  const t = rot({ existenciaInicial: -10, existenciaFinal: -20, disponible: -4 })
  assert.equal(t.existenciaPromedio, 0)
  assert.equal(t.veces, null)
  assert.equal(t.estado, 'AGOTADO', 'un disponible negativo cuenta como cero')
})

test('calcularRotacion: los estados cambian justo en sus límites', () => {
  const con = (disponible: number) => rot({ vendidas: 30, dias: 30, disponible }).estado // 1 por día: la cobertura es el disponible
  assert.equal(con(0), 'AGOTADO')
  assert.equal(con(1), 'POCA')
  assert.equal(con(DIAS_POCA_COBERTURA), 'POCA', '14 días: todavía se agota pronto')
  assert.equal(con(DIAS_POCA_COBERTURA + 1), 'NORMAL')
  assert.equal(con(DIAS_EXCESO_COBERTURA), 'NORMAL', '180 días: todavía normal')
  assert.equal(con(DIAS_EXCESO_COBERTURA + 1), 'EXCESO')
  assert.equal(DIAS_POCA_COBERTURA, 14)
  assert.equal(DIAS_EXCESO_COBERTURA, 180)
  // Agotado sin ventas no es «agotado con ventas».
  assert.equal(rot({ vendidas: 0, disponible: 0 }).estado, 'SIN_VENTAS')
})

test('compararCobertura: lo más urgente primero y lo que no vende al final', () => {
  const urgente = rot({ vendidas: 30, dias: 30, disponible: 2 })
  const normal = rot({ vendidas: 30, dias: 30, disponible: 40 })
  const exceso = rot({ vendidas: 30, dias: 30, disponible: 400 })
  const nada = rot({ vendidas: 0 })
  const ordenados = [nada, exceso, normal, urgente].sort(compararCobertura)
  assert.deepEqual(ordenados.map((r) => r.estado), ['POCA', 'NORMAL', 'EXCESO', 'SIN_VENTAS'])
  assert.equal(compararCobertura(nada, rot({ vendidas: 0 })), 0)
  assert.ok(compararCobertura(urgente, nada) < 0)
  assert.ok(compararCobertura(nada, urgente) > 0)
})

test('los estados de cobertura tienen su etiqueta y solo ellos se reconocen', () => {
  assert.deepEqual([...ESTADOS_COBERTURA].sort(), ['AGOTADO', 'EXCESO', 'NORMAL', 'POCA', 'SIN_VENTAS'])
  for (const e of ESTADOS_COBERTURA) {
    assert.ok(ETIQUETA_ESTADO_COBERTURA[e].length > 0)
    assert.equal(esEstadoCobertura(e), true)
  }
  for (const mal of ['agotado', 'SENT', '', null, undefined, 3, {}]) assert.equal(esEstadoCobertura(mal), false, String(mal))
  const _tipado: EstadoCobertura = 'NORMAL'
  assert.equal(_tipado, 'NORMAL')
})

// ── Días de inventario ───────────────────────────────────────────────────────

test('diasDeInventario: el valor entre lo que cuesta vender un día; sin costo de ventas no se mide', () => {
  // 3.000 de inventario, 900 de costo de ventas en 30 días → 30 por día → 100 días.
  assert.equal(diasDeInventario(c('3000'), c('900'), 30), 100)
  assert.equal(diasDeInventario(c('0'), c('900'), 30), 0, 'sin inventario, cero días')
  assert.equal(diasDeInventario(c('3000'), c('0'), 30), null)
  assert.equal(diasDeInventario(c('3000'), BigInt(0) - c('5'), 30), null, 'un costo de ventas negativo tampoco mide nada')
  // Redondea la mitad hacia arriba: 1000 × 30 / 600 = 50 exacto; 1001 × 30 / 600 = 50.05 → 50; 1010 × 30 / 600 = 50.5 → 51.
  assert.equal(diasDeInventario(c('1000'), c('600'), 30), 50)
  assert.equal(diasDeInventario(c('1001'), c('600'), 30), 50)
  assert.equal(diasDeInventario(c('1010'), c('600'), 30), 51)
  assert.equal(diasDeInventario(c('1009.99'), c('600'), 30), 50)
  // Cambia con el periodo medido.
  assert.equal(diasDeInventario(c('3000'), c('900'), 90), 300)
})

// ── Filtros de la URL ────────────────────────────────────────────────────────

test('leerFiltrosSinVentas / leerFiltrosRotacion: solo los periodos que hay, página válida, estado conocido; lo demás se ignora', () => {
  assert.deepEqual(leerFiltrosSinVentas({}), { dias: PERIODO_POR_DEFECTO, pagina: 1 })
  assert.deepEqual(leerFiltrosSinVentas({ dias: '30', sucursal: 'suc1', q: '  harina ', pagina: '3' }), { dias: 30, sucursalId: 'suc1', q: 'harina', pagina: 3 })
  for (const mal of ['7', '-30', '30.5', 'abc', '', '99999']) assert.equal(leerFiltrosSinVentas({ dias: mal }).dias, PERIODO_POR_DEFECTO, `dias=${mal}`)
  for (const mal of ['0', '-1', '1.5', 'x', '2001', '9'.repeat(30)]) assert.equal(leerFiltrosSinVentas({ pagina: mal }).pagina, 1, `pagina=${mal}`)
  assert.equal(leerFiltrosSinVentas({ pagina: '2000' }).pagina, 2000)
  const r = leerFiltrosRotacion({ dias: '180', estado: 'POCA', pagina: '2' })
  assert.deepEqual(r, { dias: 180, estado: 'POCA', pagina: 2 })
  for (const mal of ['poca', 'DROP', '', 'constructor', '__proto__']) assert.equal(leerFiltrosRotacion({ estado: mal }).estado, undefined, `estado=${mal}`)
  // Un valor repetido en la URL (?dias=30&dias=60) lee el primero, igual que la pantalla.
  assert.equal(leerFiltrosSinVentas({ dias: ['60', '30'] }).dias, 60)
})

test('consultaDeFiltros…: lo que es de siempre (90 días, página 1) no ensucia la URL, y leerla de vuelta da lo mismo', () => {
  assert.equal(consultaDeFiltrosSinVentas({ dias: 90, pagina: 1 }), '')
  assert.equal(consultaDeFiltrosRotacion({ dias: 90, pagina: 1 }), '')
  assert.equal(consultaDeFiltrosSinVentas({ dias: 30, sucursalId: 's1', q: 'a b', pagina: 1 }), 'dias=30&sucursal=s1&q=a+b')
  assert.equal(consultaDeFiltrosSinVentas({ dias: 30, pagina: 1 }, 4), 'dias=30&pagina=4', 'otra página sin tocar los filtros')
  const rotacion = { dias: 365, sucursalId: 's9', q: 'café', estado: 'EXCESO' as const, pagina: 3 }
  const redondo = leerFiltrosRotacion(Object.fromEntries(new URLSearchParams(consultaDeFiltrosRotacion(rotacion))))
  assert.deepEqual(redondo, rotacion)
  const sin = { dias: 60, sucursalId: 's2', q: 'x&y=z', pagina: 5 }
  assert.deepEqual(leerFiltrosSinVentas(Object.fromEntries(new URLSearchParams(consultaDeFiltrosSinVentas(sin)))), sin, 'un texto con & o = no se cuela como otro parámetro')
})

test('leerFiltrosKardex: el producto, la sucursal, las fechas (un rango al revés se endereza) y el texto; un id con basura no pasa', () => {
  assert.deepEqual(leerFiltrosKardex({}), {})
  const f = leerFiltrosKardex({ variante: 'var1', sucursal: 'suc1', desde: '2026-10-01', hasta: '2026-10-15', q: ' sal ' })
  assert.deepEqual(f, { varianteId: 'var1', sucursalId: 'suc1', desde: '2026-10-01', hasta: '2026-10-15', q: 'sal' })
  const alReves = leerFiltrosKardex({ desde: '2026-10-15', hasta: '2026-10-01' })
  assert.ok(alReves.desde && alReves.hasta && alReves.desde <= alReves.hasta, 'desde nunca va después de hasta')
  assert.equal(leerFiltrosKardex({ desde: 'ayer' }).desde, undefined)
  assert.equal(leerFiltrosKardex({ variante: "x' OR '1'='1" }).varianteId, undefined)
  assert.equal(leerFiltrosKardex({ variante: 'a'.repeat(200) }).varianteId, undefined)
  const url = consultaDeFiltrosKardex(f)
  assert.deepEqual(leerFiltrosKardex(Object.fromEntries(new URLSearchParams(url))), f)
})

// ── CSV ──────────────────────────────────────────────────────────────────────

const ZONA = 'America/Santo_Domingo'
const AHORA = new Date(Date.UTC(2026, 9, 15, 16, 0))

function kardexDePrueba(conCostos: boolean, truncado = false): KardexVista {
  const k = armarKardex(
    10,
    [
      mov({ origen: null, destino: 'AVAILABLE', cantidad: 10, costo: c('4.5'), motivo: '=HYPERLINK("http://x")', usuarioNombre: 'Ana', referenciaTipo: 'RECEIPT', referenciaId: 'rec12345678' }),
      mov({ origen: null, destino: 'AVAILABLE', cantidad: 6, costo: null }),
      mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 4, costo: c('4.7') }),
      mov({ tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED', cantidad: 2, costo: c('4.7') }),
    ],
    conCostos
  )
  return {
    variante: { id: 'v1', nombre: '+Sal · Fina', sku: '-SAL-1', barcode: null },
    sucursal: null,
    desde: '2026-10-01',
    hasta: '2026-10-15',
    apertura: 10,
    cierre: k.saldoFinal,
    filas: k.filas,
    totales: k.totales,
    truncado,
    conCostos,
  }
}

test('kardexToCsv con costos: resumen, valores sin separador de miles, lo que no tiene costo vacío (no cero) y nada que Excel evalúe', () => {
  const csv = kardexToCsv(kardexDePrueba(true), { zonaHoraria: ZONA, generadoEn: AHORA, tope: 20000 })
  assert.ok(csv.startsWith('\uFEFF'))
  assert.match(csv, /^"Existencia al empezar \(vendible, apartado y dañado\)";10$/m)
  assert.match(csv, /^Entradas;16$/m)
  assert.match(csv, /^Salidas;4$/m)
  assert.match(csv, /^Existencia al terminar;22$/m)
  assert.match(csv, /^Valor de las entradas \(solo las que tienen costo\);45\.00$/m)
  assert.match(csv, /^Valor de las salidas \(solo las que tienen costo\);18\.80$/m)
  assert.match(csv, /^Unidades que entraron SIN costo \(no suman al valor\);6$/m)
  assert.match(csv, /^Datos completos;Si$/m)
  assert.match(csv, /Fecha y hora;Sucursal;Movimiento;Entra;Sale;Saldo;Cambio de cubeta;Costo unitario;Valor;Motivo;Usuario;Referencia/)
  assert.match(csv, /Entrada de mercancía;10;0;20;;4\.50;45\.00;"'=HYPERLINK\(""http:\/\/x""\)";Ana;/, 'el motivo con fórmula queda entre comillas y con apóstrofo')
  assert.match(csv, /Entrada de mercancía;6;0;26;;;;/, 'sin costo conocido: costo y valor VACÍOS')
  assert.match(csv, /Venta;0;4;22;;4\.70;18\.80;/)
  assert.match(csv, /Daño;0;0;22;de vendible a dañado;;;/, 'dañar no entra ni sale: sin valor')
  assert.ok(csv.includes("'=HYPERLINK"), 'el motivo con fórmula queda neutralizado')
  assert.match(csv, /^Producto;'\+Sal · Fina$/m, 'el producto con = + - @ lleva apóstrofo en el resumen (no solo en el título)')
  assert.match(csv, /^SKU;'-SAL-1$/m, 'y el SKU también')
  assert.ok(!/(^|;)=HYPERLINK/m.test(csv))
})

test('kardexToCsv sin costos: no hay columnas ni totales de costo, ni la cuenta de lo que falta', () => {
  const csv = kardexToCsv(kardexDePrueba(false), { zonaHoraria: ZONA, generadoEn: AHORA, tope: 20000 })
  assert.doesNotMatch(csv, /Costo unitario|Valor de las|SIN costo|;Valor;/i)
  assert.match(csv, /Fecha y hora;Sucursal;Movimiento;Entra;Sale;Saldo;Cambio de cubeta;Motivo;Usuario;Referencia/)
  assert.match(csv, /^Entradas;16$/m)
})

test('kardexToCsv dice cuando el periodo quedó cortado', () => {
  const csv = kardexToCsv(kardexDePrueba(true, true), { zonaHoraria: ZONA, generadoEn: AHORA, tope: 20000 })
  assert.match(csv, /^Datos completos;"?NO - el archivo trae solo los primeros 20000 movimientos del periodo/m)
})

function sinVentasDePrueba(conCostos: boolean, total = 2): SinVentasVista {
  return {
    dias: 90,
    total,
    pagina: 1,
    porPagina: 20000,
    resumen: { saldos: total, unidades: 25, valor: conCostos ? c('125') : null, unidadesSinCosto: conCostos ? 5 : null },
    filas: [
      { nivelId: 'n1', varianteId: 'v1', itemId: 'i1', nombre: 'Cable', sku: 'CAB-1', sucursalId: 's1', sucursalNombre: 'Centro', sucursalActiva: true, existencia: 20, ultimaVenta: new Date(Date.UTC(2026, 6, 1, 15)), diasSinVender: 106, ultimaEntrada: new Date(Date.UTC(2026, 5, 1, 15)), costo: conCostos ? c('6.25') : null, valor: conCostos ? c('125') : null },
      { nivelId: 'n2', varianteId: 'v2', itemId: 'i2', nombre: '@Funda', sku: 'FUN-1', sucursalId: 's2', sucursalNombre: 'Norte', sucursalActiva: false, existencia: 5, ultimaVenta: null, diasSinVender: null, ultimaEntrada: null, costo: null, valor: null },
    ],
  }
}

test('sinVentasToCsv: nunca vendido dice «Nunca», lo sin costo va vacío, y sin costos no hay ninguna columna de dinero', () => {
  const con = sinVentasToCsv(sinVentasDePrueba(true), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Sucursal', 'Centro']], tope: 20000 })
  assert.match(con, /^Días sin vender;90$/m)
  assert.match(con, /^Filtro: Sucursal;Centro$/m)
  assert.match(con, /^Valor inmovilizado \(solo lo que tiene costo\);125\.00$/m)
  assert.match(con, /^Unidades SIN costo \(no suman al valor\);5$/m)
  assert.match(con, /Producto;SKU;Sucursal;Existencia;Ultima venta;Dias sin vender;Ultima entrada;Costo unitario;Valor/)
  assert.match(con, /^Cable;CAB-1;Centro;20;2026-07-01;106;2026-06-01;6\.25;125\.00$/m)
  assert.match(con, /^'@Funda;FUN-1;Norte \(desactivada\);5;Nunca;;;;$/m)
  assert.match(con, /^Datos completos;Si$/m)
  const sin = sinVentasToCsv(sinVentasDePrueba(false), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.doesNotMatch(sin, /Costo unitario|Valor inmovilizado|SIN costo|6\.25|125/)
  assert.match(sin, /^Cable;CAB-1;Centro;20;2026-07-01;106;2026-06-01$/m)
  const corto = sinVentasToCsv(sinVentasDePrueba(true, 30000), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(corto, /^Datos completos;"?NO - el archivo trae solo los primeros 20000 de 30000 saldos/m)
})

function rotacionDePrueba(conCostos: boolean, o: { truncado?: boolean; total?: number } = {}): RotacionVista {
  const r1 = calcularRotacion({ vendidas: 25, existenciaInicial: 80, existenciaFinal: 55, disponible: 52, dias: 30 })
  const r2 = calcularRotacion({ vendidas: 0, existenciaInicial: 10, existenciaFinal: 10, disponible: 10, dias: 30 })
  return {
    dias: 30,
    total: o.total ?? 2,
    pagina: 1,
    porPagina: 20000,
    porEstado: { AGOTADO: 0, POCA: 0, NORMAL: 1, EXCESO: 0, SIN_VENTAS: 1 },
    unidadesVendidas: 25,
    truncado: o.truncado ?? false,
    valorado: conCostos ? { costoDeVentas: c('150'), unidadesSinCosto: 4, valorInventario: c('350'), diasDeInventario: 70 } : null,
    filas: [
      { ...r1, varianteId: 'v1', itemId: 'i1', nombre: 'Harina', sku: 'HAR-1', existencia: 55, disponible: 52, ultimaVenta: new Date(Date.UTC(2026, 9, 5, 15)) },
      { ...r2, varianteId: 'v2', itemId: 'i2', nombre: '-Sal', sku: 'SAL-1', existencia: 10, disponible: 10, ultimaVenta: null },
    ],
  }
}

test('rotacionToCsv: decimales con punto, la cobertura de lo que no se vende va vacía (no infinita) y los estados se cuentan', () => {
  const csv = rotacionToCsv(rotacionDePrueba(true), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [['Estado', 'Normal']], tope: 20000 })
  assert.match(csv, /^Periodo en días;30$/m)
  assert.match(csv, /^Filtro: Estado;Normal$/m)
  assert.match(csv, /^Productos: Normal;1$/m)
  assert.match(csv, /^Productos: Sin ventas;1$/m)
  assert.match(csv, /^Costo de ventas del periodo \(solo lo que tenía costo\);150\.00$/m)
  assert.match(csv, /^Valor del inventario \(solo lo que tiene costo\);350\.00$/m)
  assert.match(csv, /^Dias de inventario;70$/m)
  assert.match(csv, /^Unidades vendidas SIN costo conocido[^;]*;4$/m)
  // Harina: 25 vendidas en 30 días = 0.83/día; promedio (80+55)/2 = 67.5; 25/67.5 = 0.37 veces; 52 / (25/30) = 62.4 días.
  assert.match(csv, /^Harina;HAR-1;55;52;25;0\.83;67\.5;0\.37;62\.4;Normal;2026-10-05$/m)
  assert.match(csv, /^'-Sal;SAL-1;10;10;0;0;10;0;;Sin ventas;$/m, 'sin ventas: cobertura y última venta vacías')
  assert.match(csv, /^Datos completos;Si$/m)
  assert.ok(!/Infinity|NaN/.test(csv))
})

test('rotacionToCsv sin costos no trae nada valorado, y avisa si la lista quedó cortada por el tope de lectura o por el del archivo', () => {
  const sin = rotacionToCsv(rotacionDePrueba(false), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.doesNotMatch(sin, /Costo de ventas|Valor del inventario|Dias de inventario|SIN costo|150|350/)
  const lectura = rotacionToCsv(rotacionDePrueba(true, { truncado: true }), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 5000 })
  assert.match(lectura, /^Datos completos;"?NO - había más productos de los que se leen \(5000\)/m)
  const archivo = rotacionToCsv(rotacionDePrueba(true, { total: 25000 }), { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(archivo, /^Datos completos;"?NO - el archivo trae solo los primeros 20000 de 25000 productos/m)
})

test('los montos grandes salen planos en los tres archivos: sin separador de miles que una hoja de cálculo no sume', () => {
  // Kardex: 2000 unidades a 1234.5 = 2,469,000.00.
  const k = armarKardex(0, [mov({ origen: null, destino: 'AVAILABLE', cantidad: 2000, costo: c('1234.5') }), mov({ tipo: 'SALE', origen: 'AVAILABLE', destino: null, cantidad: 1000, costo: c('1234.5') })], true)
  const vista: KardexVista = { ...kardexDePrueba(true), apertura: 0, cierre: k.saldoFinal, filas: k.filas, totales: k.totales }
  const csv = kardexToCsv(vista, { zonaHoraria: ZONA, generadoEn: AHORA, tope: 20000 })
  assert.match(csv, /^Valor de las entradas \(solo las que tienen costo\);2469000\.00$/m)
  assert.match(csv, /^Valor de las salidas \(solo las que tienen costo\);1234500\.00$/m)
  assert.match(csv, /;2000;0;2000;;1234\.50;2469000\.00;/, 'costo unitario y valor de la fila, sin comas')
  // Stock sin ventas: 4000 unidades a 1500.25.
  const sv = sinVentasDePrueba(true)
  const sinVentas: SinVentasVista = { ...sv, resumen: { ...sv.resumen, valor: c('6001000'), unidadesSinCosto: 0 }, filas: [{ ...sv.filas[0], existencia: 4000, costo: c('1500.25'), valor: c('6001000') }, sv.filas[1]] }
  const svCsv = sinVentasToCsv(sinVentas, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(svCsv, /^Valor inmovilizado \(solo lo que tiene costo\);6001000\.00$/m)
  assert.match(svCsv, /^Cable;CAB-1;Centro;4000;2026-07-01;106;2026-06-01;1500\.25;6001000\.00$/m)
  // Rotación: costo de ventas e inventario en millones.
  const r = rotacionDePrueba(true)
  const rot: RotacionVista = { ...r, valorado: { costoDeVentas: c('1500000'), unidadesSinCosto: 0, valorInventario: c('2250000.5'), diasDeInventario: 45 } }
  const rCsv = rotacionToCsv(rot, { zonaHoraria: ZONA, generadoEn: AHORA, filtros: [], tope: 20000 })
  assert.match(rCsv, /^Costo de ventas del periodo \(solo lo que tenía costo\);1500000\.00$/m)
  assert.match(rCsv, /^Valor del inventario \(solo lo que tiene costo\);2250000\.50$/m)
})
