import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { armarXlsxBloques, celdaXlsx, nombreHoja, pideXlsx } from '@/lib/xlsx'

/**
 * EXPORTAR A EXCEL (rediseño de reportes · Fase 10).
 *
 * Las dieciocho rutas de exportación eran CSV. El CSV está bien hecho —BOM
 * para los acentos, punto y coma porque es lo que Excel en español espera— y
 * no se ha tocado; pero `lib/csv.ts` dice en su propio comentario lo que no
 * puede hacer: «las hojas de un libro de Excel no caben en un CSV».
 *
 * Y hay algo peor que la comodidad: en un CSV TODO es texto, y el número lo
 * reconstruye Excel leyendo la configuración regional de quien abre el
 * archivo. «1234.50» con separador decimal español no es mil doscientos
 * treinta y cuatro con cincuenta. La misma descarga da cifras distintas en dos
 * ordenadores y nadie se entera.
 *
 * Lo que estas pruebas vigilan:
 *
 *  1. Que el libro sea un .xlsx de verdad, con una hoja por bloque.
 *  2. Que los números sean NÚMEROS, y que no se adivine de más: un código
 *     «01234» que pierde el cero es el clásico de las hojas de cálculo.
 *  3. Que el nombre de la pestaña no rompa el libro (Excel: 31 caracteres,
 *     sin `[]:*?/\`, y sin repetirse).
 *  4. Que el CSV siga saliendo por defecto: nadie pierde su descarga.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const RUTAS = join(raiz, 'src', 'app', '(admin)', 'admin', 'reportes')

/** Un .xlsx es un zip; se comprueba por su firma, sin descomprimirlo. */
const ES_ZIP = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b

// ───────────────────────── el libro ─────────────────────────

test('el libro es un xlsx de verdad', async () => {
  const libro = await armarXlsxBloques([
    { titulo: 'Alcance', encabezados: ['Concepto', 'Valor'], filas: [['Dias', 30]] },
  ])
  assert.ok(ES_ZIP(libro), 'lo que sale no empieza por la firma de un zip')
  assert.ok(libro.length > 500, 'el libro sale sospechosamente vacío')
})

test('cada bloque es una hoja', async () => {
  // Lo que el CSV no puede hacer y es la razón de esta fase.
  const libro = await armarXlsxBloques([
    { titulo: 'Uno', encabezados: ['A'], filas: [['x']] },
    { titulo: 'Dos', encabezados: ['B'], filas: [['y']] },
    { titulo: 'Tres', encabezados: ['C'], filas: [['z']] },
  ])
  const texto = libro.toString('latin1')
  // Los nombres de hoja viven en xl/workbook.xml, dentro del zip; el zip
  // guarda los nombres de entrada sin comprimir, así que basta con contarlas.
  const hojas = [...texto.matchAll(/xl\/worksheets\/sheet(\d+)\.xml/g)].map((m) => m[1])
  assert.ok(new Set(hojas).size >= 3, `esperaba 3 hojas, encontré ${new Set(hojas).size}`)
})

// ───────────────────── nombres de pestaña ─────────────────────

test('el nombre de la pestaña nunca rompe el libro', () => {
  const usados = new Set<string>()
  // Excel rechaza el libro entero si el nombre pasa de 31 o trae `[]:*?/\`.
  const largo = nombreHoja('Ingreso de caja dia a dia (NO incluye cobros de membresia)', usados)
  assert.ok(largo.length <= 31, `${largo.length} caracteres`)

  const sucio = nombreHoja('Ventas [2026]: mayo/junio *?', usados)
  assert.equal(/[[\]:*?/\\]/.test(sucio), false, `quedaron signos prohibidos: ${sucio}`)

  // Y dos hojas no pueden llamarse igual.
  const u2 = new Set<string>()
  const a = nombreHoja('Alcance del reporte', u2)
  const b = nombreHoja('Alcance del reporte', u2)
  assert.notEqual(a, b)
  assert.ok(b.length <= 31)

  // Un título vacío tampoco puede dejar la pestaña sin nombre.
  assert.ok(nombreHoja('   ', new Set()).length > 0)
})

// ───────────── qué se convierte en número, y qué no ─────────────

test('un número es un número', () => {
  // Una celda numérica de verdad no depende de la configuración regional de
  // quien abre el archivo, que es el fallo que esta fase viene a quitar.
  assert.deepEqual(celdaXlsx(12), { value: 12, type: Number })
  assert.deepEqual(celdaXlsx('1234.50'), {
    value: 1234.5,
    type: Number,
    format: '#,##0.00',
  })
  assert.deepEqual(celdaXlsx(1234.5), { value: 1234.5, type: Number, format: '#,##0.00' })
})

test('y un código sigue siendo un código', () => {
  // El clásico de las hojas de cálculo: «01234» convertido a número pierde el
  // cero, y un identificador largo se vuelve notación científica.
  for (const crudo of [
    '01234',
    '2026-09-21',
    '21/09/2026',
    '1.234,56',
    '12345678901234567890',
    '1.5',
    '3.141',
    '+7.00',
    '',
    'RD$1234.50',
  ]) {
    const c = celdaXlsx(crudo)
    assert.equal(c.type, String, `«${crudo}» se convirtió en número`)
    assert.equal(c.value, crudo)
  }
  // Nulo y no-finito tampoco inventan un cero.
  assert.deepEqual(celdaXlsx(null), { value: '', type: String })
  assert.deepEqual(celdaXlsx(undefined), { value: '', type: String })
  assert.equal(celdaXlsx(Number.NaN).type, String)
  assert.equal(celdaXlsx(Number.POSITIVE_INFINITY).type, String)
})

test('el criterio de conversión está escrito y es el de toFixed(2)', () => {
  const nucleo = leer('src/lib/xlsx.ts')
  assert.match(nucleo, /const DINERO = \/\^-\?\\d\+\\\.\\d\{2\}\$\//)
  // Nada de «todo lo que parezca un número».
  assert.equal(
    /parseFloat|Number\.parseFloat|isNaN/.test(nucleo),
    false,
    'el helper empezó a adivinar números: así se pierde un código con ceros delante'
  )
})

// ───────────────────── cómo se pide, y qué sale por defecto ─────────────────────

test('solo «xlsx» pide Excel; cualquier otra cosa cae al CSV', () => {
  assert.equal(pideXlsx({ formato: 'xlsx' }), true)
  assert.equal(pideXlsx({ formato: ' XLSX ' }), true)
  assert.equal(pideXlsx({ formato: 'excel' }), false)
  assert.equal(pideXlsx({ formato: '' }), false)
  assert.equal(pideXlsx({}), false)
  assert.equal(pideXlsx(new URLSearchParams('formato=xlsx')), true)
  assert.equal(pideXlsx(new URLSearchParams('')), false)
})

test('toda ruta de exportación de reportes ofrece los dos formatos', () => {
  const rutas = readdirSync(RUTAS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(RUTAS, e.name, 'export', 'route.ts'))
    .concat(join(RUTAS, 'export', 'route.ts'))
    .filter((p) => {
      try {
        readFileSync(p)
        return true
      } catch {
        return false
      }
    })
  assert.ok(rutas.length >= 9, `esperaba al menos 9 rutas de exportación, hay ${rutas.length}`)

  for (const p of rutas) {
    const src = readFileSync(p, 'utf8')
    assert.match(src, /pideXlsx\(/, `${p} no ofrece Excel`)
    assert.match(src, /respuestaXlsx\(/, `${p} no devuelve Excel`)
    // Y el CSV sigue siendo la salida por defecto: quien ya automatizó una
    // descarga no puede encontrarse un binario donde había texto.
    assert.match(src, /respuestaCsv\(/, `${p} perdió el CSV`)
  }
})

test('los dos formatos salen de la MISMA lista de bloques', () => {
  // Si cada formato armara su lista, la segunda se quedaría atrás a la primera
  // cifra nueva — y el fallo no se ve: se descarga.
  const rutas = readdirSync(RUTAS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(RUTAS, e.name, 'export', 'route.ts'))
    .filter((p) => {
      try {
        return readFileSync(p, 'utf8').includes('armarCsvBloques')
      } catch {
        return false
      }
    })
  for (const p of rutas) {
    const src = readFileSync(p, 'utf8')
    assert.match(src, /armarXlsxBloques\(bloques\)/, `${p}: el Excel no usa los mismos bloques`)
    assert.match(src, /armarCsvBloques\(bloques\)/, `${p}: el CSV no usa los mismos bloques`)
  }
})

test('el botón de Excel conserva el periodo y los filtros', () => {
  // El archivo tiene que salir con EL MISMO corte que la pantalla.
  const src = leer('src/components/reportes/BotonesExportar.tsx')
  assert.match(src, /replace\(\/\^\\\?\/, ''\)/, 'no normaliza el «?» de la query string')
  assert.match(src, /params \? `\$\{params\}&` : ''/, 'pegaría el formato con «?» sobre otro «?»')
  assert.match(src, /label="Exportar Excel"/)
})
