import type { InventoryMovementType } from '@prisma/client'
import { armarCsv, armarCsvBloques } from '@/lib/csv'
import { ETIQUETA_ESTADO_TRASLADO, pendienteDeLinea, type EstadoTraslado } from './traslados'
import { ETIQUETA_ESTADO_CONTEO, ETIQUETA_RESULTADO, clasificarDiferencia, diferenciaDeConteo, ordenarPorDiferencia, resumirVarianza, type EstadoConteo } from './conteos'
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

// ── INV-2b · Conteos físicos ─────────────────────────────────────────────────

export interface FilaHojaParaCsv {
  sku: string
  barcode: string | null
  producto: string
}

/**
 * La HOJA DE CONTEO EN BLANCO de una sucursal: SKU, código de barras y nombre de
 * cada producto con existencias, y una columna «contado» vacía. NO dice cuántos
 * hay (conteo a ciegas). Es también el formato que se sube de vuelta: las
 * columnas `sku`, `codigo_de_barras` y `contado` son las que lee la importación,
 * y las celdas de `contado` que se dejan vacías significan «no se contó».
 */
export function hojaDeConteoToCsv(filas: readonly FilaHojaParaCsv[]): string {
  return armarCsv(['sku', 'codigo_de_barras', 'producto', 'contado'], filas.map((f) => [SIN_FORMULA(f.sku), SIN_FORMULA(f.barcode), SIN_FORMULA(f.producto), '']))
}

export interface ConteoParaCsv {
  numero: string
  estado: EstadoConteo
  sucursalNombre: string
  nota: string | null
  creadoEn: Date
  aplicadoEn: Date | null
  abiertoPorNombre: string | null
  aplicadoPorNombre: string | null
  sinContar: number | null
  detalle: ReadonlyArray<{
    sku: string
    barcode: string | null
    itemNombre: string
    nombreVariante: string
    esDefault: boolean
    contado: number
    /** null = la lectura fue a ciegas: con eso no se puede armar un informe de diferencias. */
    esperado: number | null
    existenciaAntes: number | null
    existenciaDespues: number | null
    ajustado: boolean
  }>
}

/**
 * El informe de diferencias de un conteo: encabezado, resumen y una fila por
 * producto contado, de lo que más descuadra a lo que menos. «Esperado» es lo que
 * decía el sistema AL CONTAR; en un conteo aplicado, «antes/después» son las
 * existencias reales del momento de aplicar.
 */
export function conteoToCsv(c: ConteoParaCsv, zonaHoraria: string): string {
  const lineas = c.detalle.map((l) => {
    if (l.esperado === null) throw new Error('El informe de diferencias necesita lo que decía el sistema: la lectura fue a ciegas.')
    return { ...l, esperado: l.esperado, nombre: l.esDefault ? l.itemNombre : `${l.itemNombre} · ${l.nombreVariante}` }
  })
  const resumen = resumirVarianza(lineas)
  const aplicado = c.estado === 'APPLIED'
  return armarCsvBloques([
    {
      titulo: 'Conteo físico',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Número', c.numero],
        ['Estado', ETIQUETA_ESTADO_CONTEO[c.estado]],
        ['Sucursal', SIN_FORMULA(c.sucursalNombre)],
        ['Nota', SIN_FORMULA(c.nota)],
        ['Abierto', fechaHoraCsv(c.creadoEn, zonaHoraria)],
        ['Abierto por', SIN_FORMULA(c.abiertoPorNombre ?? 'Sistema')],
        ['Aplicado', c.aplicadoEn ? fechaHoraCsv(c.aplicadoEn, zonaHoraria) : ''],
        ['Aplicado por', SIN_FORMULA(c.aplicadoPorNombre)],
        ['Zona horaria', zonaHoraria],
        ['Productos contados', resumen.lineas],
        ['Coinciden', resumen.coinciden],
        ['Con sobrante', resumen.sobrantes],
        ['Con faltante', resumen.faltantes],
        ['Unidades sobrantes', resumen.unidadesSobrantes],
        ['Unidades faltantes', resumen.unidadesFaltantes],
        ['Con existencias y sin contar', c.sinContar ?? ''],
      ],
    },
    {
      titulo: 'Diferencias',
      encabezados: ['SKU', 'Codigo de barras', 'Producto', 'Esperado al contar', 'Contado', 'Diferencia', 'Resultado', 'Existencia antes de ajustar', 'Existencia despues de ajustar', 'Ajustado'],
      filas: ordenarPorDiferencia(lineas).map((l) => [
        SIN_FORMULA(l.sku),
        SIN_FORMULA(l.barcode),
        SIN_FORMULA(l.nombre),
        l.esperado,
        l.contado,
        diferenciaDeConteo(l.contado, l.esperado),
        ETIQUETA_RESULTADO[clasificarDiferencia(diferenciaDeConteo(l.contado, l.esperado))],
        aplicado ? (l.existenciaAntes ?? '') : '',
        aplicado ? (l.existenciaDespues ?? '') : '',
        aplicado ? (l.ajustado ? 'Si' : 'No') : '',
      ]),
    },
  ])
}

// ── INV-2c · Transferencias con envío ────────────────────────────────────────

export interface TrasladoParaCsv {
  numero: string
  estado: EstadoTraslado
  origenNombre: string
  destinoNombre: string
  nota: string | null
  creadoEn: Date
  cerradoEn: Date | null
  enviadoPorNombre: string | null
  cerradoPorNombre: string | null
  motivoCierre: string | null
  detalle: ReadonlyArray<{ sku: string; barcode: string | null; itemNombre: string; nombreVariante: string; esDefault: boolean; enviado: number; recibido: number; devuelto: number; perdido: number }>
  historial: ReadonlyArray<{ tipo: string; cantidad: number; sucursalNombre: string; producto: string; sku: string; creadoEn: Date; usuarioNombre: string | null; motivo: string | null }>
}

const ETIQUETA_TIPO_HISTORIAL: Record<string, string> = { TRANSFER_OUT: 'Salida del origen', TRANSFER_IN: 'Entrada al destino' }

/** Una transferencia con envío completa: encabezado, resumen, líneas y cada movimiento del ledger que produjo. */
export function trasladoToCsv(t: TrasladoParaCsv, zonaHoraria: string): string {
  const lineas = t.detalle.map((l) => ({ ...l, nombre: l.esDefault ? l.itemNombre : `${l.itemNombre} · ${l.nombreVariante}`, pendiente: pendienteDeLinea(l) }))
  const suma = (f: (l: (typeof lineas)[number]) => number) => lineas.reduce((s, l) => s + f(l), 0)
  return armarCsvBloques([
    {
      titulo: 'Transferencia',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Número', t.numero],
        ['Estado', ETIQUETA_ESTADO_TRASLADO[t.estado]],
        ['Origen', SIN_FORMULA(t.origenNombre)],
        ['Destino', SIN_FORMULA(t.destinoNombre)],
        ['Nota', SIN_FORMULA(t.nota)],
        ['Enviada', fechaHoraCsv(t.creadoEn, zonaHoraria)],
        ['Enviada por', SIN_FORMULA(t.enviadoPorNombre ?? 'Sistema')],
        ['Cerrada', t.cerradoEn ? fechaHoraCsv(t.cerradoEn, zonaHoraria) : ''],
        ['Cerrada por', SIN_FORMULA(t.cerradoPorNombre)],
        ['Motivo del cierre', SIN_FORMULA(t.motivoCierre)],
        ['Zona horaria', zonaHoraria],
        ['Productos', lineas.length],
        ['Unidades enviadas', suma((l) => l.enviado)],
        ['Unidades recibidas', suma((l) => l.recibido)],
        ['Unidades devueltas al origen', suma((l) => l.devuelto)],
        ['Unidades perdidas', suma((l) => l.perdido)],
        ['Unidades en camino', suma((l) => l.pendiente)],
      ],
    },
    {
      titulo: 'Líneas',
      encabezados: ['SKU', 'Codigo de barras', 'Producto', 'Enviado', 'Recibido', 'Devuelto al origen', 'Perdido', 'En camino'],
      filas: lineas.map((l) => [SIN_FORMULA(l.sku), SIN_FORMULA(l.barcode), SIN_FORMULA(l.nombre), l.enviado, l.recibido, l.devuelto, l.perdido, l.pendiente]),
    },
    {
      titulo: 'Movimientos',
      encabezados: ['Fecha y hora', 'Movimiento', 'Sucursal', 'SKU', 'Producto', 'Cantidad', 'Usuario', 'Motivo'],
      filas: t.historial.map((m) => [
        fechaHoraCsv(m.creadoEn, zonaHoraria),
        ETIQUETA_TIPO_HISTORIAL[m.tipo] ?? m.tipo,
        SIN_FORMULA(m.sucursalNombre),
        SIN_FORMULA(m.sku),
        SIN_FORMULA(m.producto),
        m.cantidad,
        SIN_FORMULA(m.usuarioNombre ?? 'Sistema'),
        SIN_FORMULA(m.motivo),
      ]),
    },
  ])
}
