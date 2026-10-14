import { armarCsv } from '@/lib/csv'
import { CANTIDAD_MAXIMA } from './domain'
import { MAX_LINEAS_IMPORTACION, type LineaEntrada } from './entradas'

/**
 * COMMERCE CORE · inventario — INV-2a: importar existencias desde un CSV.
 *
 * PURO: lee el texto, resuelve cada fila contra un catálogo que le pasan ya
 * cargado y devuelve un informe. No toca la base: lo hace el servicio, que
 * VUELVE a leer y a validar el texto (nunca se confía en una vista previa que
 * viajó por el navegador).
 *
 * TODO O NADA. Un archivo con una sola fila mala no se aplica. Aplicar «las
 * buenas» y callar las malas deja un inventario a medias que nadie sabe que lo
 * está; el informe dice cada fila con su problema y se vuelve a subir corregido.
 *
 * LO QUE UN ARCHIVO DE EXCEL HACE A UN CÓDIGO DE BARRAS. Excel convierte un
 * EAN-13 a notación científica (`7.50123E+12`) y pierde los ceros de la
 * izquierda. Lo primero se detecta y se explica; lo segundo no se puede
 * detectar, por eso el informe enseña el nombre del producto que encontró en
 * cada fila: es la forma de ver que algo no cuadra.
 */

/** Texto máximo de un archivo (2 MB): 1.000 filas ocupan unos 40 KB. */
export const MAX_CARACTERES_IMPORTACION = 2 * 1024 * 1024
/** Errores que el informe lista (el total siempre se cuenta). */
export const MAX_ERRORES_LISTADOS = 200
/** Líneas válidas que la vista previa enseña. */
export const MAX_FILAS_VISTA_PREVIA = 50

// ── Leer el CSV ──────────────────────────────────────────────────────────────

export type Delimitador = ';' | ',' | '\t'

/** El separador que más aparece en la primera línea FUERA de comillas; `;` si hay empate (Excel en español). */
export function detectarDelimitador(texto: string): Delimitador {
  let cuenta: Record<Delimitador, number> = { ';': 0, ',': 0, '\t': 0 }
  let enComillas = false
  for (const c of texto) {
    if (c === '"') enComillas = !enComillas
    else if (!enComillas && (c === '\n' || c === '\r')) break
    else if (!enComillas && (c === ';' || c === ',' || c === '\t')) cuenta = { ...cuenta, [c]: cuenta[c] + 1 }
  }
  if (cuenta[';'] >= cuenta[','] && cuenta[';'] >= cuenta['\t']) return ';'
  return cuenta[','] >= cuenta['\t'] ? ',' : '\t'
}

/**
 * Un CSV a filas de celdas (RFC 4180): comillas, `""` dentro de comillas, saltos
 * de línea dentro de una celda entrecomillada, `\r\n`, `\n` o `\r`. Lanza si las
 * comillas no cierran.
 */
export function parseCsv(texto: string, delimitador: Delimitador): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let enComillas = false
  const cerrarCelda = () => {
    fila.push(celda)
    celda = ''
  }
  const cerrarFila = () => {
    cerrarCelda()
    filas.push(fila)
    fila = []
  }
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"'
          i++
        } else enComillas = false
      } else celda += c
    } else if (c === '"' && celda === '') enComillas = true
    else if (c === delimitador) cerrarCelda()
    else if (c === '\n') cerrarFila()
    else if (c === '\r') {
      if (texto[i + 1] === '\n') i++
      cerrarFila()
    } else celda += c
  }
  if (enComillas) throw new Error('Hay unas comillas sin cerrar en el archivo.')
  if (celda !== '' || fila.length > 0) cerrarFila()
  return filas
}

/** `Código de barras` → `codigo_de_barras`: minúsculas, sin acentos, sin signos. */
export function normalizarEncabezado(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const ALIAS_SKU = new Set(['sku', 'codigo_sku', 'cod_sku'])
const ALIAS_CODIGO = new Set(['codigo_de_barras', 'codigo_barras', 'barcode', 'ean', 'upc', 'gtin', 'cod_barras'])
const ALIAS_CANTIDAD = new Set(['cantidad', 'unidades', 'qty', 'quantity', 'cantidad_recibida'])

export interface FilaCsv {
  /** Número de línea en el archivo (1 = encabezado; la primera de datos es la 2): el que ve la persona en su hoja. */
  fila: number
  sku: string | null
  barcode: string | null
  cantidad: string
}

export type LecturaCsv = { ok: true; filas: FilaCsv[]; delimitador: Delimitador } | { ok: false; error: string }

/** Lee el texto de un archivo a filas con SKU/código y cantidad. No mira la base. */
export function leerImportacion(texto: unknown): LecturaCsv {
  if (typeof texto !== 'string') return { ok: false, error: 'No se pudo leer el archivo.' }
  if (texto.length > MAX_CARACTERES_IMPORTACION) return { ok: false, error: 'El archivo es demasiado grande (máximo 2 MB). Divídelo en varios.' }
  const limpio = texto.replace(/^\uFEFF/, '')
  if (limpio.trim() === '') return { ok: false, error: 'El archivo está vacío.' }
  const delimitador = detectarDelimitador(limpio)
  let filas: string[][]
  try {
    filas = parseCsv(limpio, delimitador)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el archivo.' }
  }
  const encabezados = (filas[0] ?? []).map(normalizarEncabezado)
  const iSku = encabezados.findIndex((h) => ALIAS_SKU.has(h))
  const iCodigo = encabezados.findIndex((h) => ALIAS_CODIGO.has(h))
  const iCantidad = encabezados.findIndex((h) => ALIAS_CANTIDAD.has(h))
  if (iCantidad < 0 || (iSku < 0 && iCodigo < 0)) {
    return { ok: false, error: 'La primera fila debe tener los encabezados «sku» (o «codigo_de_barras») y «cantidad». Descarga la plantilla para ver el formato.' }
  }
  const celda = (f: string[], i: number) => (i < 0 ? '' : (f[i] ?? '').trim())
  const datos: FilaCsv[] = []
  for (let n = 1; n < filas.length; n++) {
    const f = filas[n]
    // Una fila en blanco (Excel deja muchas al final) no es un dato.
    if (f.every((c) => c.trim() === '')) continue
    datos.push({ fila: n + 1, sku: celda(f, iSku) || null, barcode: celda(f, iCodigo) || null, cantidad: celda(f, iCantidad) })
  }
  if (datos.length === 0) return { ok: false, error: 'El archivo no trae ninguna fila de datos debajo de los encabezados.' }
  return { ok: true, filas: datos, delimitador }
}

// ── Validar contra el catálogo ───────────────────────────────────────────────

/** Lo que el validador necesita saber de cada producto que el archivo menciona. */
export interface VarianteImportable {
  id: string
  sku: string
  barcode: string | null
  nombre: string
  controlaInventario: boolean
  descontinuada: boolean
}

export interface CatalogoCodigos {
  /** Clave en minúsculas → productos con ese SKU (más de uno solo si dos SKU difieren únicamente en mayúsculas). */
  porSku: ReadonlyMap<string, readonly VarianteImportable[]>
  porBarcode: ReadonlyMap<string, readonly VarianteImportable[]>
}

export function indexarCatalogo(variantes: readonly VarianteImportable[]): CatalogoCodigos {
  const porSku = new Map<string, VarianteImportable[]>()
  const porBarcode = new Map<string, VarianteImportable[]>()
  const meter = (m: Map<string, VarianteImportable[]>, k: string, v: VarianteImportable) => m.set(k, [...(m.get(k) ?? []), v])
  for (const v of variantes) {
    meter(porSku, v.sku.toLowerCase(), v)
    if (v.barcode) meter(porBarcode, v.barcode.toLowerCase(), v)
  }
  return { porSku, porBarcode }
}

export interface ErrorFila {
  fila: number
  mensaje: string
}

export interface LineaVistaPrevia {
  fila: number
  sku: string
  nombre: string
  cantidad: number
}

export interface InformeImportacion {
  /** true = se puede aplicar tal cual (sin un solo error y con al menos una línea). */
  ok: boolean
  filasLeidas: number
  productos: number
  unidades: number
  errores: ErrorFila[]
  totalErrores: number
  avisos: string[]
  vistaPrevia: LineaVistaPrevia[]
  /** Las líneas para el servicio; vacío si hay errores (no se aplica nada a medias). */
  lineas: LineaEntrada[]
}

const NOTACION_CIENTIFICA = /^\d+([.,]\d+)?e\+?\d+$/i
const ENTERO = /^\d{1,7}$/

function cantidadDe(texto: string): { ok: true; valor: number } | { ok: false; mensaje: string } {
  if (texto === '') return { ok: false, mensaje: 'Falta la cantidad.' }
  if (!ENTERO.test(texto)) {
    return { ok: false, mensaje: `La cantidad «${texto.slice(0, 20)}» no es un número entero positivo (sin decimales, signos ni separadores de miles).` }
  }
  const n = Number(texto)
  if (n < 1) return { ok: false, mensaje: 'La cantidad debe ser al menos 1.' }
  if (n > CANTIDAD_MAXIMA) return { ok: false, mensaje: `La cantidad no puede pasar de ${CANTIDAD_MAXIMA.toLocaleString('es-DO')}.` }
  return { ok: true, valor: n }
}

/**
 * Valida todas las filas contra el catálogo y arma el informe. Cada fila dice
 * QUÉ producto encontró: es la defensa contra el cero que Excel se comió.
 */
export function validarImportacion(filas: readonly FilaCsv[], catalogo: CatalogoCodigos): InformeImportacion {
  const errores: ErrorFila[] = []
  const avisos = new Set<string>()
  const lineas: LineaEntrada[] = []
  const vista: LineaVistaPrevia[] = []
  const primeraVez = new Map<string, number>()
  let unidades = 0

  if (filas.length > MAX_LINEAS_IMPORTACION) {
    return {
      ok: false,
      filasLeidas: filas.length,
      productos: 0,
      unidades: 0,
      errores: [{ fila: 0, mensaje: `El archivo trae ${filas.length} filas y el máximo por archivo es ${MAX_LINEAS_IMPORTACION}. Divídelo en varios.` }],
      totalErrores: 1,
      avisos: [],
      vistaPrevia: [],
      lineas: [],
    }
  }

  for (const f of filas) {
    // Todos los problemas de UNA fila juntos, en un solo mensaje: quien corrige su hoja los arregla de una vez.
    const problemas: string[] = []
    const cantidad = cantidadDe(f.cantidad)
    if (!cantidad.ok) problemas.push(cantidad.mensaje)

    let variante: VarianteImportable | null = null
    if (!f.sku && !f.barcode) problemas.push('Falta el SKU o el código de barras.')
    else if (f.barcode && NOTACION_CIENTIFICA.test(f.barcode)) {
      problemas.push(`El código «${f.barcode}» está en notación científica: Excel lo convirtió. Formatea esa columna como Texto y vuelve a escribirlo.`)
    } else {
      const porSku = f.sku ? (catalogo.porSku.get(f.sku.toLowerCase()) ?? []) : []
      const porCodigo = f.barcode ? (catalogo.porBarcode.get(f.barcode.toLowerCase()) ?? []) : []
      if (f.sku && porSku.length > 1) problemas.push(`El SKU «${f.sku}» corresponde a ${porSku.length} productos que solo se distinguen por mayúsculas: usa el código de barras.`)
      else if (f.barcode && porCodigo.length > 1) problemas.push(`El código «${f.barcode}» corresponde a más de un producto.`)
      else if (f.sku && f.barcode && porSku.length === 1 && porCodigo.length === 1 && porSku[0].id !== porCodigo[0].id) {
        problemas.push(`El SKU «${f.sku}» y el código «${f.barcode}» son de productos distintos («${porSku[0].nombre}» y «${porCodigo[0].nombre}»).`)
      } else {
        variante = porSku[0] ?? porCodigo[0] ?? null
        if (!variante) problemas.push(f.sku ? `No existe ningún producto con el SKU «${f.sku}».` : `No existe ningún producto con el código de barras «${f.barcode}».`)
      }
    }

    if (variante) {
      if (!variante.controlaInventario) {
        problemas.push(`«${variante.nombre}» no controla inventario. Actívalo en su ficha del catálogo.`)
        variante = null
      } else {
        const antes = primeraVez.get(variante.id)
        if (antes !== undefined) {
          problemas.push(`«${variante.nombre}» ya aparece en la fila ${antes}: junta sus cantidades en una sola fila.`)
          variante = null
        } else {
          primeraVez.set(variante.id, f.fila)
          if (variante.descontinuada) avisos.add(`«${variante.nombre}» está descontinuado en el catálogo; entra al inventario igual.`)
        }
      }
    }

    if (problemas.length > 0) {
      errores.push({ fila: f.fila, mensaje: problemas.join(' ') })
      continue
    }
    if (!variante || !cantidad.ok) continue
    lineas.push({ varianteId: variante.id, cantidad: cantidad.valor })
    unidades += cantidad.valor
    if (vista.length < MAX_FILAS_VISTA_PREVIA) vista.push({ fila: f.fila, sku: variante.sku, nombre: variante.nombre, cantidad: cantidad.valor })
  }

  const ok = errores.length === 0 && lineas.length > 0
  return {
    ok,
    filasLeidas: filas.length,
    productos: lineas.length,
    unidades,
    errores: errores.slice(0, MAX_ERRORES_LISTADOS),
    totalErrores: errores.length,
    avisos: [...avisos].slice(0, 20),
    vistaPrevia: vista,
    lineas: ok ? lineas : [],
  }
}

// ── La plantilla ─────────────────────────────────────────────────────────────

/**
 * El archivo de ejemplo que la persona descarga. Las filas de ejemplo usan SKU
 * que NO existen: si se suben sin borrarlas, el informe las rechaza (todo o
 * nada) en vez de meter existencias de mentira.
 */
export function plantillaImportacionCsv(): string {
  return armarCsv(
    ['sku', 'codigo_de_barras', 'cantidad', 'nombre (opcional, solo para ti)'],
    [
      ['EJEMPLO-BORRAR-1', '', 10, 'Escribe el SKU, o el código de barras, de un producto que ya exista'],
      ['', 'EJEMPLO-BORRAR-2', 5, 'Una de las dos columnas basta; si pones las dos, deben ser del mismo producto'],
    ]
  )
}
