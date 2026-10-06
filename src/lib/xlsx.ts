import writeXlsxFile from 'write-excel-file/node'

/**
 * EXCEL DE VERDAD PARA LAS EXPORTACIONES DEL PANEL.
 *
 * El CSV que ya existe está bien hecho —BOM para que los acentos no lleguen
 * rotos, punto y coma porque es lo que Excel en español espera— y no se toca.
 * Pero `lib/csv.ts` dice en su propio comentario lo que no puede hacer:
 *
 *   «las hojas de un libro de Excel no caben en un CSV»
 *
 * Un reporte no es UNA tabla: el de finanzas tiene el alcance, las cifras, los
 * métodos de cobro, los intentos de la pasarela, el día a día y el recurrente
 * estimado. En el CSV van apilados con una línea en blanco entre medias, y
 * quien lo abre tiene que recortar a mano. Aquí cada bloque es UNA HOJA con su
 * nombre en la pestaña.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LO QUE DE VERDAD CAMBIA: UN NÚMERO ES UN NÚMERO
 *
 * En un CSV todo es texto, y el número lo reconstruye Excel leyendo la
 * configuración regional de quien abre el archivo. Con separador decimal
 * español, «1234.50» no es mil doscientos treinta y cuatro con cincuenta: es
 * texto, o es un millón doscientos treinta y cuatro mil quinientos. La misma
 * descarga da cifras distintas en dos ordenadores y nadie se entera.
 *
 * Una celda numérica de verdad no tiene esa ambigüedad: no hay nada que
 * interpretar. Por eso aquí los números van como números, con su formato de
 * dos decimales, y se pueden sumar sin volver a teclearlos.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ NO SE ADIVINA MÁS DE LA CUENTA
 *
 * Convertir a número «todo lo que lo parezca» rompe archivos en silencio: un
 * código «01234» perdería el cero, y un identificador largo se volvería
 * notación científica. Es el clásico de las hojas de cálculo.
 *
 * Así que solo se convierten dos cosas, las dos deterministas:
 *
 *  · Lo que YA es un número de JavaScript. Quien lo escribió lo pensó así.
 *  · Una cadena con la forma EXACTA que produce `toFixed(2)` —signo opcional,
 *    dígitos, punto, dos decimales—, que es como las rutas escriben el dinero.
 *    Un código de producto no tiene dos decimales.
 *
 * Todo lo demás es texto, incluidas las fechas ya formateadas: `fechaCsv` las
 * deja en la zona del negocio y convertirlas otra vez a fecha las movería de
 * día según la zona de quien abre el archivo.
 */

/** Un bloque: exactamente la misma forma que ya arma el CSV. */
export interface BloqueExport {
  titulo: string
  encabezados: string[]
  filas: unknown[][]
}

/** La forma que produce `Number.prototype.toFixed(2)`, y ninguna otra. */
const DINERO = /^-?\d+\.\d{2}$/

/** Formato de celda para dinero. Miles con punto y dos decimales. */
const FORMATO_DINERO = '#,##0.00'

type Celda = { value: string | number; type?: StringConstructor | NumberConstructor; format?: string; fontWeight?: 'bold' }

/**
 * Cómo viaja UNA celda. Exportada porque es la regla que hay que poder probar:
 * el resto del archivo es un zip que no se lee de un vistazo.
 */
export function celdaXlsx(valor: unknown): Celda {
  if (valor == null) return { value: '', type: String }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return Number.isInteger(valor)
      ? { value: valor, type: Number }
      : { value: valor, type: Number, format: FORMATO_DINERO }
  }
  const texto = String(valor)
  if (DINERO.test(texto)) return { value: Number(texto), type: Number, format: FORMATO_DINERO }
  return { value: texto, type: String }
}

/**
 * El nombre de la pestaña.
 *
 * Excel no acepta más de 31 caracteres ni los signos `[ ] : * ? / \`, y rechaza
 * el libro entero si dos hojas se llaman igual. Un título largo se recorta y se
 * numera en vez de romper la descarga.
 */
export function nombreHoja(titulo: string, usados: Set<string>): string {
  const limpio = titulo.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Hoja'
  let nombre = limpio.slice(0, 31)
  let n = 2
  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${n})`
    nombre = `${limpio.slice(0, 31 - sufijo.length)}${sufijo}`
    n++
  }
  usados.add(nombre.toLowerCase())
  return nombre
}

/** Ancho de columna, del contenido. Un número largo que sale «####» no es un dato. */
function anchos(b: BloqueExport): { width: number }[] {
  return b.encabezados.map((h, i) => {
    const largos = [String(h).length, ...b.filas.map((f) => String(f[i] ?? '').length)]
    return { width: Math.min(42, Math.max(10, Math.max(...largos) + 2)) }
  })
}

/** Arma el libro: una hoja por bloque, con su encabezado en negrita y fijo. */
export async function armarXlsxBloques(bloques: BloqueExport[]): Promise<Buffer> {
  const usados = new Set<string>()
  const hojas = bloques.map((b) => ({
    sheet: nombreHoja(b.titulo, usados),
    columns: anchos(b),
    // La fila de encabezados se queda a la vista al bajar: en una serie de
    // trescientos días, sin esto se pierde de qué columna es cada número.
    stickyRowsCount: 1,
    data: [
      b.encabezados.map((h) => ({ value: h, type: String, fontWeight: 'bold' as const })),
      ...b.filas.map((fila) => fila.map(celdaXlsx)),
    ],
  }))
  return writeXlsxFile(hojas).toBuffer()
}

/** Cabeceras de una descarga de Excel. Mismo criterio de nombre que el CSV. */
export function respuestaXlsx(
  libro: Buffer,
  nombre: string,
  opciones?: { fechar?: boolean }
): Response {
  const hoy = new Date().toISOString().slice(0, 10)
  const archivo = opciones?.fechar === false ? nombre : `${nombre}-${hoy}`
  return new Response(new Uint8Array(libro), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${archivo}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** ¿La petición pide Excel? Un `?formato=` desconocido cae al CSV de siempre. */
export function pideXlsx(sp: { get(k: string): string | null } | Record<string, string | undefined>): boolean {
  const v = typeof (sp as { get?: unknown }).get === 'function'
    ? (sp as { get(k: string): string | null }).get('formato')
    : (sp as Record<string, string | undefined>).formato
  return (v ?? '').trim().toLowerCase() === 'xlsx'
}
