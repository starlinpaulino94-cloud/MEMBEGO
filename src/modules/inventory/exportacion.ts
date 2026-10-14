import type { InventoryMovementType } from '@prisma/client'
import { armarCsvBloques } from '@/lib/csv'
import { ETIQUETA_MOVIMIENTO, describirReferencia } from './formato'

/**
 * COMMERCE CORE · inventario — el CSV de movimientos.
 *
 * PURO: recibe las filas ya leídas y devuelve el texto. Se prueba sin base.
 *
 * TRES COSAS QUE UN CSV DE LEDGER NO PUEDE HACER MAL
 *
 *  1. DECIR DE QUÉ ES. Va un bloque de alcance (filtros, zona horaria, cuándo se
 *     generó): dos exportaciones del mismo día con filtros distintos son
 *     indistinguibles si el archivo no lo dice.
 *  2. NO RECORTAR EN SILENCIO. Si el tope cortó las filas, el archivo lo dice en
 *     el bloque de alcance. Un ledger exportado a medias, sin aviso, es peor que
 *     no exportar: alguien lo suma y concluye que faltan existencias.
 *  3. NO EJECUTAR FÓRMULAS. El motivo de un ajuste lo teclea una persona (hasta
 *     300 caracteres). Si empieza con `=`, `+`, `-` o `@`, Excel lo evalúa al
 *     abrir el archivo. Los textos libres se entrecomillan con un apóstrofo
 *     delante; los números se escriben tal cual para que sigan sumándose.
 */

/** Tope de filas por archivo (un ledger crece sin parar). */
export const TOPE_FILAS_MOVIMIENTOS = 5000

export interface FilaExportada {
  creadoEn: Date
  sucursal: string
  producto: string
  sku: string
  tipo: InventoryMovementType
  cantidad: number
  /** Lo que el movimiento hizo a la existencia: +10, −3 o 0 si solo cambió de cubeta. */
  efecto: number
  existenciaAntes: number
  existenciaDespues: number
  motivo: string | null
  /** Nombre de quien lo hizo; null = el sistema. */
  usuario: string | null
  referenciaTipo: string | null
  referenciaId: string | null
}

export interface ContextoExportacion {
  zonaHoraria: string
  generadoEn: Date
  /** «Movimiento: Venta», «Desde: 2026-10-01»… ya en palabras. Vacío = sin filtros. */
  filtros: ReadonlyArray<readonly [string, string]>
  /** true si había más filas que el tope y se cortó. */
  truncado: boolean
  tope: number
}

/**
 * Neutraliza un texto libre para que una hoja de cálculo no lo trate como
 * fórmula: si empieza por un carácter que Excel interpreta, se le antepone un
 * apóstrofo (queda visible como texto, que es lo que el dato es).
 */
export function textoCsv(v: string | null | undefined): string {
  if (v == null || v === '') return ''
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

const SIN_FORMULA = (v: string | null) => textoCsv(v)

/** `2026-10-13 14:22:18` en la zona de la empresa: ordenable y lo abre Excel como fecha. */
export function fechaHoraCsv(fecha: Date, zonaHoraria: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zonaHoraria, dateStyle: 'short', timeStyle: 'medium' }).format(fecha)
}

export function movimientosToCsv(filas: readonly FilaExportada[], ctx: ContextoExportacion): string {
  return armarCsvBloques([
    {
      titulo: 'Alcance de la exportación',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ...(ctx.filtros.length === 0 ? [['Filtros', 'Ninguno (todos los movimientos)']] : ctx.filtros.map(([k, v]) => [k, SIN_FORMULA(v)])),
        ['Filas exportadas', filas.length],
        [
          'Datos completos',
          ctx.truncado ? `NO - el archivo se cortó en ${ctx.tope} filas (las más recientes). Acota las fechas o los filtros y vuelve a exportar.` : 'Si',
        ],
      ],
    },
    {
      titulo: 'Movimientos (del más reciente al más antiguo)',
      encabezados: [
        'Fecha y hora',
        'Sucursal',
        'Producto',
        'SKU',
        'Movimiento',
        'Cantidad',
        'Efecto en existencia',
        'Existencia antes',
        'Existencia despues',
        'Motivo',
        'Usuario',
        'Referencia',
      ],
      filas: filas.map((f) => [
        fechaHoraCsv(f.creadoEn, ctx.zonaHoraria),
        SIN_FORMULA(f.sucursal),
        SIN_FORMULA(f.producto),
        SIN_FORMULA(f.sku),
        ETIQUETA_MOVIMIENTO[f.tipo],
        f.cantidad,
        f.efecto,
        f.existenciaAntes,
        f.existenciaDespues,
        SIN_FORMULA(f.motivo),
        SIN_FORMULA(f.usuario ?? 'Sistema'),
        SIN_FORMULA(describirReferencia(f.referenciaTipo, f.referenciaId)),
      ]),
    },
  ])
}

// ── INV-2a · el CSV de UNA entrada ───────────────────────────────────────────

export interface EntradaParaCsv {
  numero: string
  creadoEn: Date
  sucursalNombre: string
  origen: 'MANUAL' | 'CSV'
  referencia: string | null
  nota: string | null
  usuarioNombre: string | null
  lineas: number
  unidades: number
  detalle: ReadonlyArray<{ sku: string; barcode: string | null; itemNombre: string; nombreVariante: string; esDefault: boolean; cantidad: number; existenciaAntes: number; existenciaDespues: number }>
}

/** Una entrada con todas sus líneas: lo que se le manda al contador o al proveedor. */
export function entradaToCsv(e: EntradaParaCsv, zonaHoraria: string): string {
  return armarCsvBloques([
    {
      titulo: 'Entrada de mercancía',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Número', e.numero],
        ['Fecha y hora', fechaHoraCsv(e.creadoEn, zonaHoraria)],
        ['Zona horaria', zonaHoraria],
        ['Sucursal', SIN_FORMULA(e.sucursalNombre)],
        ['Referencia', SIN_FORMULA(e.referencia)],
        ['Nota', SIN_FORMULA(e.nota)],
        ['Origen', e.origen === 'CSV' ? 'Importada de un archivo CSV' : 'Capturada a mano'],
        ['Registrada por', SIN_FORMULA(e.usuarioNombre ?? 'Sistema')],
        ['Productos', e.lineas],
        ['Unidades', e.unidades],
      ],
    },
    {
      titulo: 'Líneas',
      encabezados: ['SKU', 'Codigo de barras', 'Producto', 'Cantidad', 'Existencia antes', 'Existencia despues'],
      filas: e.detalle.map((l) => [
        SIN_FORMULA(l.sku),
        SIN_FORMULA(l.barcode),
        SIN_FORMULA(l.esDefault ? l.itemNombre : `${l.itemNombre} · ${l.nombreVariante}`),
        l.cantidad,
        l.existenciaAntes,
        l.existenciaDespues,
      ]),
    },
  ])
}
