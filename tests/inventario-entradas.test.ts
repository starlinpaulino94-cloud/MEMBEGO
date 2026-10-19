import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LINEAS_ENTRADA, MAX_LINEAS_IMPORTACION, fusionarLineas, normalizarTextoLibre, validarLineasEntrada } from '../src/modules/inventory/entradas'
import {
  MAX_CARACTERES_IMPORTACION,
  MAX_ERRORES_LISTADOS,
  detectarDelimitador,
  indexarCatalogo,
  leerImportacion,
  normalizarEncabezado,
  parseCsv,
  plantillaImportacionCsv,
  validarImportacion,
  type FilaCsv,
  type VarianteImportable,
} from '../src/modules/inventory/importacion'
import { consultaDeFiltrosEntradas, leerFiltrosEntradas } from '../src/modules/inventory/filtros'
import { describirReferencia } from '../src/modules/inventory/formato'
import { entradaToCsv, type EntradaParaCsv } from '../src/modules/inventory/exportacion'

/**
 * COMMERCE CORE · inventario — INV-2a: las reglas PURAS de las entradas de
 * mercancía y de la importación CSV. Sin base de datos: el comportamiento contra
 * PostgreSQL está en `tests/postgres/inventory-entradas.db.test.ts`.
 */

// ── Líneas de una entrada ────────────────────────────────────────────────────

test('una entrada necesita líneas válidas: al menos una, cada producto una vez, cantidades enteras de 1 en adelante', () => {
  const ok = validarLineasEntrada([{ varianteId: 'a', cantidad: 3 }, { varianteId: ' b ', cantidad: 2 }])
  assert.ok(ok.ok)
  assert.deepEqual(ok.lineas, [{ varianteId: 'a', cantidad: 3 }, { varianteId: 'b', cantidad: 2 }])
  assert.equal(ok.unidades, 5)
  const codigo = (x: unknown, max?: number) => {
    const r = validarLineasEntrada(x, max)
    return r.ok ? 'OK' : r.codigo
  }
  assert.equal(codigo([]), 'ENTRADA_SIN_LINEAS')
  assert.equal(codigo(null), 'ENTRADA_SIN_LINEAS')
  assert.equal(codigo('texto'), 'ENTRADA_SIN_LINEAS')
  assert.equal(codigo([{ varianteId: 'a', cantidad: 1 }, { varianteId: 'a', cantidad: 1 }]), 'LINEA_REPETIDA')
  assert.equal(codigo([{ varianteId: '', cantidad: 1 }]), 'LINEA_INVALIDA')
  assert.equal(codigo([{ cantidad: 1 }]), 'LINEA_INVALIDA')
  assert.equal(codigo([null]), 'LINEA_INVALIDA')
  assert.equal(codigo([{ varianteId: 'x'.repeat(121), cantidad: 1 }]), 'LINEA_INVALIDA')
  for (const mala of [0, -1, 1.5, NaN, Infinity, '3', null, 2_000_000]) assert.equal(codigo([{ varianteId: 'a', cantidad: mala }]), 'CANTIDAD_INVALIDA', String(mala))
  assert.equal(codigo(Array.from({ length: MAX_LINEAS_ENTRADA + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 }))), 'DEMASIADAS_LINEAS')
  assert.equal(codigo(Array.from({ length: MAX_LINEAS_ENTRADA + 1 }, (_, i) => ({ varianteId: `v${i}`, cantidad: 1 })), MAX_LINEAS_IMPORTACION), 'OK', 'una importación admite más')
})

test('escanear dos veces el mismo producto suma en la misma línea, en el orden de la primera aparición', () => {
  assert.deepEqual(
    fusionarLineas([{ varianteId: 'a', cantidad: 1 }, { varianteId: 'b', cantidad: 2 }, { varianteId: 'a', cantidad: 4 }]),
    [{ varianteId: 'a', cantidad: 5 }, { varianteId: 'b', cantidad: 2 }]
  )
  assert.deepEqual(fusionarLineas([]), [])
  assert.equal(fusionarLineas([{ varianteId: 'a', cantidad: 999_999 }, { varianteId: 'a', cantidad: 999_999 }])[0].cantidad, 1_000_000, 'no pasa del máximo por línea')
})

test('los textos libres (factura, nota) se limpian y se acotan', () => {
  assert.deepEqual(normalizarTextoLibre('  F-001   (copia) ', 120, 'La referencia'), { ok: true, valor: 'F-001 (copia)' })
  assert.deepEqual(normalizarTextoLibre('   ', 120, 'La referencia'), { ok: true, valor: null })
  assert.deepEqual(normalizarTextoLibre(undefined, 120, 'La referencia'), { ok: true, valor: null })
  assert.deepEqual(normalizarTextoLibre(null, 120, 'La referencia'), { ok: true, valor: null })
  assert.deepEqual(normalizarTextoLibre('x'.repeat(121), 120, 'La referencia'), { ok: false, error: 'La referencia no puede pasar de 120 caracteres.' })
  assert.deepEqual(normalizarTextoLibre(42, 120, 'La nota'), { ok: false, error: 'La nota no es válida.' })
})

// ── Leer el CSV ──────────────────────────────────────────────────────────────

test('el delimitador es el que más aparece en el encabezado, fuera de comillas; punto y coma si hay empate', () => {
  assert.equal(detectarDelimitador('sku;cantidad\nA;1'), ';')
  assert.equal(detectarDelimitador('sku,cantidad\nA,1'), ',')
  assert.equal(detectarDelimitador('sku\tcantidad\nA\t1'), '\t')
  assert.equal(detectarDelimitador('sku\ncantidad'), ';', 'sin separadores: el de Excel en español')
  assert.equal(detectarDelimitador('"a,b,c";cantidad\n'), ';', 'las comas dentro de comillas no cuentan')
  assert.equal(detectarDelimitador('a,b;c'), ';', 'empate: punto y coma')
})

test('el parser entiende comillas, comillas dobles, saltos dentro de una celda y los tres fines de línea', () => {
  assert.deepEqual(parseCsv('a;b\r\n1;2\r\n', ';'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('a;b\n1;2', ';'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('a;b\r1;2\r', ';'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseCsv('"x;y";"di ""hola""";z', ';'), [['x;y', 'di "hola"', 'z']])
  assert.deepEqual(parseCsv('"linea 1\nlinea 2";3', ';'), [['linea 1\nlinea 2', '3']])
  assert.deepEqual(parseCsv('a;;c\n;;', ';'), [['a', '', 'c'], ['', '', '']])
  assert.deepEqual(parseCsv('', ';'), [])
  assert.deepEqual(parseCsv('solo', ','), [['solo']])
  assert.throws(() => parseCsv('a;"sin cerrar\n1;2', ';'), /comillas sin cerrar/)
})

test('los encabezados se reconocen sin importar mayúsculas, acentos, espacios ni alias', () => {
  assert.equal(normalizarEncabezado('Código de Barras'), 'codigo_de_barras')
  assert.equal(normalizarEncabezado('  CANTIDAD  '), 'cantidad')
  assert.equal(normalizarEncabezado('SKU'), 'sku')
  for (const cab of ['sku;cantidad', 'SKU;Unidades', 'Código SKU;Qty', 'codigo de barras;cantidad', 'EAN;Cantidad recibida', 'sku;codigo_de_barras;cantidad;nombre']) {
    const r = leerImportacion(`${cab}\nA;1${cab.split(';').length > 2 ? ';2;x' : ''}`)
    assert.ok(r.ok, `${cab}: ${r.ok ? '' : r.error}`)
  }
})

test('un archivo sin las columnas necesarias, vacío, enorme o roto explica qué falta', () => {
  const error = (t: unknown) => {
    const r = leerImportacion(t)
    return r.ok ? 'OK' : r.error
  }
  assert.match(error('nombre;precio\nA;1'), /encabezados «sku» \(o «codigo_de_barras»\) y «cantidad»/)
  assert.match(error('sku;precio\nA;1'), /«cantidad»/)
  assert.match(error('cantidad\n5'), /«sku»/)
  assert.match(error(''), /vacío/)
  assert.match(error('   \n  '), /vacío/)
  assert.match(error('sku;cantidad\n'), /ninguna fila de datos/)
  assert.match(error('sku;cantidad\n;;\n   ;  \n'), /ninguna fila de datos/, 'las filas en blanco que Excel deja no son datos')
  assert.match(error('x'.repeat(MAX_CARACTERES_IMPORTACION + 1)), /demasiado grande/)
  assert.match(error('sku;cantidad\n"A;1'), /comillas sin cerrar/)
  assert.match(error(null), /No se pudo leer/)
  assert.match(error(42), /No se pudo leer/)
})

test('la lectura numera las filas como las ve la persona en su hoja (el encabezado es la 1) y salta las vacías', () => {
  const r = leerImportacion('﻿SKU;Cantidad;Nombre\nA-1;5;uno\n;;\nB-2;7;dos\n')
  assert.ok(r.ok)
  assert.equal(r.delimitador, ';')
  assert.deepEqual(r.filas, [
    { fila: 2, sku: 'A-1', barcode: null, cantidad: '5' },
    { fila: 4, sku: 'B-2', barcode: null, cantidad: '7' },
  ])
  const coma = leerImportacion('sku,cantidad\r\nA-1, 5 \r\n')
  assert.ok(coma.ok)
  assert.deepEqual(coma.filas, [{ fila: 2, sku: 'A-1', barcode: null, cantidad: '5' }])
})

// ── Validar contra el catálogo ───────────────────────────────────────────────

const v = (id: string, sku: string, barcode: string | null, nombre: string, extra: Partial<VarianteImportable> = {}): VarianteImportable => ({
  id,
  sku,
  barcode,
  nombre,
  controlaInventario: true,
  descontinuada: false,
  ...extra,
})
const catalogo = indexarCatalogo([
  v('v1', 'CAM-001', '7501234567890', 'Camiseta'),
  v('v2', 'GOR-001', '7501234567891', 'Gorra'),
  v('v3', 'LAV-001', null, 'Lavado', { controlaInventario: false }),
  v('v4', 'VIE-001', null, 'Viejo', { descontinuada: true }),
  v('v5', 'dup-1', null, 'Minúscula'),
  v('v6', 'DUP-1', null, 'Mayúscula'),
])
const fila = (n: number, sku: string | null, cantidad: string, barcode: string | null = null): FilaCsv => ({ fila: n, sku, barcode, cantidad })

test('un archivo limpio da un informe aplicable, con el nombre de cada producto encontrado', () => {
  const i = validarImportacion([fila(2, 'CAM-001', '10'), fila(3, null, '4', '7501234567891'), fila(4, 'cam-x', '1')].slice(0, 2), catalogo)
  assert.equal(i.ok, true)
  assert.equal(i.productos, 2)
  assert.equal(i.unidades, 14)
  assert.deepEqual(i.lineas, [{ varianteId: 'v1', cantidad: 10 }, { varianteId: 'v2', cantidad: 4 }])
  assert.deepEqual(i.vistaPrevia.map((x) => [x.fila, x.sku, x.nombre, x.cantidad]), [[2, 'CAM-001', 'Camiseta', 10], [3, 'GOR-001', 'Gorra', 4]])
  assert.equal(i.totalErrores, 0)
})

test('el SKU y el código se buscan sin importar mayúsculas, y si vienen los dos deben ser del mismo producto', () => {
  assert.equal(validarImportacion([fila(2, 'cam-001', '1')], catalogo).ok, true)
  assert.equal(validarImportacion([fila(2, 'CAM-001', '1', '7501234567890')], catalogo).ok, true)
  const cruzado = validarImportacion([fila(2, 'CAM-001', '1', '7501234567891')], catalogo)
  assert.equal(cruzado.ok, false)
  assert.match(cruzado.errores[0].mensaje, /son de productos distintos \(«Camiseta» y «Gorra»\)/)
})

test('TODO O NADA: cada fila mala se explica con su número, y con un solo error no se aplica ninguna línea', () => {
  const i = validarImportacion(
    [
      fila(2, 'CAM-001', '10'),
      fila(3, 'NO-EXISTE', '5'),
      fila(4, 'LAV-001', '5'),
      fila(5, 'GOR-001', '10,5'),
      fila(6, 'GOR-001', ''),
      fila(7, null, '5'),
      fila(8, null, '1', '999'),
      fila(9, 'GOR-001', '0'),
      fila(10, 'GOR-001', '-3'),
      fila(11, 'GOR-001', '2.000.000'),
      fila(12, 'GOR-001', '1000001'),
      fila(13, 'CAM-001', '3'),
      fila(14, 'dup-1', '3'),
      fila(15, null, '1', '7.50123E+12'),
    ],
    catalogo
  )
  assert.equal(i.ok, false)
  assert.deepEqual(i.lineas, [], 'no se aplica NADA a medias')
  const porFila = new Map(i.errores.map((e) => [e.fila, e.mensaje]))
  assert.match(porFila.get(3) ?? '', /No existe ningún producto con el SKU «NO-EXISTE»/)
  assert.match(porFila.get(4) ?? '', /«Lavado» no controla inventario/)
  assert.match(porFila.get(5) ?? '', /«10,5» no es un número entero positivo/)
  assert.match(porFila.get(6) ?? '', /Falta la cantidad\. «Gorra» ya aparece en la fila 5/, 'los problemas de UNA fila van juntos')
  assert.match(porFila.get(7) ?? '', /Falta el SKU o el código de barras/)
  assert.match(porFila.get(8) ?? '', /No existe ningún producto con el código de barras «999»/)
  assert.match(porFila.get(9) ?? '', /al menos 1/)
  assert.match(porFila.get(10) ?? '', /no es un número entero positivo/)
  assert.match(porFila.get(11) ?? '', /no es un número entero positivo/)
  assert.match(porFila.get(12) ?? '', /no puede pasar de 1[.,]000[.,]000/)
  assert.match(porFila.get(13) ?? '', /«Camiseta» ya aparece en la fila 2: junta sus cantidades/)
  assert.match(porFila.get(14) ?? '', /dos productos|2 productos que solo se distinguen por mayúsculas/)
  assert.match(porFila.get(15) ?? '', /notación científica: Excel lo convirtió/)
  assert.equal(i.totalErrores, 13)
})

test('una fila repetida no se suma en silencio, y un descontinuado entra pero avisa', () => {
  const rep = validarImportacion([fila(2, 'CAM-001', '1'), fila(3, 'CAM-001', '1')], catalogo)
  assert.equal(rep.ok, false)
  const viejo = validarImportacion([fila(2, 'VIE-001', '5')], catalogo)
  assert.equal(viejo.ok, true)
  assert.match(viejo.avisos[0], /«Viejo» está descontinuado/)
})

test('el tope de filas rechaza el archivo entero con un solo mensaje; los errores listados se acotan pero se cuentan todos', () => {
  const muchas = Array.from({ length: MAX_LINEAS_IMPORTACION + 1 }, (_, i) => fila(i + 2, `X-${i}`, '1'))
  const i = validarImportacion(muchas, catalogo)
  assert.equal(i.ok, false)
  assert.equal(i.totalErrores, 1)
  assert.match(i.errores[0].mensaje, /máximo por archivo es 1000/)
  const todasMalas = Array.from({ length: 500 }, (_, k) => fila(k + 2, `NO-${k}`, '1'))
  const j = validarImportacion(todasMalas, catalogo)
  assert.equal(j.errores.length, MAX_ERRORES_LISTADOS)
  assert.equal(j.totalErrores, 500)
})

test('un archivo sin ninguna línea válida no es aplicable aunque no tenga errores', () => {
  assert.equal(validarImportacion([], catalogo).ok, false)
})

test('la plantilla se lee de vuelta y sus filas de ejemplo se RECHAZAN (no meten existencias de mentira)', () => {
  const t = plantillaImportacionCsv()
  assert.ok(t.startsWith('﻿'), 'con BOM para que Excel respete los acentos')
  const lectura = leerImportacion(t)
  assert.ok(lectura.ok)
  assert.equal(lectura.filas.length, 2)
  const informe = validarImportacion(lectura.filas, catalogo)
  assert.equal(informe.ok, false, 'subir la plantilla sin tocarla no aplica nada')
  assert.equal(informe.totalErrores, 2)
})

test('PROPIEDAD: un archivo bien formado de 1.000 filas se lee y valida completo, sin perder ni inventar filas', () => {
  const variantes = Array.from({ length: MAX_LINEAS_IMPORTACION }, (_, i) => v(`id${i}`, `P-${i}`, `75${String(i).padStart(11, '0')}`, `Producto ${i}`))
  const cat = indexarCatalogo(variantes)
  const texto = ['sku;codigo_de_barras;cantidad', ...variantes.map((x, i) => `${i % 2 ? x.sku.toLowerCase() : x.sku};${i % 3 ? '' : x.barcode};${(i % 9) + 1}`)].join('\r\n') + '\r\n'
  const lectura = leerImportacion(texto)
  assert.ok(lectura.ok)
  assert.equal(lectura.filas.length, MAX_LINEAS_IMPORTACION)
  const informe = validarImportacion(lectura.filas, cat)
  assert.equal(informe.ok, true)
  assert.equal(informe.productos, MAX_LINEAS_IMPORTACION)
  assert.equal(informe.unidades, variantes.reduce((s, _, i) => s + ((i % 9) + 1), 0))
  assert.deepEqual(informe.lineas.map((l) => l.varianteId), variantes.map((x) => x.id), 'en el orden del archivo')
})

// ── Filtros de la lista de entradas ──────────────────────────────────────────

test('la lista de entradas lee su URL con las mismas reglas y la consulta vuelve a dar los mismos filtros', () => {
  const { filtros, cursor } = leerFiltrosEntradas({ sucursal: 'suc_1', desde: '2030-05-10', hasta: '2030-05-01', q: ' ENT-2026 ', tipo: 'SALE', usuario: 'u1' })
  assert.deepEqual(filtros, { sucursalId: 'suc_1', desde: '2030-05-01', hasta: '2030-05-10', q: 'ENT-2026' }, 'el tipo y el usuario no son filtros de entradas')
  assert.equal(cursor, null)
  const vuelta = leerFiltrosEntradas(Object.fromEntries(new URLSearchParams(consultaDeFiltrosEntradas(filtros))))
  assert.deepEqual(vuelta.filtros, filtros)
  assert.equal(consultaDeFiltrosEntradas({}), '')
})

test('el historial nombra el origen de un movimiento de entrada de mercancía', () => {
  assert.equal(describirReferencia('RECEIPT', 'rec_abcdef123456'), 'Entrada de mercancía')
  assert.equal(describirReferencia(null, null), null)
})

test('los topes aprobados no cambian sin querer: 200 líneas por entrada a mano, 1.000 filas por archivo', () => {
  assert.equal(MAX_LINEAS_ENTRADA, 200)
  assert.equal(MAX_LINEAS_IMPORTACION, 1000, 'medido contra el tiempo máximo de la transacción (45 s); subirlo exige repetir la medición')
})

// ── El CSV de una entrada ────────────────────────────────────────────────────

const entradaEjemplo = (sobre: Partial<EntradaParaCsv> = {}): EntradaParaCsv => ({
  numero: 'ENT-2030-000007',
  creadoEn: new Date('2030-01-02T15:04:05.000Z'),
  sucursalNombre: 'Principal',
  origen: 'MANUAL',
  referencia: 'F-1045',
  nota: null,
  usuarioNombre: 'Ana Pérez',
  lineas: 2,
  unidades: 17,
  detalle: [
    { sku: 'GOR-1', barcode: '7501000000001', itemNombre: 'Gorra', nombreVariante: 'Default', esDefault: true, cantidad: 12, existenciaAntes: 0, existenciaDespues: 12 },
    { sku: 'MED-1', barcode: null, itemNombre: 'Medias', nombreVariante: 'Talla M', esDefault: false, cantidad: 5, existenciaAntes: 3, existenciaDespues: 8 },
  ],
  ...sobre,
})

test('el CSV de una entrada lleva el documento y sus líneas, con la hora de la empresa y los números como números', () => {
  const csv = entradaToCsv(entradaEjemplo(), 'America/Santo_Domingo')
  assert.ok(csv.startsWith('\uFEFF'), 'con BOM, para que Excel respete los acentos')
  for (const esperado of ['Entrada de mercancía', 'Número;ENT-2030-000007', 'Fecha y hora;2030-01-02 11:04:05', 'Zona horaria;America/Santo_Domingo', 'Sucursal;Principal', 'Referencia;F-1045', 'Origen;Capturada a mano', 'Registrada por;Ana Pérez', 'Productos;2', 'Unidades;17', 'Líneas']) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
  assert.ok(csv.includes('GOR-1;7501000000001;Gorra;12;0;12'), 'una línea es una fila, con el antes y el después')
  assert.ok(csv.includes('MED-1;;Medias · Talla M;5;3;8'), 'sin código de barras la celda queda vacía; una variante que no es la de siempre se nombra')
  assert.ok(entradaToCsv(entradaEjemplo({ origen: 'CSV' }), 'UTC').includes('Origen;Importada de un archivo CSV'))
  assert.ok(entradaToCsv(entradaEjemplo({ usuarioNombre: null }), 'UTC').includes('Registrada por;Sistema'))
})

test('en el CSV de una entrada, lo que escribe una persona no se ejecuta como fórmula al abrir el archivo', () => {
  const peligro = '=HYPERLINK("http://malo.example","x")'
  const csv = entradaToCsv(
    entradaEjemplo({
      referencia: peligro,
      nota: '+cmd|calc',
      sucursalNombre: '@Sucursal',
      usuarioNombre: '-Ana',
      detalle: [{ sku: '=SKU', barcode: '+7501', itemNombre: '@Gorra', nombreVariante: 'Default', esDefault: true, cantidad: 1, existenciaAntes: 0, existenciaDespues: 1 }],
    }),
    'UTC'
  )
  for (const esperado of ['Referencia;"\'=HYPERLINK(""http://malo.example"",""x"")"', "Nota;'+cmd|calc", "Sucursal;'@Sucursal", "Registrada por;'-Ana", "'=SKU;'+7501;'@Gorra;1;0;1"]) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
  assert.ok(!/(^|;)=HYPERLINK/m.test(csv), 'ninguna celda empieza por =')
})

// ── INV-5a · una línea puede traer lotes ─────────────────────────────────────

test('INV-5a · una línea conserva sus lotes tal como vienen (el servicio los valida: solo él sabe qué productos los llevan)', () => {
  const r = validarLineasEntrada([
    { varianteId: 'a', cantidad: 5, lotes: [{ codigo: 'L-1', vencimiento: '2027-01-31', cantidad: 5 }] },
    { varianteId: 'b', cantidad: 2 },
    { varianteId: 'c', cantidad: 3, lotes: [] },
  ])
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(r.lineas[0].lotes, [{ codigo: 'L-1', vencimiento: '2027-01-31', cantidad: 5 }])
    assert.equal('lotes' in r.lineas[1], false, 'sin lotes, la línea no trae la clave')
    assert.equal('lotes' in r.lineas[2], false, 'una lista vacía tampoco')
    assert.equal(r.unidades, 10)
  }
  const mala = validarLineasEntrada([{ varianteId: 'a', cantidad: 1, lotes: 'L-1' }])
  assert.equal(mala.ok, false)
  assert.equal((mala as { codigo: string }).codigo, 'LOTES_INVALIDOS')
  assert.equal(validarLineasEntrada([{ varianteId: 'a', cantidad: 1, lotes: null }]).ok, true, 'null = sin lotes')
})

test('INV-5a · al fusionar líneas del mismo producto se juntan también sus lotes', () => {
  const f = fusionarLineas([
    { varianteId: 'a', cantidad: 2, lotes: [{ codigo: 'L-1', cantidad: 2 }] },
    { varianteId: 'b', cantidad: 1 },
    { varianteId: 'a', cantidad: 3, costo: '5.0000', lotes: [{ codigo: 'L-1', cantidad: 1 }, { codigo: 'L-2', cantidad: 2 }] },
  ])
  assert.deepEqual(f, [
    { varianteId: 'a', cantidad: 5, costo: '5.0000', lotes: [{ codigo: 'L-1', cantidad: 2 }, { codigo: 'L-1', cantidad: 1 }, { codigo: 'L-2', cantidad: 2 }] },
    { varianteId: 'b', cantidad: 1 },
  ])
})
