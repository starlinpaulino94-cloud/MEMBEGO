import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIPOS_DE_MOVIMIENTO } from '../src/modules/inventory/domain'
import {
  LARGO_MAXIMO_BUSQUEDA,
  USUARIO_SISTEMA,
  armarCursor,
  consultaDeFiltros,
  cuantosFiltros,
  esCodigoExacto,
  fechaValida,
  leerCursor,
  leerFiltrosMovimientos,
} from '../src/modules/inventory/filtros'
import { TOPE_FILAS_MOVIMIENTOS, fechaHoraCsv, movimientosToCsv, textoCsv, type FilaExportada } from '../src/modules/inventory/exportacion'
import { advertenciaEstadoManual } from '../src/modules/inventory/formato'
import { rangoDeFechas } from '../src/modules/inventory/queries'

/**
 * COMMERCE CORE · inventario — INV-1 (visibilidad): filtros de la URL, exportación
 * a CSV, advertencia del estado manual y rango de fechas por zona horaria.
 *
 * Todo PURO: sin base de datos. El comportamiento contra PostgreSQL de estas
 * mismas piezas está en `tests/postgres/inventory.db.test.ts` (pruebas 38 a 42).
 */

// ── Filtros de la URL ────────────────────────────────────────────────────────

test('la URL se lee como texto libre: solo pasa lo que tiene forma válida', () => {
  const { filtros, cursor } = leerFiltrosMovimientos({
    tipo: 'SALE',
    sucursal: 'suc_1',
    usuario: USUARIO_SISTEMA,
    desde: '2030-03-01',
    hasta: '2030-03-31',
    q: '  zapato  ',
  })
  assert.deepEqual(filtros, { tipo: 'SALE', sucursalId: 'suc_1', usuario: USUARIO_SISTEMA, desde: '2030-03-01', hasta: '2030-03-31', q: 'zapato' })
  assert.equal(cursor, null)
})

test('un tipo que no existe, una fecha imposible o un id con espacios se descartan sin error', () => {
  const { filtros } = leerFiltrosMovimientos({ tipo: 'DROP TABLE', desde: '2030-02-31', hasta: '31/12/2030', sucursal: 'a b', usuario: '   ' })
  assert.deepEqual(filtros, {})
  assert.equal(fechaValida('2030-02-28'), '2030-02-28')
  assert.equal(fechaValida('2030-02-30'), undefined, 'el 30 de febrero no existe')
  assert.equal(fechaValida('2028-02-29'), '2028-02-29', 'pero 2028 es bisiesto')
  assert.equal(fechaValida('2030-13-01'), undefined)
  assert.equal(fechaValida(undefined), undefined)
})

test('cada uno de los nueve tipos de movimiento es un filtro válido', () => {
  for (const t of TIPOS_DE_MOVIMIENTO) assert.equal(leerFiltrosMovimientos({ tipo: t }).filtros.tipo, t)
})

test('un rango al revés se lee en el orden correcto, y un parámetro repetido toma el primero', () => {
  assert.deepEqual(leerFiltrosMovimientos({ desde: '2030-05-10', hasta: '2030-05-01' }).filtros, { desde: '2030-05-01', hasta: '2030-05-10' })
  assert.equal(leerFiltrosMovimientos({ q: ['uno', 'dos'] }).filtros.q, 'uno')
})

test('la búsqueda se acota en largo', () => {
  assert.equal(leerFiltrosMovimientos({ q: 'x'.repeat(500) }).filtros.q?.length, LARGO_MAXIMO_BUSQUEDA)
  assert.equal(leerFiltrosMovimientos({ q: '   ' }).filtros.q, undefined)
})

test('el cursor se arma y se lee; uno roto no se acepta', () => {
  const t = new Date('2030-01-01T10:00:00.000Z')
  const c = armarCursor(t, 'mov_1')
  assert.deepEqual(leerCursor(c), { creadoEn: t, id: 'mov_1' })
  for (const mal of [null, undefined, '', 'sinbarra', 'fecha-mala|id', `${t.toISOString()}|`, `${t.toISOString()}|${'i'.repeat(200)}`]) assert.equal(leerCursor(mal), null, String(mal))
  assert.equal(leerFiltrosMovimientos({ cursor: c }).cursor, c)
  assert.equal(leerFiltrosMovimientos({ cursor: 'basura' }).cursor, null)
})

test('PROPIEDAD: la consulta que arma la pantalla se lee de vuelta como los mismos filtros (el CSV exporta lo que se ve)', () => {
  const f = { tipo: 'DAMAGE' as const, sucursalId: 'suc_9', usuario: 'user_7', desde: '2030-01-01', hasta: '2030-12-31', q: 'caja & tapa=1' }
  assert.deepEqual(leerFiltrosMovimientos(Object.fromEntries(new URLSearchParams(consultaDeFiltros(f)))).filtros, f)
  assert.equal(consultaDeFiltros({}), '')
  assert.equal(new URLSearchParams(consultaDeFiltros({}, 'c|1')).get('cursor'), 'c|1')
  assert.equal(cuantosFiltros({}), 0)
  assert.equal(cuantosFiltros(f), 6)
})

test('lector de código de barras: solo salta a la ficha una coincidencia EXACTA de SKU o código', () => {
  const v = { sku: 'CAM-001', barcode: '7501234567890' }
  assert.equal(esCodigoExacto('7501234567890', v), true)
  assert.equal(esCodigoExacto('cam-001', v), true, 'sin importar mayúsculas')
  assert.equal(esCodigoExacto('  CAM-001 ', v), true, 'ni espacios alrededor')
  assert.equal(esCodigoExacto('CAM', v), false, 'un fragmento no')
  assert.equal(esCodigoExacto('750123456789', v), false)
  assert.equal(esCodigoExacto('', v), false)
  assert.equal(esCodigoExacto(undefined, v), false)
  assert.equal(esCodigoExacto('7501234567890', { sku: 'X', barcode: null }), false, 'una variante sin código no coincide con nada raro')
})

// ── Exportación a CSV ────────────────────────────────────────────────────────

const fila = (sobre: Partial<FilaExportada> = {}): FilaExportada => ({
  creadoEn: new Date('2030-01-01T10:00:00.000Z'),
  sucursal: 'Principal',
  producto: 'Camiseta · Grande',
  sku: 'CAM-001',
  tipo: 'PURCHASE',
  cantidad: 10,
  efecto: 10,
  existenciaAntes: 0,
  existenciaDespues: 10,
  motivo: 'Factura 123',
  usuario: 'Ana',
  referenciaTipo: null,
  referenciaId: null,
  ...sobre,
})
const contexto = { zonaHoraria: 'America/Santo_Domingo', generadoEn: new Date('2030-01-02T15:00:00.000Z'), filtros: [] as Array<readonly [string, string]>, truncado: false, tope: TOPE_FILAS_MOVIMIENTOS }

test('un texto que Excel evaluaría como fórmula se entrecomilla; un número se queda número', () => {
  for (const peligro of ['=1+1', '+SUM(A1)', '-2+3', '@SUMA(A1)', '\tx', '\rx']) assert.equal(textoCsv(peligro), `'${peligro}`, JSON.stringify(peligro))
  assert.equal(textoCsv('Factura 123'), 'Factura 123')
  assert.equal(textoCsv(null), '')
  assert.equal(textoCsv(''), '')
  const csv = movimientosToCsv([fila({ efecto: -3, tipo: 'ADJUSTMENT', motivo: '=HYPERLINK("http://malo.example","x")' })], contexto)
  assert.match(csv, /'=HYPERLINK\(""http:\/\/malo\.example"",""x""\)/, 'el motivo de una persona no se ejecuta al abrir el archivo')
  assert.ok(csv.includes(';-3;'), 'el efecto es un número, no un texto: sigue sumándose en la hoja')
})

test('el archivo dice de qué es: bloque de alcance, zona horaria, filtros y si está completo', () => {
  const csv = movimientosToCsv([fila()], { ...contexto, filtros: [['Movimiento', 'Venta'], ['Sucursal', 'Principal']] })
  assert.ok(csv.startsWith('﻿'), 'con BOM, para que Excel respete los acentos')
  assert.match(csv, /Alcance de la exportación/)
  assert.match(csv, /Zona horaria;America\/Santo_Domingo/)
  assert.match(csv, /Movimiento;Venta/)
  assert.match(csv, /Sucursal;Principal/)
  assert.match(csv, /Filas exportadas;1/)
  assert.match(csv, /Datos completos;Si/)
  assert.match(movimientosToCsv([], contexto), /Filtros;Ninguno \(todos los movimientos\)/)
})

test('si el tope cortó el resultado, el archivo lo dice y no calla', () => {
  const csv = movimientosToCsv([fila()], { ...contexto, truncado: true })
  assert.match(csv, /Datos completos;NO - el archivo se cortó en 5000 filas/)
  assert.equal(TOPE_FILAS_MOVIMIENTOS, 5000)
})

test('las filas salen con fecha y hora de la ZONA DE LA EMPRESA, tipo en palabras y «Sistema» cuando no hubo persona', () => {
  const csv = movimientosToCsv([fila({ tipo: 'SALE', usuario: null, efecto: -2, cantidad: 2, existenciaAntes: 10, existenciaDespues: 8, referenciaTipo: 'ORDER', referenciaId: 'cmabcdef12345678' })], contexto)
  const linea = csv.split('\n').find((l) => l.includes('CAM-001'))
  assert.ok(linea)
  const c = linea.split(';')
  assert.equal(c[0], '2030-01-01 06:00:00', '10:00 UTC son las 06:00 en Santo Domingo (UTC−4)')
  assert.deepEqual(c.slice(1, 5), ['Principal', 'Camiseta · Grande', 'CAM-001', 'Venta'])
  assert.deepEqual(c.slice(5, 9), ['2', '-2', '10', '8'])
  assert.equal(c[10], 'Sistema')
  assert.equal(c[11], 'Pedido 12345678')
  assert.equal(fechaHoraCsv(new Date('2030-07-01T03:59:59.000Z'), 'America/Santo_Domingo'), '2030-06-30 23:59:59')
})

test('las celdas con punto y coma, comillas o saltos de línea no rompen la fila', () => {
  const csv = movimientosToCsv([fila({ motivo: 'caja; "frágil"\nrevisar' })], contexto)
  assert.match(csv, /"caja; ""frágil""\nrevisar"/)
})

// ── Estado manual de la variante ─────────────────────────────────────────────

test('una variante «Agotada» a mano se avisa: no se vende aunque haya existencias, y reponer no la reactiva', () => {
  assert.equal(advertenciaEstadoManual('ACTIVE', 50), null)
  assert.equal(advertenciaEstadoManual('ACTIVE', 0), null)
  assert.match(advertenciaEstadoManual('OUT_OF_STOCK', 50) ?? '', /no se vende aunque haya 50 unidades disponibles/)
  assert.match(advertenciaEstadoManual('OUT_OF_STOCK', 1) ?? '', /aunque haya 1 unidad disponible\./)
  assert.match(advertenciaEstadoManual('OUT_OF_STOCK', 0) ?? '', /Al reponer existencias seguirá sin venderse hasta que la actives/)
  assert.match(advertenciaEstadoManual('DISCONTINUED', 4) ?? '', /descontinuada.*aún tiene 4 unidades disponibles/)
  assert.equal(advertenciaEstadoManual('DISCONTINUED', 0), null, 'descontinuada y sin existencias es lo normal')
})

// ── Fechas por zona horaria ──────────────────────────────────────────────────

test('el filtro de fechas son días LOCALES de la empresa, ambos extremos incluidos', () => {
  const r = rangoDeFechas({ desde: '2030-03-04', hasta: '2030-03-05' }, 'America/Santo_Domingo')
  assert.equal(r.gte?.toISOString(), '2030-03-04T04:00:00.000Z', 'medianoche local del 4 = 04:00 UTC')
  assert.equal(r.lt?.toISOString(), '2030-03-06T04:00:00.000Z', 'EXCLUSIVO: el inicio del 6 deja dentro todo el 5')
  assert.deepEqual(rangoDeFechas({}, 'America/Santo_Domingo'), {})
  assert.equal(rangoDeFechas({ hasta: '2030-03-05' }, 'America/Santo_Domingo').gte, undefined)
  assert.equal(rangoDeFechas({ desde: '2030-03-04' }, 'America/Santo_Domingo').lt, undefined)
})
