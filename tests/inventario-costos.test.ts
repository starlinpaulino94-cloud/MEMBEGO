import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COSTO_MAXIMO,
  FACTOR_COSTO,
  TIPOS_VALORADOS_AL_PROMEDIO,
  costoADecimal,
  costoDeDecimal,
  costoEfectivo,
  costoOpcional,
  formatearCosto,
  formatearMonto,
  parsearCosto,
  promedioPonderado,
  resumirValor,
  validarCorreccionDeCosto,
  valorDe,
} from '../src/modules/inventory/costos'
import { fusionarLineas, validarLineasEntrada } from '../src/modules/inventory/entradas'
import { indexarCatalogo, leerImportacion, plantillaImportacionCsv, validarImportacion, type VarianteImportable } from '../src/modules/inventory/importacion'
import { consultaDeFiltrosValor, leerFiltrosValor, mesValido } from '../src/modules/inventory/filtros'
import { entradaToCsv, valorToCsv } from '../src/modules/inventory/exportacion'
import { mesActual, rangoDeMes } from '../src/modules/inventory/valor'

/** Un costo en diezmilésimas a partir de «12.5» (para escribir las pruebas legibles). */
const c = (t: string): bigint => {
  const r = parsearCosto(t)
  assert.ok(r.ok, `«${t}» debía ser un costo válido`)
  return r.valor
}

test('un costo se lee exacto: enteros, decimales hasta cuatro y nada más', () => {
  assert.equal(c('12'), BigInt(120000))
  assert.equal(c('12.5'), BigInt(125000))
  assert.equal(c('12.50'), BigInt(125000))
  assert.equal(c('0.0525'), BigInt(525))
  assert.equal(c('0'), BigInt(0))
  assert.equal(c(' 7.1 '), BigInt(71000))
  // 0,1 + 0,2 con flotantes no da 0,3; con enteros sí.
  assert.equal(c('0.1') + c('0.2'), c('0.3'))
})

test('un costo mal escrito se rechaza con un mensaje que dice qué hacer', () => {
  for (const malo of ['', '   ', 'abc', '-1', '+5', '1e3', '12.12345', '1.2.3', 'RD$ 5', '.5', '5.', '1 000', '1234567890']) {
    assert.equal(parsearCosto(malo).ok, false, `«${malo}» no es un costo`)
  }
  const coma = parsearCosto('1,250')
  assert.equal(coma.ok, false)
  assert.match(!coma.ok ? coma.error : '', /coma/)
  assert.equal(parsearCosto(Number.NaN).ok, false)
  assert.equal(parsearCosto(Infinity).ok, false)
  assert.equal(parsearCosto(undefined).ok, false)
  assert.equal(parsearCosto({}).ok, false)
  // Un número de JavaScript sí vale mientras no traiga más de cuatro decimales.
  assert.equal(parsearCosto(12.5).ok, true)
  assert.equal(parsearCosto(0.1 + 0.2).ok, false, '0.30000000000000004 trae demasiados decimales')
})

test('el tope: cien millones sí, un centavo más no', () => {
  assert.equal(c('100000000'), COSTO_MAXIMO)
  assert.equal(parsearCosto('100000000.0001').ok, false)
  assert.equal(parsearCosto('999999999').ok, false)
})

test('costo opcional: vacío o ausente es «no se capturó» (no es error ni es cero); cero es un costo', () => {
  for (const v of [undefined, null, '', '   ']) assert.deepEqual(costoOpcional(v), { ok: true, valor: null })
  assert.deepEqual(costoOpcional('0'), { ok: true, valor: BigInt(0) })
  assert.equal(costoOpcional('x').ok, false)
})

test('de la base y a la base: cuatro decimales siempre y sin pérdida', () => {
  for (const t of ['0', '1', '12.5', '0.0525', '99999999.9999', '100000000']) {
    const v = c(t)
    assert.equal(costoDeDecimal(costoADecimal(v)), v, t)
  }
  assert.equal(costoADecimal(c('12.5')), '12.5000')
  assert.equal(costoADecimal(c('0.0525')), '0.0525')
  assert.equal(costoADecimal(BigInt(0)), '0.0000')
  // Prisma entrega un Decimal: cualquier cosa con toFixed sirve.
  assert.equal(costoDeDecimal({ toFixed: (n: number) => (12.5).toFixed(n) }), c('12.5'))
  assert.equal(costoDeDecimal(7), c('7'))
  assert.throws(() => costoDeDecimal('abc'), /ilegible/)
})

test('mostrar: dos decimales con redondeo hacia arriba en la mitad; el costo unitario no esconde sus decimales útiles', () => {
  assert.equal(formatearMonto(c('12.5')), '12.50')
  assert.equal(formatearMonto(c('0.005')), '0.01', 'la mitad sube')
  assert.equal(formatearMonto(c('0.0049')), '0.00')
  assert.equal(formatearMonto(c('1234.567')), '1,234.57')
  assert.equal(formatearMonto(c('0.0525'), 4), '0.0525')
  assert.equal(formatearCosto(c('12.5')), '12.50')
  assert.equal(formatearCosto(c('0.0525')), '0.0525')
  assert.equal(formatearCosto(c('3.1')), '3.10')
  assert.equal(formatearCosto(c('0.12')), '0.12')
  assert.equal(formatearCosto(BigInt(0)), '0.00')
})

test('promedio ponderado: 10 a 5 más 10 a 7 = 20 a 6', () => {
  assert.equal(promedioPonderado({ unidades: 10, promedio: c('5'), referencia: null }, { unidades: 10, costo: c('7') }), c('6'))
  // 3 a 10 más 1 a 20 = 4 unidades por 50 = 12.50
  assert.equal(promedioPonderado({ unidades: 3, promedio: c('10'), referencia: null }, { unidades: 1, costo: c('20') }), c('12.5'))
})

test('promedio ponderado: sin existencias previas el costo nuevo reemplaza al viejo', () => {
  assert.equal(promedioPonderado({ unidades: 0, promedio: c('99'), referencia: c('50') }, { unidades: 4, costo: c('8') }), c('8'))
})

test('promedio ponderado: sin promedio pesa el costo de referencia del catálogo; sin ninguno vale el de la entrada', () => {
  // 10 unidades viejas valían 4 (referencia); entran 10 a 6 → 5.
  assert.equal(promedioPonderado({ unidades: 10, promedio: null, referencia: c('4') }, { unidades: 10, costo: c('6') }), c('5'))
  // El promedio manda sobre la referencia.
  assert.equal(promedioPonderado({ unidades: 10, promedio: c('8'), referencia: c('4') }, { unidades: 10, costo: c('6') }), c('7'))
  // Existencias sin costo conocido: las viejas no se cuentan como cero (no se diluye el costo).
  assert.equal(promedioPonderado({ unidades: 10, promedio: null, referencia: null }, { unidades: 5, costo: c('6') }), c('6'))
})

test('promedio ponderado: redondea la mitad hacia arriba a la cuarta decimal', () => {
  // 1 a 0.0001 más 1 a 0.0002 = 0.00015 → 0.0002 (la mitad sube)
  assert.equal(promedioPonderado({ unidades: 1, promedio: c('0.0001'), referencia: null }, { unidades: 1, costo: c('0.0002') }), c('0.0002'))
  // 2 a 0.0001 más 1 a 0.0002 = 0.0004/3 = 0.000133… → 0.0001
  assert.equal(promedioPonderado({ unidades: 2, promedio: c('0.0001'), referencia: null }, { unidades: 1, costo: c('0.0002') }), c('0.0001'))
})

test('promedio ponderado: entrada de cero cuesta cero y diluye (una muestra regalada)', () => {
  assert.equal(promedioPonderado({ unidades: 10, promedio: c('10'), referencia: null }, { unidades: 10, costo: BigInt(0) }), c('5'))
})

test('promedio ponderado: rechaza lo imposible', () => {
  assert.throws(() => promedioPonderado({ unidades: 1, promedio: c('1'), referencia: null }, { unidades: 0, costo: c('1') }), /al menos una unidad/)
  assert.throws(() => promedioPonderado({ unidades: -1, promedio: c('1'), referencia: null }, { unidades: 1, costo: c('1') }), /negativas/)
  assert.throws(() => promedioPonderado({ unidades: 1.5, promedio: c('1'), referencia: null }, { unidades: 1, costo: c('1') }), /negativas/)
})

/** Un generador determinista (mulberry32) para propiedades sin depender de una librería. */
function azar(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('propiedad: el promedio queda entre los dos costos y el valor se conserva (salvo medio centavo de diezmilésima por unidad)', () => {
  const r = azar(20261059)
  for (let i = 0; i < 2000; i++) {
    const uPrevias = Math.floor(r() * 5000)
    const uEntra = 1 + Math.floor(r() * 5000)
    const previo = BigInt(Math.floor(r() * 5_000_000))
    const nuevo = BigInt(Math.floor(r() * 5_000_000))
    const prom = promedioPonderado({ unidades: uPrevias, promedio: previo, referencia: null }, { unidades: uEntra, costo: nuevo })
    const bajo = uPrevias === 0 ? nuevo : previo < nuevo ? previo : nuevo
    const alto = uPrevias === 0 ? nuevo : previo > nuevo ? previo : nuevo
    assert.ok(prom >= bajo && prom <= alto, `caso ${i}: ${prom} no está entre ${bajo} y ${alto}`)
    if (uPrevias > 0) {
      const antes = valorDe(uPrevias, previo) + valorDe(uEntra, nuevo)
      const despues = valorDe(uPrevias + uEntra, prom)
      const dif = antes > despues ? antes - despues : despues - antes
      // Redondear el promedio a la diezmilésima cambia el valor total en, como mucho, media diezmilésima por unidad.
      assert.ok(dif * BigInt(2) <= BigInt(uPrevias + uEntra), `caso ${i}: el valor cambió ${dif}`)
    }
  }
})

test('propiedad: un promedio de entradas encadenadas no depende de cuántas veces se redondea en exceso', () => {
  // Cinco entradas seguidas del mismo producto: el valor final queda a menos de una diezmilésima por unidad del exacto.
  const entradas = [
    { unidades: 7, costo: c('3.1415') },
    { unidades: 13, costo: c('2.7182') },
    { unidades: 5, costo: c('9.99') },
    { unidades: 21, costo: c('0.05') },
    { unidades: 2, costo: c('120') },
  ]
  let unidades = 0
  let promedio: bigint | null = null
  let exacto = BigInt(0)
  for (const e of entradas) {
    promedio = promedioPonderado({ unidades, promedio, referencia: null }, e)
    unidades += e.unidades
    exacto += valorDe(e.unidades, e.costo)
  }
  const dif = exacto - valorDe(unidades, promedio!)
  const abs = dif < BigInt(0) ? -dif : dif
  assert.ok(abs <= BigInt(entradas.length * unidades), `el redondeo acumulado fue ${abs}`)
})

test('costo efectivo: el promedio, o el de referencia; sin ninguno no hay costo', () => {
  assert.equal(costoEfectivo(c('3'), c('9')), c('3'))
  assert.equal(costoEfectivo(null, c('9')), c('9'))
  assert.equal(costoEfectivo(null, null), null)
  assert.equal(costoEfectivo(BigInt(0), c('9')), BigInt(0), 'un promedio de cero es un costo (no se salta a la referencia)')
})

test('el resumen de valor no cuenta como cero lo que no tiene costo', () => {
  const r = resumirValor([
    { unidades: 10, costo: c('5') },
    { unidades: 4, costo: c('0.25') },
    { unidades: 7, costo: null },
    { unidades: 0, costo: null },
    { unidades: 3, costo: BigInt(0) },
  ])
  assert.equal(r.valor, c('51'))
  assert.equal(r.unidadesConCosto, 17)
  assert.equal(r.unidadesSinCosto, 7)
  assert.equal(r.productosSinCosto, 1)
  assert.deepEqual(resumirValor([]), { unidadesConCosto: 0, unidadesSinCosto: 0, productosSinCosto: 0, valor: BigInt(0) })
})

test('corregir el costo exige un costo válido y un motivo escrito', () => {
  const ok = validarCorreccionDeCosto('12.5', '  Se capturó   con un cero de más ')
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.costo, c('12.5'))
    assert.equal(ok.motivo, 'Se capturó con un cero de más')
  }
  for (const [costo, motivo, codigo] of [
    ['x', 'motivo', 'COSTO_INVALIDO'],
    ['5', '', 'MOTIVO_OBLIGATORIO'],
    ['5', '   ', 'MOTIVO_OBLIGATORIO'],
    ['5', undefined, 'MOTIVO_OBLIGATORIO'],
    ['5', 'a'.repeat(301), 'MOTIVO_INVALIDO'],
  ] as const) {
    const r = validarCorreccionDeCosto(costo, motivo)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.codigo, codigo)
  }
  assert.ok(validarCorreccionDeCosto('0', 'regalo').ok, 'cero es un costo válido')
})

test('solo se valoran con el promedio las ventas, devoluciones, daños y ajustes; las entradas, reservas y transferencias no', () => {
  assert.deepEqual([...TIPOS_VALORADOS_AL_PROMEDIO].sort(), ['ADJUSTMENT', 'DAMAGE', 'RETURN', 'SALE'])
  for (const no of ['PURCHASE', 'RESERVATION', 'RESERVATION_RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT']) assert.equal(TIPOS_VALORADOS_AL_PROMEDIO.has(no), false, no)
})

// ── Las líneas de una entrada con costo ──────────────────────────────────────

test('las líneas de una entrada llevan el costo normalizado, o ninguno, sin tocar lo demás', () => {
  const r = validarLineasEntrada([
    { varianteId: 'a', cantidad: 2, costo: '12.5' },
    { varianteId: 'b', cantidad: 3 },
    { varianteId: 'c', cantidad: 1, costo: '' },
    { varianteId: 'd', cantidad: 1, costo: '0' },
  ])
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.lineas, [
      { varianteId: 'a', cantidad: 2, costo: '12.5000' },
      { varianteId: 'b', cantidad: 3 },
      { varianteId: 'c', cantidad: 1 },
      { varianteId: 'd', cantidad: 1, costo: '0.0000' },
    ])
    assert.equal(r.unidades, 7)
  }
})

test('un costo malo en una línea rechaza la entrada y dice cuál línea es', () => {
  const r = validarLineasEntrada([
    { varianteId: 'a', cantidad: 2, costo: '5' },
    { varianteId: 'b', cantidad: 1, costo: '1,5' },
  ])
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.codigo, 'COSTO_INVALIDO')
    assert.match(r.error, /^Línea 2:/)
  }
})

test('fusionar líneas conserva el primer costo capturado', () => {
  const f = fusionarLineas([
    { varianteId: 'a', cantidad: 1 },
    { varianteId: 'a', cantidad: 2, costo: '4.0000' },
    { varianteId: 'a', cantidad: 1, costo: '9.0000' },
    { varianteId: 'b', cantidad: 5 },
  ])
  assert.deepEqual(f, [
    { varianteId: 'a', cantidad: 4, costo: '4.0000' },
    { varianteId: 'b', cantidad: 5 },
  ])
})

test('el factor es diez mil: la escala que usan la base y las pruebas', () => {
  assert.equal(FACTOR_COSTO, BigInt(10000))
})

// ── La importación CSV con costo ─────────────────────────────────────────────


const catalogo: VarianteImportable[] = [
  { id: 'v1', sku: 'AC-1', barcode: '7501', nombre: 'Aceite', controlaInventario: true, descontinuada: false },
  { id: 'v2', sku: 'AR-2', barcode: null, nombre: 'Arroz', controlaInventario: true, descontinuada: false },
  { id: 'v3', sku: 'SA-3', barcode: null, nombre: 'Sal', controlaInventario: true, descontinuada: false },
]
const informe = (csv: string, permitirCostos: boolean) => {
  const l = leerImportacion(csv)
  assert.ok(l.ok)
  return validarImportacion(l.ok ? l.filas : [], indexarCatalogo(catalogo), 'ENTRADA', { permitirCostos })
}

test('el archivo con columna de costo la lee con cualquiera de sus nombres; sin la columna las filas ni traen la clave', () => {
  for (const encabezado of ['costo', 'Costo unitario', 'COSTO_UNITARIO', 'unit cost', 'Precio de compra']) {
    const l = leerImportacion(`sku;cantidad;${encabezado}\nAC-1;5;12,50`)
    assert.ok(l.ok, encabezado)
    if (l.ok) assert.deepEqual(l.filas[0], { fila: 2, sku: 'AC-1', barcode: null, cantidad: '5', costo: '12,50' })
  }
  const sin = leerImportacion('sku;cantidad\nAC-1;5')
  assert.ok(sin.ok)
  if (sin.ok) assert.equal('costo' in sin.filas[0], false)
  // Un conteo no lee costos aunque la hoja tenga la columna.
  const conteo = leerImportacion('sku;contado;costo\nAC-1;5;3', 'CONTEO')
  assert.ok(conteo.ok)
  if (conteo.ok) assert.equal('costo' in conteo.filas[0], false)
})

test('importar con costo: celda vacía = sin costo, 0 = costo cero, y las líneas llevan el costo normalizado', () => {
  const r = informe('sku;cantidad;costo\nAC-1;5;12.5\nAR-2;3;\nSA-3;2;0', true)
  assert.equal(r.ok, true)
  assert.deepEqual(r.lineas, [
    { varianteId: 'v1', cantidad: 5, costo: '12.5000' },
    { varianteId: 'v2', cantidad: 3 },
    { varianteId: 'v3', cantidad: 2, costo: '0.0000' },
  ])
  assert.equal(r.conCosto, 2)
  assert.deepEqual(r.vistaPrevia.map((x) => x.costo), ['12.50', undefined, '0.00'])
})

test('importar con un costo mal escrito rechaza el archivo entero y dice la fila', () => {
  const r = informe('sku;cantidad;costo\nAC-1;5;12.5\nAR-2;3;1,5\nSA-3;2;abc', true)
  assert.equal(r.ok, false)
  assert.equal(r.totalErrores, 2)
  assert.match(r.errores[0].mensaje, /coma/)
  assert.equal(r.errores[0].fila, 3)
  assert.equal(r.lineas.length, 0, 'todo o nada')
})

test('quien no puede registrar costos no sube un archivo con costos (no se ignoran en silencio), pero sí uno sin ellos', () => {
  const con = informe('sku;cantidad;costo\nAC-1;5;12.5', false)
  assert.equal(con.ok, false)
  assert.match(con.errores[0].mensaje, /no tiene permiso para registrar costos/)
  assert.equal(informe('sku;cantidad;costo\nAC-1;5;', false).ok, true, 'una columna de costo vacía no es un costo')
  assert.equal(informe('sku;cantidad\nAC-1;5', false).ok, true)
  assert.equal(informe('sku;cantidad\nAC-1;5', true).conCosto, undefined, 'sin columna no hay conteo de costos')
})

test('la plantilla con costos trae la columna y se lee de vuelta; sus filas de ejemplo se rechazan', () => {
  const plantilla = plantillaImportacionCsv(true)
  assert.match(plantilla.split('\n')[0], /sku;codigo_de_barras;cantidad;costo;/)
  assert.doesNotMatch(plantillaImportacionCsv(false).split('\n')[0], /costo/)
  const l = leerImportacion(plantilla)
  assert.ok(l.ok)
  const r = validarImportacion(l.ok ? l.filas : [], indexarCatalogo(catalogo), 'ENTRADA', { permitirCostos: true })
  assert.equal(r.ok, false, 'los ejemplos no existen en el catálogo')
})

// ── Valor del inventario: filtros, meses y archivos ──────────────────────────

test('los filtros del valor se leen de la URL con las mismas reglas y vuelven a la misma consulta', () => {
  assert.deepEqual(leerFiltrosValor({}), { pagina: 1 })
  const f = leerFiltrosValor({ sucursal: 'abc', q: '  aceite ', sinCosto: '1', mes: '2026-09', pagina: '3' })
  assert.deepEqual(f, { sucursalId: 'abc', q: 'aceite', sinCosto: true, mes: '2026-09', pagina: 3 })
  assert.deepEqual(leerFiltrosValor(Object.fromEntries(new URLSearchParams(consultaDeFiltrosValor(f)))), f)
  assert.equal(consultaDeFiltrosValor({ pagina: 1 }), '')
  assert.equal(consultaDeFiltrosValor(f, 1).includes('pagina'), false, 'la página 1 es la de por defecto')
  // Lo raro de la URL no rompe nada.
  for (const malo of ['0', '-2', 'x', '1.5', '999999', '']) assert.equal(leerFiltrosValor({ pagina: malo }).pagina, 1, malo)
  assert.equal(leerFiltrosValor({ sinCosto: '0' }).sinCosto, undefined)
  assert.equal(leerFiltrosValor({ mes: '2026-13' }).mes, undefined)
  assert.equal(leerFiltrosValor({ q: 'x'.repeat(500) }).q?.length, 80)
})

test('un mes es YYYY-MM de un calendario que existe', () => {
  for (const ok of ['2026-01', '2026-12', '2000-06']) assert.equal(mesValido(ok), ok)
  for (const malo of ['2026-00', '2026-13', '26-10', '2026-1', '2026/10', '1999-12', '2101-01', '', undefined]) assert.equal(mesValido(malo), undefined, String(malo))
})

test('el mes en curso y sus límites se miden con el calendario de la empresa, no con el de UTC', () => {
  const zona = 'America/Santo_Domingo' // UTC−4 todo el año
  // El 1 de octubre a las 02:00 UTC todavía es 30 de septiembre en Santo Domingo.
  assert.equal(mesActual(zona, new Date('2026-10-01T02:00:00Z')), '2026-09')
  assert.equal(mesActual(zona, new Date('2026-10-01T05:00:00Z')), '2026-10')
  const oct = rangoDeMes('2026-10', zona)
  assert.equal(oct.gte.toISOString(), '2026-10-01T04:00:00.000Z')
  assert.equal(oct.lt.toISOString(), '2026-11-01T04:00:00.000Z')
  assert.equal(rangoDeMes('2026-12', zona).lt.toISOString(), '2027-01-01T04:00:00.000Z', 'diciembre termina en enero del año siguiente')
  assert.equal(mesActual('Zona/Inventada', new Date('2026-10-15T12:00:00Z')), '2026-10', 'una zona inválida cae a UTC')
})

const valorBase = {
  resumen: { valor: '1,234.50', unidades: 40, unidadesSinCosto: 5, productos: 3, productosSinCosto: 1, danadas: 2 },
  porSucursal: [{ nombre: '=Principal', activa: true, unidades: 40, unidadesSinCosto: 5, valor: '1,234.50' }],
  enTransito: { unidades: 3, unidadesSinCosto: 0, valor: '15.00' },
  costoDeVentas: { mes: '2026-10', costo: '99.00', unidadesVendidas: 10, unidadesSinCosto: 1, unidadesDevueltas: 0 },
  filas: [
    { nombre: '+Aceite', sku: '@AC', unidades: 30, danadas: 2, costo: '12.50', fuente: 'PROMEDIO' as const, valor: '1,125.00' },
    { nombre: 'Sal', sku: 'SA', unidades: 5, danadas: 0, costo: null, fuente: null, valor: null },
  ],
  totalFilas: 2,
}
const ctxCsv = { zonaHoraria: 'America/Santo_Domingo', generadoEn: new Date('2026-10-14T16:00:00Z'), filtros: [['Sucursal', 'Principal']] as const, tope: 20000 }

test('el CSV del valor: números planos que se suman, lo que no tiene costo SIN cifra (no cero), y nada que Excel ejecute', () => {
  const csv = valorToCsv(valorBase, ctxCsv)
  assert.match(csv, /Valor del inventario \(solo productos con costo\)[;,]1234\.50/)
  assert.doesNotMatch(csv, /1,234/, 'el separador de miles rompería la suma')
  assert.match(csv, /Sal[;,]SA[;,]5[;,]0[;,][;,]Sin costo[;,]\s*$/m, 'sin costo: celdas vacías y «Sin costo»')
  assert.match(csv, /Filtro: Sucursal[;,]Principal/)
  assert.match(csv, /Costo de ventas de 2026-10[;,]99\.00/)
  assert.match(csv, /Unidades SIN costo/)
  assert.doesNotMatch(csv, /(^|[;,])=Principal/m)
  assert.match(csv, /'=Principal/)
  assert.match(csv, /'\+Aceite/)
  assert.match(csv, /'@AC/)
  assert.doesNotMatch(csv, /AVISO/, 'sin recorte no hay aviso')
})

test('el CSV del valor avisa cuando el tope cortó las filas', () => {
  const csv = valorToCsv({ ...valorBase, totalFilas: 25000 }, ctxCsv)
  assert.match(csv, /AVISO[;,].*primeros 20000 de 25000/)
})

const entradaBase = {
  numero: 'ENT-2026-000001',
  creadoEn: new Date('2026-10-14T16:00:00Z'),
  sucursalNombre: 'Principal',
  origen: 'MANUAL' as const,
  referencia: null,
  nota: null,
  usuarioNombre: 'Compras',
  lineas: 2,
  unidades: 12,
  detalle: [
    { sku: 'AC', barcode: null, itemNombre: 'Aceite', nombreVariante: 'Default', esDefault: true, cantidad: 10, existenciaAntes: 0, existenciaDespues: 10 },
    { sku: 'SA', barcode: null, itemNombre: 'Sal', nombreVariante: 'Default', esDefault: true, cantidad: 2, existenciaAntes: 5, existenciaDespues: 7 },
  ],
}

test('el CSV de una entrada lleva el costo SOLO si se lo pidió quien puede verlo', () => {
  const sin = entradaToCsv(entradaBase, 'America/Santo_Domingo')
  assert.doesNotMatch(sin, /[Cc]osto/, 'sin permiso el archivo no menciona costos')
  const con = entradaToCsv(
    { ...entradaBase, valorTotal: '125.00', detalle: [{ ...entradaBase.detalle[0], costo: '12.50' }, { ...entradaBase.detalle[1], costo: null }] },
    'America/Santo_Domingo'
  )
  assert.match(con, /Costo de la entrada \(solo lineas con costo\)[;,]125\.00/)
  assert.match(con, /Costo unitario/)
  assert.match(con, /Aceite[;,]10[;,]0[;,]10[;,]12\.50/)
  assert.match(con, /Sal[;,]2[;,]5[;,]7[;,]Sin costo/)
})
