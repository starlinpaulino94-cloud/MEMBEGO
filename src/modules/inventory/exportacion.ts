import type { InventoryMovementType } from '@prisma/client'
import { armarCsv, armarCsvBloques } from '@/lib/csv'
import { ETIQUETA_ESTADO_ORDEN, type EstadoOrden } from './compras'
import { resumirReposicion, type GrupoDeReposicion } from './reposicion'
import { formatearCosto, formatearMonto, valorDe } from './costos'
import { ETIQUETA_ESTADO_TRASLADO, pendienteDeLinea, type EstadoTraslado } from './traslados'
import { ETIQUETA_ESTADO_CONTEO, ETIQUETA_RESULTADO, clasificarDiferencia, diferenciaDeConteo, ordenarPorDiferencia, resumirVarianza, type EstadoConteo } from './conteos'
import { ETIQUETA_MOVIMIENTO, describirReferencia } from './formato'
import { ETIQUETA_ESTADO_COBERTURA, describirCambioDeCubeta } from './reportes'
import { detalleDeMotivo, etiquetaDeMotivo } from './motivos'
import type { KardexVista, RotacionVista, SinVentasVista } from './reportes-queries'
import type { MermasVista } from './mermas-queries'
import { ETIQUETA_GRUPO, GRUPOS_DE_MERMA } from './mermas'
import type { MargenVista } from './margen-queries'
import { ETIQUETA_EXCLUIDA, formatearMontoFirmado } from './margen'
import { ETIQUETA_CLASE } from './motivos'
import type { VencimientosVista } from './vencimientos-queries'
import { ETIQUETA_CLASE_VENCIMIENTO, ETIQUETA_URGENCIA } from './vencimientos'

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
  /** INV-4b: el código del motivo del catálogo (ajustes y daños); null en lo demás y en todo lo anterior a INV-4b. */
  motivoCodigo?: string | null
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
        'Motivo (catalogo)',
        'Detalle del motivo',
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
        f.motivoCodigo ? etiquetaDeMotivo(f.motivoCodigo) : '',
        SIN_FORMULA(detalleDeMotivo(f.motivoCodigo, f.motivo)),
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
  /** INV-3a: lo que costó la entrada. Si falta (porque quien exporta no puede ver costos) el archivo no lleva ninguna cifra de costo. */
  valorTotal?: string
  detalle: ReadonlyArray<{ sku: string; barcode: string | null; itemNombre: string; nombreVariante: string; esDefault: boolean; cantidad: number; existenciaAntes: number; existenciaDespues: number; costo?: string | null }>
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
        ...(e.valorTotal !== undefined ? [['Costo de la entrada (solo lineas con costo)', e.valorTotal]] : []),
      ],
    },
    {
      titulo: 'Líneas',
      encabezados: ['SKU', 'Codigo de barras', 'Producto', 'Cantidad', 'Existencia antes', 'Existencia despues', ...(e.valorTotal !== undefined ? ['Costo unitario'] : [])],
      filas: e.detalle.map((l) => [
        SIN_FORMULA(l.sku),
        SIN_FORMULA(l.barcode),
        SIN_FORMULA(l.esDefault ? l.itemNombre : `${l.itemNombre} · ${l.nombreVariante}`),
        l.cantidad,
        l.existenciaAntes,
        l.existenciaDespues,
        ...(e.valorTotal !== undefined ? [l.costo ?? 'Sin costo'] : []),
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

// ── INV-3a · Valor del inventario ────────────────────────────────────────────

export interface ValorParaCsv {
  resumen: { valor: string; unidades: number; unidadesSinCosto: number; productos: number; productosSinCosto: number; danadas: number }
  porSucursal: ReadonlyArray<{ nombre: string; activa: boolean; unidades: number; unidadesSinCosto: number; valor: string }>
  enTransito: { unidades: number; unidadesSinCosto: number; valor: string } | null
  costoDeVentas: { mes: string; costo: string; unidadesVendidas: number; unidadesSinCosto: number; unidadesDevueltas: number }
  filas: ReadonlyArray<{ nombre: string; sku: string; unidades: number; danadas: number; costo: string | null; fuente: 'PROMEDIO' | 'REFERENCIA' | null; valor: string | null }>
  totalFilas: number
}

/** Un monto ya formateado con separador de miles («1,234.50») a número plano («1234.50») para que la hoja de cálculo lo sume. */
const plano = (t: string | null): string => (t === null ? '' : t.replace(/,/g, ''))

const ETIQUETA_FUENTE = { PROMEDIO: 'Costo promedio de las entradas', REFERENCIA: 'Costo de referencia del catálogo' } as const

/**
 * El valor del inventario para el contador: el resumen, el valor por sucursal y cada producto con su costo. Lo que no
 * tiene costo sale como «Sin costo» y con la celda del valor VACÍA —nunca en cero—. Si el tope cortó las filas, el
 * archivo lo dice.
 */
export function valorToCsv(v: ValorParaCsv, ctx: { zonaHoraria: string; generadoEn: Date; filtros: ReadonlyArray<readonly [string, string]>; tope: number }): string {
  const truncado = v.totalFilas > v.filas.length
  return armarCsvBloques([
    {
      titulo: 'Valor del inventario',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ['Productos en el archivo', v.filas.length],
        ...(truncado ? [['AVISO', `El archivo trae solo los primeros ${ctx.tope} de ${v.totalFilas} productos (los de más valor): filtra para ver el resto`]] : []),
        ['Productos con existencias', v.resumen.productos],
        ['Unidades en existencia (vendible, apartado y dañado)', v.resumen.unidades],
        ['De ellas dañadas', v.resumen.danadas],
        ['Valor del inventario (solo productos con costo)', plano(v.resumen.valor)],
        ['Productos SIN costo (no suman al valor)', v.resumen.productosSinCosto],
        ['Unidades SIN costo (no suman al valor)', v.resumen.unidadesSinCosto],
        ...(v.enTransito ? [['En camino entre sucursales: unidades', v.enTransito.unidades], ['En camino entre sucursales: valor', plano(v.enTransito.valor)]] : []),
        [`Costo de ventas de ${v.costoDeVentas.mes}`, plano(v.costoDeVentas.costo)],
        [`Unidades vendidas en ${v.costoDeVentas.mes}`, v.costoDeVentas.unidadesVendidas],
        [`Unidades vendidas sin costo conocido en ${v.costoDeVentas.mes}`, v.costoDeVentas.unidadesSinCosto],
      ],
    },
    {
      titulo: 'Por sucursal',
      encabezados: ['Sucursal', 'Unidades', 'Unidades sin costo', 'Valor'],
      filas: v.porSucursal.map((s) => [SIN_FORMULA(s.activa ? s.nombre : `${s.nombre} (desactivada)`), s.unidades, s.unidadesSinCosto, plano(s.valor)]),
    },
    {
      titulo: 'Productos',
      encabezados: ['Producto', 'SKU', 'Unidades', 'Danadas', 'Costo unitario', 'Fuente del costo', 'Valor'],
      filas: v.filas.map((f) => [SIN_FORMULA(f.nombre), SIN_FORMULA(f.sku), f.unidades, f.danadas, plano(f.costo), f.fuente ? ETIQUETA_FUENTE[f.fuente] : 'Sin costo', plano(f.valor)]),
    },
  ])
}

// ── INV-3b · Órdenes de compra ───────────────────────────────────────────────

export interface OrdenParaCsv {
  numero: string
  estado: EstadoOrden
  proveedorNombre: string
  sucursalNombre: string
  referencia: string | null
  nota: string | null
  creadoEn: Date
  pedidoEn: Date | null
  previstaEn: Date | null
  cerradoEn: Date | null
  creadoPorNombre: string | null
  pedidoPorNombre: string | null
  cerradoPorNombre: string | null
  motivoCierre: string | null
  valor: string
  valorRecibido: string
  valorPendiente: string
  detalle: ReadonlyArray<{ sku: string; barcode: string | null; itemNombre: string; nombreVariante: string; esDefault: boolean; pedido: number; recibido: number; cancelado: number; pendiente: number; costo: string; valor: string; lotesRecibidos?: string | null }>
  entradas: ReadonlyArray<{ numero: string; creadoEn: Date; referencia: string | null; unidades: number; usuarioNombre: string | null }>
}

/** Una orden de compra completa: encabezado y resumen, cada línea con su costo y cada entrada de mercancía que produjo. */
export function ordenToCsv(o: OrdenParaCsv, zonaHoraria: string): string {
  const suma = (f: (l: OrdenParaCsv['detalle'][number]) => number) => o.detalle.reduce((s, l) => s + f(l), 0)
  return armarCsvBloques([
    {
      titulo: 'Orden de compra',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Número', o.numero],
        ['Estado', ETIQUETA_ESTADO_ORDEN[o.estado]],
        ['Proveedor', SIN_FORMULA(o.proveedorNombre)],
        ['Recibe la sucursal', SIN_FORMULA(o.sucursalNombre)],
        ['Referencia', SIN_FORMULA(o.referencia)],
        ['Nota', SIN_FORMULA(o.nota)],
        ['Creada', fechaHoraCsv(o.creadoEn, zonaHoraria)],
        ['Creada por', SIN_FORMULA(o.creadoPorNombre ?? 'Sistema')],
        ['Pedida', o.pedidoEn ? fechaHoraCsv(o.pedidoEn, zonaHoraria) : ''],
        ['Pedida por', SIN_FORMULA(o.pedidoPorNombre)],
        // La fecha prevista es un día, no un instante: se escribe tal cual (medianoche UTC) y no en la zona de la empresa.
        ['Fecha prevista', o.previstaEn ? o.previstaEn.toISOString().slice(0, 10) : ''],
        ['Cerrada', o.cerradoEn ? fechaHoraCsv(o.cerradoEn, zonaHoraria) : ''],
        ['Cerrada por', SIN_FORMULA(o.cerradoPorNombre)],
        ['Motivo del cierre', SIN_FORMULA(o.motivoCierre)],
        ['Zona horaria', zonaHoraria],
        ['Productos', o.detalle.length],
        ['Unidades pedidas', suma((l) => l.pedido)],
        ['Unidades recibidas', suma((l) => l.recibido)],
        ['Unidades cerradas como faltante', suma((l) => l.cancelado)],
        ['Unidades por llegar', suma((l) => l.pendiente)],
        ['Valor pedido', plano(o.valor)],
        ['Valor recibido', plano(o.valorRecibido)],
        ['Valor por llegar', plano(o.valorPendiente)],
      ],
    },
    {
      titulo: 'Líneas',
      encabezados: ['SKU', 'Codigo de barras', 'Producto', 'Costo unitario', 'Pedido', 'Recibido', 'Faltante', 'Por llegar', 'Valor pedido', 'Lotes recibidos'],
      // INV-5b2: de qué lotes llegó lo recibido («A-1 ×4, B ×2»); vacío si el producto no lleva lotes. El código de un lote es texto libre.
      filas: o.detalle.map((l) => [SIN_FORMULA(l.sku), SIN_FORMULA(l.barcode), SIN_FORMULA(l.esDefault ? l.itemNombre : `${l.itemNombre} · ${l.nombreVariante}`), plano(l.costo), l.pedido, l.recibido, l.cancelado, l.pendiente, plano(l.valor), SIN_FORMULA(l.lotesRecibidos ?? null)]),
    },
    {
      titulo: 'Entradas de mercancía',
      encabezados: ['Entrada', 'Fecha y hora', 'Unidades', 'Factura o referencia', 'Registrada por'],
      filas: o.entradas.map((e) => [e.numero, fechaHoraCsv(e.creadoEn, zonaHoraria), e.unidades, SIN_FORMULA(e.referencia), SIN_FORMULA(e.usuarioNombre ?? 'Sistema')]),
    },
  ])
}

// ── INV-3c · Reposición ──────────────────────────────────────────────────────

/**
 * Lo que hay que reponer, para llevarlo al proveedor o a una hoja de cálculo: un bloque de resumen y una fila por producto y
 * sucursal, con su proveedor y su costo. Los números van planos (se suman); un producto sin costo conocido deja VACÍAS las
 * celdas de costo y valor —nunca un cero—. Si la lista se cortó por el tope, el archivo lo dice.
 */
export function reposicionToCsv(grupos: readonly GrupoDeReposicion[], contexto: { alDia: number; conObjetivo: number; truncado: boolean; filtros: ReadonlyArray<readonly [string, string]> }): string {
  const resumen = resumirReposicion(grupos)
  return armarCsvBloques([
    {
      titulo: 'Reposición',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ...contexto.filtros.map(([k, v]) => [SIN_FORMULA(k), SIN_FORMULA(v)]),
        ['Productos por reponer', resumen.productos],
        ['Unidades sugeridas', resumen.unidades],
        ['Valor sugerido (con el último costo conocido)', plano(resumen.valor)],
        ['Productos sin proveedor al que pedirlos', resumen.sinProveedor],
        ['Productos sin costo conocido', resumen.sinCosto],
        ['Saldos con objetivo que están al día', contexto.alDia],
        ['Saldos con objetivo en total', contexto.conObjetivo],
        ...(contexto.truncado ? [['Aviso', 'Había más saldos con objetivo de los que caben en este archivo: la lista está cortada.']] : []),
      ],
    },
    {
      titulo: 'Qué comprar',
      encabezados: ['Proveedor', 'Sucursal', 'Producto', 'SKU', 'Codigo de barras', 'Disponible', 'Pedido', 'En camino', 'En borrador', 'Avisar en', 'Llenar hasta', 'Sugerida', 'Ultimo costo', 'Valor'],
      filas: grupos.flatMap((g) =>
        g.lineas.map((l) => [
          SIN_FORMULA(g.proveedor?.nombre ?? 'Sin proveedor'),
          SIN_FORMULA(g.sucursalNombre),
          SIN_FORMULA(l.esDefault ? l.producto : `${l.producto} · ${l.nombreVariante}`),
          SIN_FORMULA(l.sku),
          SIN_FORMULA(l.barcode),
          l.disponible,
          l.pedido,
          l.enCamino,
          l.enBorrador,
          l.umbral,
          l.llenarHasta,
          l.sugerida,
          l.ultimoCosto === null ? '' : plano(formatearCosto(l.ultimoCosto)),
          l.ultimoCosto === null ? '' : plano(formatearMonto(valorDe(l.sugerida, l.ultimoCosto))),
        ])
      ),
    },
  ])
}

// ── INV-4a · Informes de existencias ─────────────────────────────────────────

/** Un número con punto decimal y los decimales que hagan falta, o VACÍO si no hay (nunca un cero inventado). */
const decimal = (n: number | null, d = 2): string | number => (n === null ? '' : Number(n.toFixed(d)))

/** El día de una fecha en la zona de la empresa: `2026-10-13`. */
const diaCsv = (f: Date | null, zona: string): string => (f ? fechaHoraCsv(f, zona).slice(0, 10) : '')

interface ContextoInforme {
  zonaHoraria: string
  generadoEn: Date
  /** «Sucursal: Centro», «Producto: …» ya en palabras. */
  filtros: ReadonlyArray<readonly [string, string]>
}

/**
 * El kardex de UN producto para llevarlo a una hoja de cálculo: el resumen del periodo (apertura, entradas, salidas, cierre) y
 * cada movimiento con lo que entró o salió y el saldo que dejó. Las columnas de costo solo existen si quien exporta puede
 * verlos; un movimiento sin costo conocido deja VACÍAS sus celdas de costo y valor. Si el tope cortó los movimientos, el
 * archivo lo dice.
 */
export function kardexToCsv(k: KardexVista, ctx: Omit<ContextoInforme, 'filtros'> & { tope: number }): string {
  const c = k.conCostos
  return armarCsvBloques([
    {
      titulo: `Kardex · ${textoCsv(k.variante.nombre)}`,
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Producto', SIN_FORMULA(k.variante.nombre)],
        ['SKU', SIN_FORMULA(k.variante.sku)],
        ['Sucursal', SIN_FORMULA(k.sucursal ? k.sucursal.nombre : 'Todas')],
        ['Desde', k.desde],
        ['Hasta', k.hasta],
        ['Existencia al empezar (vendible, apartado y dañado)', k.apertura],
        ['Entradas', k.totales.entradas],
        ['Salidas', k.totales.salidas],
        ['Existencia al terminar', k.cierre],
        ...(c
          ? [
              ['Valor de las entradas (solo las que tienen costo)', plano(formatearMonto(k.totales.valorEntradas))],
              ['Valor de las salidas (solo las que tienen costo)', plano(formatearMonto(k.totales.valorSalidas))],
              ['Unidades que entraron SIN costo (no suman al valor)', k.totales.entradasSinCosto],
              ['Unidades que salieron SIN costo (no suman al valor)', k.totales.salidasSinCosto],
            ]
          : []),
        ['Movimientos en el archivo', k.filas.length],
        [
          'Datos completos',
          k.truncado ? `NO - el archivo trae solo los primeros ${ctx.tope} movimientos del periodo; las existencias al terminar son las del periodo completo. Acota las fechas y vuelve a exportar.` : 'Si',
        ],
      ],
    },
    {
      titulo: 'Movimientos (del más antiguo al más reciente)',
      encabezados: ['Fecha y hora', 'Sucursal', 'Movimiento', 'Entra', 'Sale', 'Saldo', 'Cambio de cubeta', ...(c ? ['Costo unitario', 'Valor'] : []), 'Motivo (catalogo)', 'Detalle del motivo', 'Usuario', 'Referencia'],
      filas: k.filas.map((f) => [
        fechaHoraCsv(f.creadoEn, ctx.zonaHoraria),
        SIN_FORMULA(f.sucursalNombre),
        ETIQUETA_MOVIMIENTO[f.tipo as InventoryMovementType] ?? f.tipo,
        f.entra,
        f.sale,
        f.saldo,
        SIN_FORMULA(describirCambioDeCubeta(f)),
        // Apartar, dañar y recuperar no entran ni salen: no llevan costo en el kardex (el costo del daño vive en sus propios informes).
        ...(c ? [f.sentido === 'INTERNO' || f.costo === null ? '' : plano(formatearCosto(f.costo)), f.valor === null ? '' : plano(formatearMonto(f.valor))] : []),
        f.motivoCodigo ? etiquetaDeMotivo(f.motivoCodigo) : '',
        SIN_FORMULA(detalleDeMotivo(f.motivoCodigo, f.motivo)),
        SIN_FORMULA(f.usuarioNombre ?? 'Sistema'),
        SIN_FORMULA(describirReferencia(f.referenciaTipo, f.referenciaId)),
      ]),
    },
  ])
}

/**
 * El stock sin ventas: lo que tiene existencias y lleva N días sin venderse, de lo que más dinero inmoviliza a lo que menos. Sin
 * la función de costos el archivo no trae costo ni valor. Un producto sin costo conocido deja esas celdas VACÍAS.
 */
export function sinVentasToCsv(v: SinVentasVista, ctx: ContextoInforme & { tope: number }): string {
  const conCostos = v.resumen.valor !== null
  const truncado = v.total > v.filas.length
  return armarCsvBloques([
    {
      titulo: `Stock sin ventas en ${v.dias} días`,
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Días sin vender', v.dias],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ['Saldos (producto y sucursal) sin ventas', v.total],
        ['Unidades inmovilizadas', v.resumen.unidades],
        ...(conCostos
          ? [
              ['Valor inmovilizado (solo lo que tiene costo)', plano(formatearMonto(v.resumen.valor!))],
              ['Unidades SIN costo (no suman al valor)', v.resumen.unidadesSinCosto ?? 0],
            ]
          : []),
        ['Filas en el archivo', v.filas.length],
        ['Datos completos', truncado ? `NO - el archivo trae solo los primeros ${ctx.tope} de ${v.total} saldos. Filtra por sucursal o producto para ver el resto.` : 'Si'],
      ],
    },
    {
      titulo: 'Saldos sin ventas',
      encabezados: ['Producto', 'SKU', 'Sucursal', 'Existencia', 'Ultima venta', 'Dias sin vender', 'Ultima entrada', ...(conCostos ? ['Costo unitario', 'Valor'] : [])],
      filas: v.filas.map((f) => [
        SIN_FORMULA(f.nombre),
        SIN_FORMULA(f.sku),
        SIN_FORMULA(f.sucursalActiva ? f.sucursalNombre : `${f.sucursalNombre} (desactivada)`),
        f.existencia,
        f.ultimaVenta ? diaCsv(f.ultimaVenta, ctx.zonaHoraria) : 'Nunca',
        f.diasSinVender ?? '',
        diaCsv(f.ultimaEntrada, ctx.zonaHoraria),
        ...(conCostos ? [f.costo === null ? '' : plano(formatearCosto(f.costo)), f.valor === null ? '' : plano(formatearMonto(f.valor))] : []),
      ]),
    },
  ])
}

/**
 * «Vence pronto»: los lotes con existencias que ya vencieron o vencen dentro de la ventana, por sucursal. El archivo dice qué ventana y
 * qué filtros tenía (dos archivos del mismo día no se distinguen si no), cuántos lotes y unidades vendibles suma y, si el tope lo cortó,
 * que lo cortó. Con la función de costos suma el valor de lo vendible que vence; sin ella el archivo no trae nada valorado. Un lote
 * sin costo conocido deja VACÍAS sus celdas de costo y valor (no vale cero: no se sabe). Los días restantes van en negativo si ya venció.
 */
export function vencimientosToCsv(v: VencimientosVista, ctx: ContextoInforme & { tope: number }): string {
  const conCostos = v.resumen.valor !== null
  const truncado = v.total > v.filas.length
  return armarCsvBloques([
    {
      titulo: `Lotes que vencen en ${v.dias} dias o ya vencieron`,
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Hoy (dia de la empresa)', v.hoy],
        ['Ventana (dias)', v.dias],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ['Lotes distintos', v.resumen.lotes],
        ['Lotes ya vencidos', v.resumen.lotesVencidos],
        ['Lotes en sucursal (filas)', v.total],
        ['Unidades vendibles', v.resumen.unidades],
        ...(conCostos
          ? [
              ['Valor de lo vendible (solo lo que tiene costo)', plano(formatearMonto(v.resumen.valor!))],
              ['Unidades SIN costo (no suman al valor)', v.resumen.unidadesSinCosto ?? 0],
            ]
          : []),
        ['Filas en el archivo', v.filas.length],
        ['Datos completos', truncado ? `NO - el archivo trae solo los primeros ${ctx.tope} de ${v.total} lotes. Filtra por sucursal, estado o producto para ver el resto.` : 'Si'],
      ],
    },
    {
      titulo: 'Lotes',
      encabezados: ['Producto', 'SKU', 'Sucursal', 'Lote', 'Vence', 'Dias restantes', 'Estado', 'Urgencia', 'Vendible', 'Apartado', 'Danado', ...(conCostos ? ['Costo unitario', 'Valor'] : [])],
      filas: v.filas.map((f) => [
        SIN_FORMULA(f.nombre),
        SIN_FORMULA(f.sku),
        SIN_FORMULA(f.sucursalActiva ? f.sucursalNombre : `${f.sucursalNombre} (desactivada)`),
        SIN_FORMULA(f.codigo),
        f.vencimiento,
        f.diasRestantes,
        ETIQUETA_CLASE_VENCIMIENTO[f.clase],
        ETIQUETA_URGENCIA[f.urgencia],
        f.vendible,
        f.apartado,
        f.danado,
        ...(conCostos ? [f.costo === null ? '' : plano(formatearCosto(f.costo)), f.valor === null ? '' : plano(formatearMonto(f.valor))] : []),
      ]),
    },
  ])
}

/**
 * La rotación y la cobertura: por producto lo vendido (menos lo devuelto), el ritmo diario, cuántas veces rotó la existencia
 * promedio y para cuántos días alcanza lo que hay. Con la función de costos suma el costo de ventas, el valor del inventario y los
 * días de inventario; sin ella el archivo no trae nada valorado. La cobertura de un producto sin ventas va VACÍA: no hay ritmo.
 */
export function rotacionToCsv(v: RotacionVista, ctx: ContextoInforme & { tope: number }): string {
  const truncadoPorTope = v.truncado
  const recortado = v.total > v.filas.length
  return armarCsvBloques([
    {
      titulo: `Rotación y cobertura de los últimos ${v.dias} días`,
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Periodo en días', v.dias],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ['Productos en el archivo', v.filas.length],
        ['Unidades vendidas (menos devueltas), de todos los productos del filtro', v.unidadesVendidas],
        ...(['AGOTADO', 'POCA', 'NORMAL', 'EXCESO', 'SIN_VENTAS'] as const).map((e): [string, number] => [`Productos: ${ETIQUETA_ESTADO_COBERTURA[e]}`, v.porEstado[e]]),
        ...(v.valorado
          ? [
              ['Costo de ventas del periodo (solo lo que tenía costo)', plano(formatearMonto(v.valorado.costoDeVentas))],
              ['Unidades vendidas SIN costo conocido (no suman al costo de ventas)', v.valorado.unidadesSinCosto],
              ['Valor del inventario (solo lo que tiene costo)', plano(formatearMonto(v.valorado.valorInventario))],
              ['Dias de inventario', v.valorado.diasDeInventario ?? ''],
            ]
          : []),
        [
          'Datos completos',
          truncadoPorTope
            ? `NO - había más productos de los que se leen (${ctx.tope}): se leyeron primero los que más vendieron. Filtra por sucursal o producto.`
            : recortado
              ? `NO - el archivo trae solo los primeros ${ctx.tope} de ${v.total} productos. Filtra por estado, sucursal o producto.`
              : 'Si',
        ],
      ],
    },
    {
      titulo: 'Productos (de lo más urgente a lo que no se vende)',
      encabezados: ['Producto', 'SKU', 'Existencia', 'Disponible', 'Vendidas', 'Venta diaria', 'Existencia promedio', 'Veces que rotó', 'Cobertura en dias', 'Estado', 'Ultima venta'],
      filas: v.filas.map((f) => [
        SIN_FORMULA(f.nombre),
        SIN_FORMULA(f.sku),
        f.existencia,
        f.disponible,
        f.vendidas,
        decimal(f.ventaDiaria, 2),
        decimal(f.existenciaPromedio, 1),
        decimal(f.veces, 2),
        decimal(f.coberturaDias, 1),
        ETIQUETA_ESTADO_COBERTURA[f.estado],
        diaCsv(f.ultimaVenta, ctx.zonaHoraria),
      ]),
    },
  ])
}

/**
 * Las mermas por motivo para llevarlas a una hoja de cálculo: el resumen de cada grupo (lo perdido, los sobrantes, lo dañado), cada
 * grupo POR MOTIVO, y el detalle movimiento por movimiento. Las columnas de costo solo existen si quien exporta puede verlas; un
 * movimiento sin costo conocido deja VACÍAS sus celdas de costo y valor (nunca un cero). Si el tope cortó el detalle, el archivo lo
 * dice. «Sin motivo codificado» es lo anterior a INV-4b o lo hecho por procesos que no eligen uno.
 */
export function mermasToCsv(v: MermasVista, ctx: ContextoInforme & { tope: number }): string {
  const c = v.conCostos
  const cortado = v.total > v.movimientos.length
  return armarCsvBloques([
    {
      titulo: 'Mermas por motivo',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Desde', v.desde],
        ['Hasta', v.hasta],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ...GRUPOS_DE_MERMA.flatMap((g): Array<[string, string | number]> => {
          const t = v.grupos[g].total
          return [
            [`${ETIQUETA_GRUPO[g]}: movimientos`, t.movimientos],
            [`${ETIQUETA_GRUPO[g]}: unidades`, t.unidades],
            ...(c ? ([[`${ETIQUETA_GRUPO[g]}: valor (solo lo que tiene costo)`, t.valor === null ? '' : plano(formatearMonto(t.valor))], [`${ETIQUETA_GRUPO[g]}: unidades SIN costo (no suman al valor)`, t.unidadesSinCosto ?? 0]] as Array<[string, string | number]>) : []),
          ]
        }),
        ['Movimientos en el archivo', v.movimientos.length],
        ['Datos completos', cortado ? `NO - el archivo trae solo los ${ctx.tope} movimientos más recientes de ${v.total}. Acota las fechas o los filtros y vuelve a exportar.` : 'Si'],
      ],
    },
    {
      titulo: 'Por motivo',
      encabezados: ['Grupo', 'Motivo', 'Movimientos', 'Unidades', ...(c ? ['Valor', 'Unidades sin costo'] : [])],
      filas: GRUPOS_DE_MERMA.flatMap((g) =>
        v.grupos[g].filas.map((f) => [ETIQUETA_GRUPO[g], SIN_FORMULA(f.etiqueta), f.movimientos, f.unidades, ...(c ? [f.valor === null ? '' : plano(formatearMonto(f.valor)), f.unidadesSinCosto ?? ''] : [])])
      ),
    },
    {
      titulo: 'Movimientos (del más reciente al más antiguo)',
      encabezados: ['Fecha y hora', 'Clase', 'Motivo', 'Detalle del motivo', 'Producto', 'SKU', 'Sucursal', 'Unidades', ...(c ? ['Costo unitario', 'Valor'] : []), 'Usuario'],
      filas: v.movimientos.map((m) => [
        fechaHoraCsv(m.creadoEn, ctx.zonaHoraria),
        ETIQUETA_CLASE[m.clase],
        SIN_FORMULA(m.etiquetaMotivo),
        SIN_FORMULA(m.detalle),
        SIN_FORMULA(m.producto),
        SIN_FORMULA(m.sku),
        SIN_FORMULA(m.sucursalNombre),
        m.unidades,
        ...(c ? [m.costo === null ? '' : plano(formatearCosto(m.costo)), m.valor === null ? '' : plano(formatearMonto(m.valor))] : []),
        SIN_FORMULA(m.usuarioNombre ?? 'Sistema'),
      ]),
    },
  ])
}

/**
 * El margen real para llevarlo a una hoja de cálculo: el resumen (lo vendido, lo cobrado, lo que costó, el margen y su porcentaje),
 * lo vendido que NO entra al margen y por qué, y un renglón por producto. Los montos van planos, sin separador de miles, y el margen
 * con un `-` normal si es negativo (para que la hoja lo sume). Lo que no se puede calcular (un porcentaje sin base) queda VACÍO, nunca
 * cero. Si el tope cortó los productos, el archivo lo dice.
 */
export function margenToCsv(v: MargenVista, ctx: ContextoInforme & { tope: number }): string {
  const dinero = (c: bigint) => plano(formatearMontoFirmado(c, '-'))
  const pct = (n: number | null) => (n === null ? '' : n.toFixed(1))
  const t = v.totales
  const cortado = t.productos > v.filas.length
  return armarCsvBloques([
    {
      titulo: 'Margen real',
      encabezados: ['Concepto', 'Valor'],
      filas: [
        ['Generado', fechaHoraCsv(ctx.generadoEn, ctx.zonaHoraria)],
        ['Zona horaria', ctx.zonaHoraria],
        ['Moneda', SIN_FORMULA(v.moneda)],
        ['Desde', v.desde],
        ['Hasta', v.hasta],
        ...ctx.filtros.map(([k, val]): [string, string] => [`Filtro: ${k}`, SIN_FORMULA(val)]),
        ['Productos vendidos', t.productos],
        ['Unidades vendidas', t.unidades],
        ['Ingresos (precio de la línea menos su descuento y sin impuestos)', dinero(t.ingresos)],
        ['Costo de lo vendido (solo lo que tiene costo)', dinero(t.costo)],
        ['Margen', dinero(t.margen)],
        ['Margen %', pct(t.margenPct)],
        ['Unidades sin costo (no entran al margen)', t.unidadesSinCosto],
        ['Ingresos de esas unidades (no entran al margen)', dinero(t.ingresosSinCosto)],
        ...v.excluidas.flatMap((e): Array<[string, string | number]> => [
          [`${ETIQUETA_EXCLUIDA[e.clase]} (fuera del margen): unidades`, e.unidades],
          [`${ETIQUETA_EXCLUIDA[e.clase]} (fuera del margen): costo`, dinero(e.costo)],
        ]),
        ['Productos en el archivo', v.filas.length],
        ['Datos completos', cortado ? `NO - el archivo trae solo ${ctx.tope} de ${t.productos} productos. Acota las fechas o los filtros y vuelve a exportar.` : 'Si'],
      ],
    },
    {
      titulo: 'Por producto',
      encabezados: ['Producto', 'SKU', 'Unidades', 'Ingresos', 'Costo', 'Margen', 'Margen %', 'Unidades sin costo', 'Ingresos sin costo'],
      filas: v.filas.map((f) => [SIN_FORMULA(f.producto), SIN_FORMULA(f.sku), f.unidades, dinero(f.ingresos), dinero(f.costo), dinero(f.margen), pct(f.margenPct), f.unidadesSinCosto, dinero(f.ingresosSinCosto)]),
    },
  ])
}
