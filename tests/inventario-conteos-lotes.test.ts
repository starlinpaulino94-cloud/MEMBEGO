import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { claveDeLinea, compararParaAplicar, etiquetaDeLote, nombreDeLinea, nombreDeLote, ordenarPorDiferencia, repartirEnRondas, resumirVarianza } from '../src/modules/inventory/conteos'
import { indexarCatalogo, leerImportacion, validarImportacion, type VarianteImportable } from '../src/modules/inventory/importacion'
import { conteoToCsv, hojaDeConteoToCsv, type ConteoParaCsv } from '../src/modules/inventory/exportacion'

/**
 * INV-5b3 · CONTEO POR LOTE — las reglas PURAS (llaves de línea, nombres, orden de aplicación, rondas), el CSV de conteo con la columna
 * `lote` (hoja, lectura, validación, informe) y las guardias estáticas (migración, servicio, lecturas, acciones y pantallas). El
 * comportamiento contra PostgreSQL está en `tests/postgres/inventory-conteos-lotes.db.test.ts`.
 *
 * Ejecutar: npm test
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')
const sinComent = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function cuerpoDe(src: string, nombre: string): string {
  const inicio = src.search(new RegExp(`^(export )?(async )?function ${nombre}\\b`, 'm'))
  assert.ok(inicio >= 0, `no encuentro la función ${nombre}`)
  const resto = src.slice(inicio + 10)
  const fin = resto.search(/^(export |async function |function |const |interface |type )/m)
  return src.slice(inicio, fin < 0 ? undefined : inicio + 10 + fin)
}

// ── Las llaves y los nombres ─────────────────────────────────────────────────

test('INV-5b3 · una línea de conteo se identifica por producto y lote; un producto sin lotes sigue siendo solo el producto', () => {
  assert.equal(claveDeLinea('v1', null), 'v1|')
  assert.equal(claveDeLinea('v1', undefined), 'v1|')
  assert.equal(claveDeLinea('v1', 'l1'), 'v1|l1')
  assert.notEqual(claveDeLinea('v1', 'l1'), claveDeLinea('v1', 'l2'), 'dos lotes del mismo producto son dos líneas')
  assert.notEqual(claveDeLinea('v1', 'l1'), claveDeLinea('v1', null), 'el producto sin lote no es el producto en un lote')
  assert.notEqual(claveDeLinea('v1', null), claveDeLinea('v2', null))
})

test('INV-5b3 · cómo se nombra un lote: «SIN LOTE» no lleva fecha, los demás dicen si vencen', () => {
  assert.equal(nombreDeLote('A-1'), 'Lote A-1')
  assert.equal(nombreDeLote('SIN LOTE'), 'SIN LOTE')
  assert.equal(etiquetaDeLote('A-1', '2027-09-01'), 'Lote A-1 · vence 2027-09-01')
  assert.equal(etiquetaDeLote('A-1', null), 'Lote A-1 · no vence')
  assert.equal(etiquetaDeLote('SIN LOTE', null), 'SIN LOTE')
  assert.equal(nombreDeLinea('Crema', null), 'Crema')
  assert.equal(nombreDeLinea('Crema', undefined), 'Crema')
  assert.equal(nombreDeLinea('Crema', 'A-1'), 'Crema · lote A-1')
  assert.equal(nombreDeLinea('Crema', 'SIN LOTE'), 'Crema · SIN LOTE')
})

// ── El orden y las rondas al aplicar ─────────────────────────────────────────

test('INV-5b3 · al aplicar, primero lo que sobra y luego lo que falta; a igual signo, por código de lote', () => {
  const lineas = [
    { delta: -3, loteCodigo: 'B' },
    { delta: 2, loteCodigo: 'Z' },
    { delta: -1, loteCodigo: 'A' },
    { delta: 5, loteCodigo: 'C' },
  ]
  assert.deepEqual([...lineas].sort(compararParaAplicar).map((l) => l.loteCodigo), ['C', 'Z', 'A', 'B'])
  assert.equal(compararParaAplicar({ delta: 1, loteCodigo: 'A' }, { delta: 1, loteCodigo: 'A' }), 0)
  assert.ok(compararParaAplicar({ delta: 1, loteCodigo: null }, { delta: -1, loteCodigo: null }) < 0)
  // Es determinista: el mismo conjunto en otro orden da el mismo orden.
  assert.deepEqual([...lineas].reverse().sort(compararParaAplicar).map((l) => l.loteCodigo), ['C', 'Z', 'A', 'B'])
})

test('INV-5b3 · las rondas nunca repiten un saldo y conservan el orden', () => {
  assert.deepEqual(repartirEnRondas([]), [])
  const items = [
    { nivelId: 'n1', id: 1 },
    { nivelId: 'n2', id: 2 },
    { nivelId: 'n1', id: 3 },
    { nivelId: 'n1', id: 4 },
    { nivelId: 'n2', id: 5 },
  ]
  const rondas = repartirEnRondas(items)
  assert.deepEqual(rondas.map((r) => r.map((x) => x.id)), [[1, 2], [3, 5], [4]])
  for (const r of rondas) assert.equal(new Set(r.map((x) => x.nivelId)).size, r.length, 'un saldo aparece una vez por ronda')
  assert.equal(rondas.flat().length, items.length, 'no se pierde nada')
  // Sin repetidos, una sola ronda.
  assert.equal(repartirEnRondas([{ nivelId: 'a' }, { nivelId: 'b' }]).length, 1)
})

test('INV-5b3 · el informe ordena por diferencia, luego por nombre y, dentro del producto, por lote', () => {
  const l = (nombre: string, lote: string | null, contado: number, esperado: number) => ({ nombre, lote, contado, esperado })
  const orden = ordenarPorDiferencia([l('Crema', 'B', 5, 5), l('Crema', 'A', 5, 5), l('Aceite', null, 5, 5), l('Zapato', 'A', 1, 9)])
  assert.deepEqual(orden.map((x) => `${x.nombre}/${x.lote ?? '-'}`), ['Zapato/A', 'Aceite/-', 'Crema/A', 'Crema/B'])
  // Sin el campo «lote» (productos sin lotes) sigue funcionando.
  const sin = ordenarPorDiferencia([{ nombre: 'B', contado: 1, esperado: 1 }, { nombre: 'A', contado: 1, esperado: 1 }])
  assert.deepEqual(sin.map((x) => x.nombre), ['A', 'B'])
  // El resumen cuenta cada línea (producto y lote) como un renglón.
  const r = resumirVarianza([l('Crema', 'A', 4, 6), l('Crema', 'B', 7, 4), l('Crema', 'C', 3, 3)])
  assert.equal(r.lineas, 3)
  assert.equal(r.faltantes, 1)
  assert.equal(r.sobrantes, 1)
  assert.equal(r.coinciden, 1)
  assert.equal(r.unidadesFaltantes, 2)
  assert.equal(r.unidadesSobrantes, 3)
  assert.equal(r.neto, 1)
})

// ── La hoja y el informe en CSV ──────────────────────────────────────────────

test('INV-5b3 · la hoja en blanco: sin lotes es el archivo de siempre; con lotes gana la columna «lote» y una fila por lote', () => {
  const sin = hojaDeConteoToCsv([{ sku: 'CAM-1', barcode: null, producto: 'Camisa' }])
  assert.ok(sin.includes('sku;codigo_de_barras;producto;contado'))
  assert.ok(!sin.includes('lote'), 'sin productos con lotes, el archivo no cambia')
  assert.equal(hojaDeConteoToCsv([{ sku: 'CAM-1', barcode: null, producto: 'Camisa', lote: null }]), sin, 'un «lote» nulo no cambia nada')

  const con = hojaDeConteoToCsv([
    { sku: 'CAM-1', barcode: null, producto: 'Camisa' },
    { sku: 'CRE-1', barcode: '7501', producto: 'Crema', lote: 'A-1' },
    { sku: 'CRE-1', barcode: '7501', producto: 'Crema', lote: 'SIN LOTE' },
  ])
  assert.ok(con.includes('sku;codigo_de_barras;producto;lote;contado'))
  assert.ok(con.includes('CAM-1;;Camisa;;'), 'el producto sin lotes deja el lote vacío')
  assert.ok(con.includes('CRE-1;7501;Crema;A-1;'))
  assert.ok(con.includes('CRE-1;7501;Crema;SIN LOTE;'))
  // La hoja no trae ninguna cantidad: es a ciegas.
  for (const fila of con.split('\n').slice(1).filter(Boolean)) assert.ok(/;$/.test(fila.trim()), `la celda «contado» va vacía: ${fila}`)
})

test('INV-5b3 · en la hoja, el lote que escribe una persona no se ejecuta como fórmula', () => {
  const csv = hojaDeConteoToCsv([{ sku: 'X', barcode: null, producto: 'Y', lote: '=CMD()' }])
  assert.ok(!/;=CMD/.test(csv), 'se neutraliza')
  assert.ok(csv.includes("'=CMD()"), 'la fórmula queda como texto')
})

const conteoLotes = (sobre: Partial<ConteoParaCsv> = {}): ConteoParaCsv => ({
  numero: 'CNT-2030-000009',
  estado: 'APPLIED',
  sucursalNombre: 'Principal',
  nota: null,
  creadoEn: new Date('2030-01-02T15:04:05.000Z'),
  aplicadoEn: new Date('2030-01-02T18:00:00.000Z'),
  abiertoPorNombre: 'Ana',
  aplicadoPorNombre: 'Luis',
  sinContar: 1,
  detalle: [
    { sku: 'CRE-1', barcode: null, itemNombre: 'Crema', nombreVariante: 'Default', esDefault: true, contado: 4, esperado: 6, existenciaAntes: 6, existenciaDespues: 4, ajustado: true, loteCodigo: 'A-1', loteVencimiento: '2027-09-01' },
    { sku: 'CRE-1', barcode: null, itemNombre: 'Crema', nombreVariante: 'Default', esDefault: true, contado: 7, esperado: 4, existenciaAntes: 4, existenciaDespues: 7, ajustado: true, loteCodigo: 'B-2', loteVencimiento: null },
    { sku: 'CAM-1', barcode: null, itemNombre: 'Camisa', nombreVariante: 'Default', esDefault: true, contado: 5, esperado: 5, existenciaAntes: 5, existenciaDespues: 5, ajustado: false },
  ],
  ...sobre,
})

test('INV-5b3 · el informe de diferencias con lotes trae el lote y su vencimiento; sin lotes es el archivo de siempre', () => {
  const csv = conteoToCsv(conteoLotes(), 'America/Santo_Domingo')
  assert.ok(csv.includes('"De ellos, contados por lote";2'))
  assert.ok(csv.includes('SKU;Codigo de barras;Producto;Lote;Vencimiento del lote;Esperado al contar;Contado;Diferencia;Resultado'))
  assert.ok(csv.includes('CRE-1;;Crema;A-1;2027-09-01;6;4;-2;Faltante;6;4;Si'))
  assert.ok(csv.includes('CRE-1;;Crema;B-2;;4;7;3;Sobrante;4;7;Si'))
  assert.ok(csv.includes('CAM-1;;Camisa;;;5;5;0;Coincide;5;5;No'), 'el producto sin lotes deja las dos columnas vacías')
  // Dos renglones del mismo producto (uno por lote) no se juntan: el resumen los cuenta aparte.
  assert.ok(csv.includes('Productos contados;3'))

  const sinLotes = conteoToCsv(conteoLotes({ detalle: conteoLotes().detalle.filter((l) => !l.loteCodigo) }), 'UTC')
  assert.ok(!sinLotes.includes('Vencimiento del lote'))
  assert.ok(!sinLotes.includes('contados por lote'))
  assert.ok(sinLotes.includes('CAM-1;;Camisa;5;5;0;Coincide;5;5;No'), 'idéntico al formato anterior')
})

test('INV-5b3 · en el informe de diferencias, el lote que escribe una persona no se ejecuta como fórmula', () => {
  const [con] = conteoLotes().detalle
  const csv = conteoToCsv(conteoLotes({ detalle: [{ ...con, loteCodigo: '=CMD()' }] }), 'UTC')
  assert.ok(!/;=CMD/.test(csv), 'se neutraliza')
  assert.ok(csv.includes("'=CMD()"), 'la fórmula queda como texto')
})

// ── La hoja contada: la columna «lote» ───────────────────────────────────────

const v = (id: string, sku: string, nombre: string, extra: Partial<VarianteImportable> = {}): VarianteImportable => ({ id, sku, barcode: null, nombre, controlaInventario: true, descontinuada: false, ...extra })
const catalogo = indexarCatalogo([
  v('v1', 'CAM-1', 'Camisa'),
  v('v2', 'CRE-1', 'Crema', { lotes: new Map([['A-1', 'l-a1'], ['B-2', 'l-b2'], ['SIN LOTE', 'l-sin']]) }),
])

test('INV-5b3 · la columna «lote» se lee en un conteo (y en sus alias) y NO en una entrada', () => {
  for (const encabezado of ['lote', 'Lote', 'codigo_de_lote', 'batch', 'N_LOTE']) {
    const r = leerImportacion(`sku;${encabezado};contado\nCRE-1;A-1;4\n`, 'CONTEO')
    assert.ok(r.ok, encabezado)
    assert.deepEqual(r.filas, [{ fila: 2, sku: 'CRE-1', barcode: null, cantidad: '4', lote: 'A-1' }], encabezado)
  }
  // Sin la columna, las filas no traen el campo (archivo de siempre).
  const sin = leerImportacion('sku;contado\nCAM-1;4\n', 'CONTEO')
  assert.ok(sin.ok)
  assert.deepEqual(sin.filas, [{ fila: 2, sku: 'CAM-1', barcode: null, cantidad: '4' }])
  // Una entrada de mercancía no lee lotes todavía.
  const entrada = leerImportacion('sku;lote;cantidad\nCRE-1;A-1;4\n')
  assert.ok(entrada.ok)
  assert.deepEqual(entrada.filas, [{ fila: 2, sku: 'CRE-1', barcode: null, cantidad: '4' }])
})

test('INV-5b3 · validar un conteo con lotes: un producto con lotes pide su lote y uno sin lotes no lo admite', () => {
  const f = (fila: number, sku: string, cantidad: string, lote?: string) => ({ fila, sku, barcode: null, cantidad, ...(lote === undefined ? {} : { lote }) })
  // Limpio: los lotes se resuelven al id del lote (sin importar mayúsculas) y el producto sin lotes queda sin loteId.
  const ok = validarImportacion([f(2, 'CRE-1', '4', 'a-1'), f(3, 'CRE-1', '3', 'B-2'), f(4, 'CAM-1', '5', '')], catalogo, 'CONTEO')
  assert.equal(ok.ok, true, JSON.stringify(ok.errores))
  assert.deepEqual(ok.lineas, [
    { varianteId: 'v2', cantidad: 4, loteId: 'l-a1' },
    { varianteId: 'v2', cantidad: 3, loteId: 'l-b2' },
    { varianteId: 'v1', cantidad: 5 },
  ])
  assert.deepEqual(ok.vistaPrevia.map((x) => x.lote ?? null), ['A-1', 'B-2', null])
  assert.equal(ok.unidades, 12)
  assert.equal(ok.productos, 3, 'cada producto y lote es una línea')

  const sinLote = validarImportacion([f(2, 'CRE-1', '4', '')], catalogo, 'CONTEO')
  assert.equal(sinLote.ok, false)
  assert.match(sinLote.errores[0].mensaje, /lleva lotes: escribe el lote/)
  const sinColumna = validarImportacion([f(2, 'CRE-1', '4')], catalogo, 'CONTEO')
  assert.equal(sinColumna.ok, false, 'sin la columna, un producto con lotes no se puede contar')
  assert.match(sinColumna.errores[0].mensaje, /lleva lotes/)

  const lotesAjeno = validarImportacion([f(2, 'CAM-1', '4', 'A-1')], catalogo, 'CONTEO')
  assert.equal(lotesAjeno.ok, false)
  assert.match(lotesAjeno.errores[0].mensaje, /no lleva lotes: deja vacía la columna «lote»/)

  const inexistente = validarImportacion([f(2, 'CRE-1', '4', 'Z-9')], catalogo, 'CONTEO')
  assert.equal(inexistente.ok, false)
  assert.match(inexistente.errores[0].mensaje, /El lote «Z-9» no existe en «Crema».*entrada de mercancía/)

  const malEscrito = validarImportacion([f(2, 'CRE-1', '4', 'a'.repeat(80))], catalogo, 'CONTEO')
  assert.equal(malEscrito.ok, false)
  assert.match(malEscrito.errores[0].mensaje, /^Lote «/)
})

test('INV-5b3 · el mismo lote dos veces es un error; el mismo producto en dos lotes, no', () => {
  const f = (fila: number, cantidad: string, lote: string) => ({ fila, sku: 'CRE-1', barcode: null, cantidad, lote })
  const doble = validarImportacion([f(2, '4', 'A-1'), f(3, '1', 'a-1')], catalogo, 'CONTEO')
  assert.equal(doble.ok, false)
  assert.match(doble.errores[0].mensaje, /«Crema» \(lote A-1\) ya aparece en la fila 2/)
  const dos = validarImportacion([f(2, '4', 'A-1'), f(3, '1', 'B-2')], catalogo, 'CONTEO')
  assert.equal(dos.ok, true)
  assert.equal(dos.lineas.length, 2)
  // «SIN LOTE» es un lote como los demás.
  const sin = validarImportacion([f(2, '4', 'sin lote')], catalogo, 'CONTEO')
  assert.equal(sin.ok, true, JSON.stringify(sin.errores))
  assert.equal(sin.lineas[0].loteId, 'l-sin')
  // Una celda de lote en una fila sin contar (vacía) se ignora con la fila.
  const omitida = validarImportacion([{ fila: 2, sku: 'CRE-1', barcode: null, cantidad: '', lote: 'A-1' }], catalogo, 'CONTEO')
  assert.equal(omitida.omitidas, 1)
  assert.equal(omitida.lineas.length, 0)
})

test('INV-5b3 · una entrada de mercancía no mira lotes aunque el catálogo los traiga', () => {
  const r = validarImportacion([{ fila: 2, sku: 'CRE-1', barcode: null, cantidad: '4' }], catalogo)
  assert.equal(r.ok, true)
  assert.deepEqual(r.lineas, [{ varianteId: 'v2', cantidad: 4 }])
})

// ── Guardias estáticas ───────────────────────────────────────────────────────

test('INV-5b3 · la migración 20261069 es aditiva, idempotente y de una sola transacción', () => {
  const sql = leer('prisma/migrations/20261069_inventory_count_lots/migration.sql')
  const codigo = sql.replace(/--.*$/gm, '')
  assert.match(codigo, /^\s*BEGIN;/)
  assert.match(codigo, /COMMIT;\s*$/)
  assert.match(codigo, /SET LOCAL lock_timeout/)
  assert.match(codigo, /ADD COLUMN IF NOT EXISTS "lotId" TEXT;/, 'la columna admite NULL: no reescribe la tabla')
  assert.ok(!/NOT NULL/.test(codigo.split('ADD COLUMN')[1].split(';')[0]), 'la columna nueva no es obligatoria')
  assert.match(codigo, /CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sessionId_catalogVariantId_lotId_key"/)
  assert.match(codigo, /CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sin_lote_key"[\s\S]*WHERE "lotId" IS NULL/, 'sin el parcial, dos NULL no chocan y se contaría dos veces un producto sin lotes')
  assert.match(codigo, /DROP INDEX IF EXISTS "inventory_count_lines_sessionId_catalogVariantId_key"/)
  assert.ok(codigo.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_sin_lote_key"') < codigo.indexOf('DROP INDEX IF EXISTS "inventory_count_lines_sessionId_catalogVariantId_key"'), 'primero los índices nuevos y luego se quita el viejo')
  assert.match(codigo, /FOREIGN KEY \("lotId", "catalogVariantId", "companyId"\) REFERENCES "inventory_lots"\("id", "catalogVariantId", "companyId"\) ON DELETE RESTRICT/, 'el lote es de ese producto y de esa empresa')
  assert.match(codigo, /EXCEPTION WHEN duplicate_object THEN NULL/)
  assert.match(codigo, /CREATE OR REPLACE FUNCTION inventory_count_lines_solo_abierta\(\)[\s\S]*"lotId" IS DISTINCT FROM OLD\."lotId"/, 'una línea no cambia de lote')
  assert.match(codigo, /CREATE OR REPLACE FUNCTION inventory_count_lines_lote_coherente\(\)/)
  assert.match(codigo, /DROP TRIGGER IF EXISTS "inventory_count_lines_lote_coherente"[\s\S]*CREATE TRIGGER "inventory_count_lines_lote_coherente"\s+BEFORE INSERT ON "inventory_count_lines"/)
  for (const prohibido of [/DROP TABLE/i, /DROP COLUMN/i, /TRUNCATE/i, /DELETE FROM/i, /UPDATE "inventory/i]) assert.ok(!prohibido.test(codigo), `no debe contener ${prohibido}`)
})

test('INV-5b3 · el esquema de Prisma refleja la columna, la relación y la llave única nueva', () => {
  const s = leer('prisma/schema/inventario.prisma')
  const linea = s.slice(s.indexOf('model InventoryCountLine'), s.indexOf('}', s.indexOf('model InventoryCountLine')))
  assert.match(linea, /lotId\s+String\?/)
  assert.match(linea, /lot\s+InventoryLot\?\s+@relation\(fields: \[lotId, catalogVariantId, companyId\], references: \[id, catalogVariantId, companyId\]/)
  assert.match(linea, /@@unique\(\[sessionId, catalogVariantId, lotId\]\)/)
  assert.match(linea, /@@index\(\[companyId, lotId\]\)/)
  assert.ok(!/@@unique\(\[sessionId, catalogVariantId\]\)/.test(linea), 'la llave vieja ya no existe')
})

test('INV-5b3 · el servicio cuenta y aplica por lote: ya no niega los productos con lotes ni ajusta sin decir el lote', () => {
  const src = sinComent(leer('src/modules/inventory/service.ts'))
  for (const f of ['registrarConteoProductoEnTx', 'quitarLineaDeConteoEnTx', 'importarConteoEnTx', 'aplicarConteoEnTx']) {
    assert.ok(!/exigirSinLotes\(/.test(cuerpoDe(src, f)), `${f} no debe negar los productos con lotes`)
  }
  assert.match(cuerpoDe(src, 'registrarConteoProductoEnTx'), /loteDeLineaDeConteo\(/)
  assert.match(cuerpoDe(src, 'loteDeLineaDeConteo'), /LOTES_FALTAN/, 'un producto con lotes se cuenta diciendo el lote')
  assert.match(cuerpoDe(src, 'importarConteoEnTx'), /LOTES_FALTAN/, 'y lo mismo al importar')
  // Como toda operación sobre un saldo, contar toma el candado COMPARTIDO de lotes (activar los lotes de un producto toma el exclusivo).
  for (const f of ['registrarConteoProductoEnTx', 'importarConteoEnTx']) assert.match(cuerpoDe(src, f), /candadoDeLotes\(tx, companyId, false\)/, `${f} toma el candado compartido de lotes`)
  const aplicar = cuerpoDe(src, 'aplicarConteoEnTx')
  assert.match(aplicar, /repartirEnRondas\(/, 'los ajustes de un mismo saldo van en rondas distintas')
  assert.match(aplicar, /escribirMovimientosPorLote\(/, 'cada ajuste lleva el reparto de su lote')
  assert.match(aplicar, /compararParaAplicar/)
  // El conteo suelto de la ficha (un solo número para todo el producto) sigue negado con un aviso que apunta a «Conteos».
  assert.match(cuerpoDe(src, 'contarEnTx'), /exigirSinLotes\([\s\S]*?'el conteo suelto'[\s\S]*?Conteos/)
})

test('INV-5b3 · las lecturas del conteo devuelven el lote, siguen a ciegas y las acciones lo reciben validado', () => {
  const q = sinComent(leer('src/modules/inventory/queries.ts'))
  assert.match(q, /export interface LoteParaContar/)
  const cuerpoLotes = cuerpoDe(q, 'lotesParaContarEnTx')
  assert.ok(!/onHand|reserved|damaged/.test(cuerpoLotes.replace(/b\."onHand" > 0/g, '')), 'la lista de lotes para contar no trae cantidades del sistema (conteo a ciegas)')
  assert.match(cuerpoDe(q, 'porContarEnTx'), /inventory_lot_balances/, 'lo que falta por contar incluye los lotes con existencias')
  assert.match(cuerpoDe(q, 'hojaDeConteoEnTx'), /inventory_lot_balances/)
  const a = sinComent(leer('src/modules/inventory/actions.ts'))
  assert.match(cuerpoDe(a, 'contarProductoEnConteo'), /loteId: clave\(entrada\.loteId\)/, 'contar pasa el lote al servicio')
  assert.match(cuerpoDe(a, 'quitarProductoDelConteo'), /loteId: clave\(entrada\.loteId\)/, 'quitar pasa el lote al servicio')
  assert.match(a, /export async function lotesParaContarProducto/)
  assert.match(cuerpoDe(a, 'lotesParaContarProducto'), /contexto\('ajustar'\)/, 'la lista de lotes exige el mismo permiso que contar')
})

test('INV-5b3 · las pantallas del conteo distinguen las líneas por producto y lote', () => {
  const informe = leer('src/components/inventario/InformeDiferencias.tsx')
  assert.match(informe, /claveDeLinea\(l\.varianteId, l\.loteId\)/)
  assert.match(informe, /key=\{clave\}/, 'dos lotes del mismo producto no comparten llave de React')
  assert.match(informe, /bloqueos\?\.get\(clave\)/, 'el bloqueo se busca por producto y lote')
  assert.match(informe, /etiquetaDeLote\(l\.loteCodigo, l\.loteVencimiento\)/, 'cada fila dice su lote y cuándo vence')
  const revisar = leer('src/app/(admin)/admin/inventario/conteos/[id]/revisar/page.tsx')
  assert.match(revisar, /saldos\.get\(clave\)/, 'el saldo actual se busca por producto y lote')
  const captura = leer('src/components/inventario/CapturaConteo.tsx')
  assert.match(captura, /lotesParaContarProducto/)
  assert.match(captura, /Lotes para contar/)
  assert.match(captura, /loteId: lote\.loteId, cantidad: unidades, modo: 'SUMAR'/, 'cada clic cuenta EN el lote elegido')
  const fila = leer('src/components/inventario/FilaConteoEditable.tsx')
  assert.equal((fila.match(/loteId: p\.loteId \?\? null/g) ?? []).length, 2, 'corregir y quitar mandan el lote de la línea')
})
