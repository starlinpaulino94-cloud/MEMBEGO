import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETIQUETA_ESTADO_CONTEO,
  MAX_LINEAS_CONTEO,
  clasificarDiferencia,
  diferenciaDeConteo,
  esEstadoConteo,
  esModoConteo,
  motivoDeConteo,
  ordenarPorDiferencia,
  planDeAjuste,
  resumirVarianza,
  validarCantidadContada,
} from '../src/modules/inventory/conteos'
import { CANTIDAD_MAXIMA, EXISTENCIA_MAXIMA } from '../src/modules/inventory/domain'
import { indexarCatalogo, leerImportacion, validarImportacion, type VarianteImportable } from '../src/modules/inventory/importacion'
import { conteoToCsv, hojaDeConteoToCsv, type ConteoParaCsv } from '../src/modules/inventory/exportacion'
import { consultaDeFiltrosConteos, leerFiltrosConteos } from '../src/modules/inventory/filtros'
import { describirReferencia } from '../src/modules/inventory/formato'

/**
 * COMMERCE CORE · inventario — INV-2b: las reglas PURAS del conteo físico, de su
 * importación CSV y de sus archivos. Sin base de datos: el comportamiento contra
 * PostgreSQL está en `tests/postgres/inventory-conteos.db.test.ts`.
 */

// ── Lo que se captura ────────────────────────────────────────────────────────

test('lo contado es un entero de 0 a un millón; sumar exige al menos una unidad y fijar admite cero', () => {
  const ok = (n: unknown, modo: 'SUMAR' | 'FIJAR') => validarCantidadContada(n, modo)
  assert.deepEqual(ok(0, 'FIJAR'), { ok: true, valor: 0 })
  assert.deepEqual(ok(7, 'SUMAR'), { ok: true, valor: 7 })
  assert.deepEqual(ok(CANTIDAD_MAXIMA, 'FIJAR'), { ok: true, valor: CANTIDAD_MAXIMA })
  for (const malo of [-1, 1.5, Number.NaN, Infinity, '3', null, undefined, CANTIDAD_MAXIMA + 1]) assert.equal(ok(malo, 'FIJAR').ok, false, String(malo))
  assert.equal(ok(0, 'SUMAR').ok, false, 'sumar cero no es un escaneo')
  assert.equal(ok(-2, 'SUMAR').ok, false)
  assert.ok(esModoConteo('SUMAR') && esModoConteo('FIJAR') && !esModoConteo('otro') && !esModoConteo(undefined))
  assert.ok(esEstadoConteo('OPEN') && esEstadoConteo('APPLIED') && esEstadoConteo('CANCELLED') && !esEstadoConteo('DRAFT'))
  assert.equal(MAX_LINEAS_CONTEO, 1000, 'medido contra el tiempo máximo de la transacción (45 s); subirlo exige repetir la medición')
})

// ── Diferencia y resumen ─────────────────────────────────────────────────────

test('la diferencia es contado menos esperado: positiva sobra, negativa falta, cero coincide', () => {
  assert.equal(diferenciaDeConteo(8, 10), -2)
  assert.equal(diferenciaDeConteo(23, 20), 3)
  assert.equal(diferenciaDeConteo(5, 5), 0)
  assert.deepEqual([clasificarDiferencia(-2), clasificarDiferencia(3), clasificarDiferencia(0)], ['FALTANTE', 'SOBRANTE', 'COINCIDE'])
})

test('el resumen cuenta líneas y unidades por separado y el neto es sobrantes menos faltantes', () => {
  const r = resumirVarianza([
    { contado: 8, esperado: 10 },
    { contado: 23, esperado: 20 },
    { contado: 5, esperado: 5 },
    { contado: 0, esperado: 4 },
  ])
  assert.deepEqual(r, { lineas: 4, coinciden: 1, sobrantes: 1, faltantes: 2, unidadesSobrantes: 3, unidadesFaltantes: 6, neto: -3 })
  assert.deepEqual(resumirVarianza([]), { lineas: 0, coinciden: 0, sobrantes: 0, faltantes: 0, unidadesSobrantes: 0, unidadesFaltantes: 0, neto: 0 })
})

test('el informe pone primero lo que más descuadra, sin importar el signo, y a igualdad ordena por nombre', () => {
  const orden = ordenarPorDiferencia([
    { nombre: 'Zapato', contado: 5, esperado: 5 },
    { nombre: 'Camisa', contado: 9, esperado: 10 },
    { nombre: 'Gorra', contado: 14, esperado: 10 },
    { nombre: 'Abrigo', contado: 11, esperado: 10 },
  ]).map((x) => x.nombre)
  assert.deepEqual(orden, ['Gorra', 'Abrigo', 'Camisa', 'Zapato'])
})

// ── El ajuste de una línea ───────────────────────────────────────────────────

test('sin diferencia no hay ajuste; un sobrante sube lo vendible y un faltante lo baja, siempre como AJUSTE con el número del conteo', () => {
  const saldo = { onHand: 10, reserved: 0, damaged: 0 }
  const motivo = motivoDeConteo('CNT-2030-000001')
  assert.equal(motivo, 'Conteo físico CNT-2030-000001')
  assert.deepEqual(planDeAjuste(0, saldo, motivo), { tipo: 'NADA' })
  assert.deepEqual(planDeAjuste(3, saldo, motivo), { tipo: 'AJUSTE', movimiento: { type: 'ADJUSTMENT', sourceBucket: null, destinationBucket: 'AVAILABLE', quantity: 3, reason: motivo } })
  assert.deepEqual(planDeAjuste(-4, saldo, motivo), { tipo: 'AJUSTE', movimiento: { type: 'ADJUSTMENT', sourceBucket: 'AVAILABLE', destinationBucket: null, quantity: 4, reason: motivo } })
  assert.deepEqual(planDeAjuste(-10, saldo, motivo).tipo, 'AJUSTE', 'vaciar todo lo vendible se puede')
})

test('un faltante que dejaría menos de lo apartado se RECHAZA con el porqué; lo apartado cuenta como existencia pero no se vende', () => {
  const saldo = { onHand: 10, reserved: 6, damaged: 0 }
  const r = planDeAjuste(-5, saldo, 'x')
  assert.equal(r.tipo, 'RECHAZADA')
  if (r.tipo === 'RECHAZADA') {
    assert.match(r.motivo, /menos de lo apartado/)
    assert.match(r.motivo, /hay 10 y 6 están apartadas/)
    assert.match(r.motivo, /vendible: 4/)
  }
  assert.equal(planDeAjuste(-4, saldo, 'x').tipo, 'AJUSTE', 'hasta lo vendible, sí')
  assert.equal(planDeAjuste(5, saldo, 'x').tipo, 'AJUSTE', 'un sobrante nunca choca con lo apartado')
})

test('los topes: un ajuste no pasa de un millón de unidades ni la existencia del máximo admitido', () => {
  const muchas = planDeAjuste(-(CANTIDAD_MAXIMA + 1), { onHand: EXISTENCIA_MAXIMA, reserved: 0, damaged: 0 }, 'x')
  assert.equal(muchas.tipo, 'RECHAZADA')
  const tope = planDeAjuste(5, { onHand: EXISTENCIA_MAXIMA - 2, reserved: 0, damaged: 0 }, 'x')
  assert.equal(tope.tipo, 'RECHAZADA')
  if (tope.tipo === 'RECHAZADA') assert.match(tope.motivo, /máximo admitido/)
})

// ── Importar lo contado ──────────────────────────────────────────────────────

const v = (id: string, sku: string, barcode: string | null, nombre: string, extra: Partial<VarianteImportable> = {}): VarianteImportable => ({ id, sku, barcode, nombre, controlaInventario: true, descontinuada: false, ...extra })
const catalogo = indexarCatalogo([v('v1', 'CAM-001', '7501234567890', 'Camiseta'), v('v2', 'GOR-001', '7501234567891', 'Gorra'), v('v3', 'LAV-001', null, 'Lavado', { controlaInventario: false }), v('v4', '=RARO', null, 'Con signo')])

test('la hoja contada se lee con el encabezado «contado» (o sus alias) y no con «cantidad» solo en las entradas', () => {
  for (const encabezado of ['contado', 'Conteo', 'cantidad_contada', 'Cantidad']) {
    const r = leerImportacion(`sku;${encabezado}\nCAM-001;4\n`, 'CONTEO')
    assert.ok(r.ok, encabezado)
    assert.deepEqual(r.filas, [{ fila: 2, sku: 'CAM-001', barcode: null, cantidad: '4' }])
  }
  const sinColumna = leerImportacion('sku;otra\nCAM-001;4\n', 'CONTEO')
  assert.equal(sinColumna.ok, false)
  if (!sinColumna.ok) assert.match(sinColumna.error, /«contado»/)
  assert.equal(leerImportacion('sku;contado\nCAM-001;4\n', 'ENTRADA').ok, false, 'una hoja de conteo no es una entrada de mercancía')
  const entrada = leerImportacion('sku;cantidad\nCAM-001;4\n')
  assert.ok(entrada.ok, 'el modo por defecto sigue siendo el de las entradas')
})

test('en un conteo la celda vacía es «no se contó» (no un error) y el cero es un dato; en una entrada el cero sigue siendo un error', () => {
  const filas = [
    { fila: 2, sku: 'CAM-001', barcode: null, cantidad: '4' },
    { fila: 3, sku: 'GOR-001', barcode: null, cantidad: '' },
    { fila: 4, sku: null, barcode: '7501234567891', cantidad: '0' },
  ]
  const i = validarImportacion(filas, catalogo, 'CONTEO')
  assert.equal(i.ok, true)
  assert.equal(i.omitidas, 1)
  assert.deepEqual(i.lineas, [{ varianteId: 'v1', cantidad: 4 }, { varianteId: 'v2', cantidad: 0 }])
  assert.equal(i.unidades, 4)
  const comoEntrada = validarImportacion(filas, catalogo)
  assert.equal(comoEntrada.ok, false)
  assert.equal(comoEntrada.omitidas, undefined, 'solo un conteo informa de omitidas')
  assert.ok(comoEntrada.errores.some((e) => /Falta la cantidad/.test(e.mensaje)))
  assert.ok(comoEntrada.errores.some((e) => /al menos 1/.test(e.mensaje)))
})

test('un archivo de conteo con un solo error no aplica nada; el mensaje de enteros habla de «cero en adelante»', () => {
  const i = validarImportacion(
    [
      { fila: 2, sku: 'CAM-001', barcode: null, cantidad: '4' },
      { fila: 3, sku: 'NO-EXISTE', barcode: null, cantidad: '2' },
      { fila: 4, sku: 'GOR-001', barcode: null, cantidad: '1,5' },
      { fila: 5, sku: 'LAV-001', barcode: null, cantidad: '1' },
      { fila: 6, sku: 'CAM-001', barcode: null, cantidad: '9' },
    ],
    catalogo,
    'CONTEO'
  )
  assert.equal(i.ok, false)
  assert.deepEqual(i.lineas, [], 'con un error no sale ninguna línea')
  assert.equal(i.totalErrores, 4)
  assert.match(i.errores.find((e) => e.fila === 3)!.mensaje, /No existe ningún producto con el SKU «NO-EXISTE»/)
  assert.match(i.errores.find((e) => e.fila === 4)!.mensaje, /entero de cero en adelante/)
  assert.match(i.errores.find((e) => e.fila === 5)!.mensaje, /no controla inventario/)
  assert.match(i.errores.find((e) => e.fila === 6)!.mensaje, /ya aparece en la fila 2/)
})

test('la hoja en blanco trae miles de filas y solo cuentan las que tienen algo contado: el tope se mide sobre esas', () => {
  const muchas = Array.from({ length: 5000 }, (_, i) => ({ fila: i + 2, sku: 'CAM-001', barcode: null, cantidad: i < 300 ? '1' : '' }))
  // Todas apuntan al mismo SKU: lo que se mide aquí es el tope, así que se usa una sola fila con valor para no chocar con duplicados.
  const una = muchas.map((f, i) => (i === 0 ? f : { ...f, cantidad: '' }))
  const i = validarImportacion(una, catalogo, 'CONTEO')
  assert.equal(i.ok, true)
  assert.equal(i.omitidas, 4999)
  const demasiadas = Array.from({ length: 1001 }, (_, k) => ({ fila: k + 2, sku: `S${k}`, barcode: null, cantidad: '1' }))
  const rechazado = validarImportacion(demasiadas, catalogo, 'CONTEO')
  assert.equal(rechazado.ok, false)
  assert.equal(rechazado.totalErrores, 1)
  assert.match(rechazado.errores[0].mensaje, /1001 filas con algo contado y el máximo por archivo es 1000/)
  const mismoSinValor = validarImportacion(demasiadas.map((f) => ({ ...f, cantidad: '' })), catalogo, 'CONTEO')
  assert.equal(mismoSinValor.omitidas, 1001, 'mil y una filas vacías no son mil y una líneas')
})

test('el apóstrofo con que la hoja neutraliza un SKU raro se quita al leerla de vuelta, así el SKU es el del catálogo', () => {
  const hoja = hojaDeConteoToCsv([{ sku: '=RARO', barcode: null, producto: 'Con signo' }])
  assert.ok(hoja.includes("'=RARO"), 'la hoja no lleva una fórmula')
  const lectura = leerImportacion(hoja.replace(/;$/, ';3'), 'CONTEO')
  assert.ok(lectura.ok)
  assert.equal(lectura.filas[0].sku, '=RARO')
  const i = validarImportacion(lectura.filas, catalogo, 'CONTEO')
  assert.equal(i.ok, true)
  assert.deepEqual(i.lineas, [{ varianteId: 'v4', cantidad: 3 }])
})

// ── Los archivos ─────────────────────────────────────────────────────────────

test('la hoja de conteo en blanco lleva SKU, código y nombre —nunca cuántos hay— y una columna «contado» vacía que la importación entiende', () => {
  const csv = hojaDeConteoToCsv([
    { sku: 'CAM-001', barcode: '7501234567890', producto: 'Camiseta · M' },
    { sku: 'GOR-001', barcode: null, producto: '=HYPERLINK("http://malo.example")' },
  ])
  const lineas = csv.replace('﻿', '').split('\n')
  assert.equal(lineas[0], 'sku;codigo_de_barras;producto;contado')
  assert.equal(lineas[1], 'CAM-001;7501234567890;Camiseta · M;')
  assert.ok(lineas[2].startsWith('GOR-001;;"\'=HYPERLINK'), 'el nombre de un producto no se ejecuta como fórmula')
  assert.doesNotMatch(csv, /existencia|esperad|disponible/i)
  const leida = leerImportacion(csv, 'CONTEO')
  assert.ok(leida.ok, 'lo que se descarga es lo que se sube')
  const informe = validarImportacion(leida.filas, indexarCatalogo([v('v1', 'CAM-001', '7501234567890', 'Camiseta'), v('v2', 'GOR-001', null, 'Gorra')]), 'CONTEO')
  assert.equal(informe.omitidas, 2, 'sin llenar «contado», ninguna fila cuenta')
  assert.equal(informe.ok, false)
})

const conteoEjemplo = (sobre: Partial<ConteoParaCsv> = {}): ConteoParaCsv => ({
  numero: 'CNT-2030-000003',
  estado: 'APPLIED',
  sucursalNombre: 'Principal',
  nota: 'Cierre de mes',
  creadoEn: new Date('2030-01-02T15:04:05.000Z'),
  aplicadoEn: new Date('2030-01-02T18:00:00.000Z'),
  abiertoPorNombre: 'Ana Pérez',
  aplicadoPorNombre: 'Luis Gómez',
  sinContar: 4,
  detalle: [
    { sku: 'GOR-1', barcode: null, itemNombre: 'Gorra', nombreVariante: 'Default', esDefault: true, contado: 11, esperado: 10, existenciaAntes: 10, existenciaDespues: 11, ajustado: true },
    { sku: 'MED-1', barcode: '7501', itemNombre: 'Medias', nombreVariante: 'Talla M', esDefault: false, contado: 2, esperado: 9, existenciaAntes: 7, existenciaDespues: 0, ajustado: true },
    { sku: 'CAM-1', barcode: null, itemNombre: 'Camisa', nombreVariante: 'Default', esDefault: true, contado: 5, esperado: 5, existenciaAntes: 5, existenciaDespues: 5, ajustado: false },
  ],
  ...sobre,
})

test('el informe de diferencias lleva el encabezado, el resumen y las líneas de lo que más descuadra a lo que menos', () => {
  const csv = conteoToCsv(conteoEjemplo(), 'America/Santo_Domingo')
  assert.ok(csv.startsWith('﻿'))
  for (const esperado of [
    'Número;CNT-2030-000003',
    'Estado;Aplicado',
    'Sucursal;Principal',
    'Abierto;2030-01-02 11:04:05',
    'Aplicado;2030-01-02 14:00:00',
    'Aplicado por;Luis Gómez',
    'Productos contados;3',
    'Coinciden;1',
    'Unidades sobrantes;1',
    'Unidades faltantes;7',
    'Con existencias y sin contar;4',
  ]) {
    assert.ok(csv.includes(esperado), `falta «${esperado}»`)
  }
  const diferencias = csv.slice(csv.indexOf('Diferencias'))
  const orden = ['MED-1', 'GOR-1', 'CAM-1'].map((s) => diferencias.indexOf(s))
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'de más a menos descuadre')
  assert.ok(diferencias.includes('MED-1;7501;Medias · Talla M;9;2;-7;Faltante;7;0;Si'))
  assert.ok(diferencias.includes('CAM-1;;Camisa;5;5;0;Coincide;5;5;No'))
})

test('un conteo que no se aplicó no inventa existencias de antes y después, y un informe a ciegas no se puede armar', () => {
  const abierto = conteoToCsv(conteoEjemplo({ estado: 'OPEN', aplicadoEn: null, aplicadoPorNombre: null, sinContar: null, detalle: conteoEjemplo().detalle.map((l) => ({ ...l, existenciaAntes: null, existenciaDespues: null, ajustado: false })) }), 'UTC')
  assert.ok(abierto.includes('Estado;Abierto'))
  assert.ok(abierto.includes('GOR-1;;Gorra;10;11;1;Sobrante;;;'), 'sin antes ni después ni «ajustado»')
  assert.throws(() => conteoToCsv(conteoEjemplo({ detalle: [{ ...conteoEjemplo().detalle[0], esperado: null }] }), 'UTC'), /a ciegas/)
})

test('en el informe de un conteo, lo que escribe una persona no se ejecuta como fórmula al abrir el archivo', () => {
  const csv = conteoToCsv(
    conteoEjemplo({
      nota: '=1+1',
      sucursalNombre: '@Sucursal',
      abiertoPorNombre: '-Ana',
      detalle: [{ sku: '+SKU', barcode: '=7501', itemNombre: '@Gorra', nombreVariante: 'Default', esDefault: true, contado: 1, esperado: 0, existenciaAntes: 0, existenciaDespues: 1, ajustado: true }],
    }),
    'UTC'
  )
  for (const esperado of ["Nota;'=1+1", "Sucursal;'@Sucursal", "Abierto por;'-Ana", "'+SKU;'=7501;'@Gorra;0;1;1"]) assert.ok(csv.includes(esperado), `falta «${esperado}»`)
})

// ── Filtros, etiquetas y vocabulario ─────────────────────────────────────────

test('la lista de conteos lee su URL con las mismas reglas y vuelve a dar los mismos filtros; un estado inventado se ignora', () => {
  const { filtros, cursor } = leerFiltrosConteos({ sucursal: 'suc_1', estado: 'APPLIED', desde: '2030-05-10', hasta: '2030-05-01', q: ' CNT-2030 ', tipo: 'SALE', usuario: 'u1' })
  assert.deepEqual(filtros, { sucursalId: 'suc_1', estado: 'APPLIED', desde: '2030-05-01', hasta: '2030-05-10', q: 'CNT-2030' })
  assert.equal(cursor, null)
  const vuelta = leerFiltrosConteos(Object.fromEntries(new URLSearchParams(consultaDeFiltrosConteos(filtros))))
  assert.deepEqual(vuelta.filtros, filtros)
  assert.equal(consultaDeFiltrosConteos({}), '')
  assert.equal(leerFiltrosConteos({ estado: 'DRAFT' }).filtros.estado, undefined)
  assert.equal(leerFiltrosConteos({ estado: ['OPEN', 'APPLIED'] }).filtros.estado, 'OPEN')
})

test('los estados y el historial hablan el mismo idioma: Abierto/Aplicado/Cancelado y «Conteo físico» como origen de un movimiento', () => {
  assert.deepEqual(ETIQUETA_ESTADO_CONTEO, { OPEN: 'Abierto', APPLIED: 'Aplicado', CANCELLED: 'Cancelado' })
  assert.equal(describirReferencia('STOCK_COUNT', 'cnt_abc'), 'Conteo físico')
})
