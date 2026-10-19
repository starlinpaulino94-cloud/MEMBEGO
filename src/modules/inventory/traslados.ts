import { exigirTransicion, puedeTransicionar, type Transiciones } from '@/lib/commerce-primitives/estados'
import { CANTIDAD_MAXIMA, validarCantidad } from './domain'
import { MAX_LOTES_POR_LINEA, fusionarReparto, sumaDeReparto, type RepartoLote } from './lotes'

/**
 * COMMERCE CORE · inventario — transferencias CON ENVÍO entre sucursales
 * (INV-2c). PURO: sin base de datos ni servidor, para que lo usen el navegador, el
 * servicio (que lo vuelve a aplicar, porque no confía en lo que manda el
 * navegador) y las pruebas.
 *
 * El modelo en una frase: al enviar, las unidades SALEN del origen y quedan EN
 * TRÁNSITO —no disponibles en ninguna sucursal—; el destino las recibe en una o
 * varias recepciones; lo que no llegue se cancela (vuelve al origen) o se cierra
 * con faltante y motivo. La transferencia directa de siempre (sale y entra al
 * mismo tiempo) no pasa por aquí.
 */

/** Prefijo del correlativo: `TRF-2026-000001`. */
export const PREFIJO_TRASLADO = 'TRF'
/** Productos por transferencia (como una entrada a mano). */
export const MAX_LINEAS_TRASLADO = 200
export const MAX_NOTA_TRASLADO = 500
export const MAX_MOTIVO_TRASLADO = 300

// ── Estados ──────────────────────────────────────────────────────────────────

export type EstadoTraslado = 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

export const ETIQUETA_ESTADO_TRASLADO: Record<EstadoTraslado, string> = {
  SENT: 'En camino',
  PARTIAL: 'Recibida en parte',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
}

/**
 * Qué estado puede seguir a cuál. Una transición que no esté aquí NO OCURRE (la
 * base tiene la misma tabla en un disparador). Se puede seguir recibiendo en
 * `PARTIAL` sin cambiar de estado: eso no es una transición.
 */
export const TRANSICIONES_TRASLADO: Transiciones<EstadoTraslado> = {
  SENT: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
}

export function esEstadoTraslado(v: unknown): v is EstadoTraslado {
  return v === 'SENT' || v === 'PARTIAL' || v === 'RECEIVED' || v === 'CANCELLED'
}

/** Mientras está en camino o recibida en parte, todavía se puede recibir o cancelar. */
export function estaAbierto(e: EstadoTraslado): boolean {
  return e === 'SENT' || e === 'PARTIAL'
}

export function puedePasarA(desde: EstadoTraslado, hasta: EstadoTraslado): boolean {
  return puedeTransicionar(TRANSICIONES_TRASLADO, desde, hasta)
}

export function exigirPasoDeEstado(desde: EstadoTraslado, hasta: EstadoTraslado): void {
  exigirTransicion(TRANSICIONES_TRASLADO, desde, hasta, 'La transferencia')
}

// ── Lo que se envía ──────────────────────────────────────────────────────────

export interface LineaTraslado {
  varianteId: string
  cantidad: number
  /**
   * INV-5b4: de qué lotes es la línea, por ID de lote (`[{ loteId, cantidad }]`, que suman `cantidad`). Al ENVIAR: de qué lotes del origen
   * sale; sin decirlo, el que antes vence (FEFO). Al RECIBIR: de qué lotes de lo enviado llegó; ver `repartoDeRecepcion`. En un producto
   * sin lotes no puede venir. Aquí llega como lo mandó quien captura (sin validar): lo valida `validarRepartoDeLinea`.
   */
  lotes?: unknown
}

export type ResultadoLineasTraslado = { ok: true; lineas: LineaTraslado[]; unidades: number } | { ok: false; codigo: string; error: string }

/**
 * Valida las líneas de un envío: al menos una, no más del tope, cada variante UNA
 * sola vez y cada cantidad un entero de 1 a CANTIDAD_MAXIMA.
 */
export function validarLineasTraslado(lineas: unknown, max: number = MAX_LINEAS_TRASLADO): ResultadoLineasTraslado {
  if (!Array.isArray(lineas) || lineas.length === 0) return { ok: false, codigo: 'TRASLADO_SIN_LINEAS', error: 'Agrega al menos un producto al envío.' }
  if (lineas.length > max) return { ok: false, codigo: 'DEMASIADAS_LINEAS', error: `Un envío admite hasta ${max} productos; este trae ${lineas.length}. Divídelo en varios.` }
  const vistas = new Set<string>()
  const limpias: LineaTraslado[] = []
  let unidades = 0
  for (const crudo of lineas as unknown[]) {
    const l = crudo as { varianteId?: unknown; cantidad?: unknown } | null
    const id = typeof l?.varianteId === 'string' ? l.varianteId.trim() : ''
    if (id === '' || id.length > 120) return { ok: false, codigo: 'LINEA_INVALIDA', error: 'Una de las líneas no indica qué producto es.' }
    if (vistas.has(id)) return { ok: false, codigo: 'LINEA_REPETIDA', error: 'Un producto aparece más de una vez en el envío: junta sus cantidades en una sola línea.' }
    vistas.add(id)
    const c = validarCantidad(l?.cantidad)
    if (!c.ok) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: c.error }
    // INV-5b4: los lotes de la línea, si los trae, tienen que estar bien armados y sumar su cantidad.
    const lotes = (l as { lotes?: unknown } | null)?.lotes
    if (!sinLotes(lotes)) {
      const r = validarRepartoDeLinea(lotes, c.valor)
      if (!r.ok) return { ok: false, codigo: r.codigo, error: r.error }
      limpias.push({ varianteId: id, cantidad: c.valor, lotes: r.reparto })
    } else {
      limpias.push({ varianteId: id, cantidad: c.valor })
    }
    unidades += c.valor
  }
  return { ok: true, lineas: limpias, unidades }
}

// ── INV-5b4 · Los lotes de una línea ─────────────────────────────────────────

/** «No dijo lotes»: ausente, `null` o una lista vacía. */
export const sinLotes = (v: unknown): boolean => v === undefined || v === null || (Array.isArray(v) && v.length === 0)

export type ResultadoRepartoDeLinea = { ok: true; reparto: RepartoLote[] } | { ok: false; codigo: string; error: string }

/**
 * Valida los lotes que dice quien captura —`[{ loteId, cantidad }]`—: una lista de a lo más `MAX_LOTES_POR_LINEA` renglones, cada uno con
 * un id de lote y una cantidad entera positiva, y que SUMEN la cantidad de la línea. Un lote repetido se junta. No mira contra la base
 * (si el lote existe, es de ese producto o tiene existencias lo comprueba el servicio).
 */
export function validarRepartoDeLinea(lotes: unknown, cantidad: number): ResultadoRepartoDeLinea {
  if (!Array.isArray(lotes)) return { ok: false, codigo: 'LOTE_INVALIDO', error: 'Los lotes no están bien indicados.' }
  if (lotes.length > MAX_LOTES_POR_LINEA) return { ok: false, codigo: 'DEMASIADOS_LOTES', error: `Se admiten hasta ${MAX_LOTES_POR_LINEA} lotes por producto.` }
  const pedido: RepartoLote[] = []
  for (const crudo of lotes as unknown[]) {
    const x = crudo as { loteId?: unknown; cantidad?: unknown } | null
    const id = typeof x?.loteId === 'string' ? x.loteId.trim() : ''
    if (id === '' || id.length > 120) return { ok: false, codigo: 'LOTE_INVALIDO', error: 'Uno de los lotes no está bien indicado.' }
    const c = validarCantidad(x?.cantidad)
    if (!c.ok) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: `Lote: ${c.error}` }
    pedido.push({ loteId: id, cantidad: c.valor })
  }
  const reparto = fusionarReparto(pedido)
  const suma = sumaDeReparto(reparto)
  if (suma !== cantidad) {
    return { ok: false, codigo: 'LOTES_NO_CUADRAN', error: `Los lotes suman ${suma.toLocaleString('es-DO')} unidades y el producto es de ${cantidad.toLocaleString('es-DO')}.` }
  }
  return { ok: true, reparto }
}

// ── Lo que va llegando ───────────────────────────────────────────────────────

/** Una línea de una transferencia ya enviada, con lo que ha pasado con ella. */
export interface LineaDeTraslado {
  varianteId: string
  enviado: number
  recibido: number
  devuelto: number
  perdido: number
}

/** Lo que todavía no llegó, ni volvió, ni se dio por perdido: lo que está EN TRÁNSITO. */
export function pendienteDeLinea(l: Pick<LineaDeTraslado, 'enviado' | 'recibido' | 'devuelto' | 'perdido'>): number {
  return l.enviado - l.recibido - l.devuelto - l.perdido
}

export function enTransito(lineas: readonly LineaDeTraslado[]): number {
  return lineas.reduce((s, l) => s + pendienteDeLinea(l), 0)
}

export interface ResumenDeTraslado {
  enviadas: number
  recibidas: number
  devueltas: number
  perdidas: number
  enTransito: number
}

export function resumirTraslado(lineas: readonly LineaDeTraslado[]): ResumenDeTraslado {
  const r: ResumenDeTraslado = { enviadas: 0, recibidas: 0, devueltas: 0, perdidas: 0, enTransito: 0 }
  for (const l of lineas) {
    r.enviadas += l.enviado
    r.recibidas += l.recibido
    r.devueltas += l.devuelto
    r.perdidas += l.perdido
    r.enTransito += pendienteDeLinea(l)
  }
  return r
}

/**
 * Lo que se tecleó en una lista de lotes (`loteId → texto`) como reparto: los renglones con una cantidad entera de 1 en adelante, su suma y
 * si algún renglón está mal escrito (vacío o 0 no cuentan; un decimal, un negativo o letras sí son error). Para los formularios, que
 * muestran la suma y bloquean el envío antes de ir al servidor, que vuelve a validar todo.
 */
export function repartoDeTextos(valores: Readonly<Record<string, string>>): { reparto: RepartoLote[]; suma: number; hayError: boolean } {
  const reparto: RepartoLote[] = []
  let hayError = false
  for (const [loteId, crudo] of Object.entries(valores)) {
    const t = (crudo ?? '').trim()
    if (t === '' || t === '0') continue
    if (!/^\d{1,7}$/.test(t)) {
      hayError = true
      continue
    }
    reparto.push({ loteId, cantidad: Number(t) })
  }
  return { reparto, suma: sumaDeReparto(reparto), hayError }
}

/** Un lote de una transferencia con lo que ha pasado con él (todo sale del ledger: lo enviado, lo recibido y lo devuelto al origen). */
export interface LoteDeTraslado {
  loteId: string
  codigo: string
  /** `YYYY-MM-DD` o null (no vence). */
  vencimiento: string | null
  legado: boolean
  enviado: number
  recibido: number
  devuelto: number
}

/** Lo que de un lote sigue EN TRÁNSITO: enviado menos lo que llegó y lo que volvió al origen. (Lo perdido solo existe al cerrar, y entonces ya no se mira.) */
export function pendienteDeLote(l: Pick<LoteDeTraslado, 'enviado' | 'recibido' | 'devuelto'>): number {
  return l.enviado - l.recibido - l.devuelto
}

/**
 * De qué lotes llegó lo que se recibe de UNA línea de un producto con lotes. `pendientes` son los lotes de esa línea con lo que sigue en
 * tránsito de cada uno; `pedido` lo que dijo quien recibe (`[{ loteId, cantidad }]`), si lo dijo.
 *   · Con lotes: tienen que ser lotes de ESTA línea, suman la cantidad y ninguno pasa de lo que de él sigue en camino.
 *   · Sin lotes: si llega todo lo que falta de la línea, llega todo lo que falta de cada lote; si no, solo se sabe de qué lote es cuando
 *     de la línea queda UN solo lote en camino; con varios hay que decirlo (sería inventar de cuál).
 */
export function repartoDeRecepcion(pendientes: readonly LoteDeTraslado[], cantidad: number, pedido: unknown): ResultadoRepartoDeLinea {
  const vivos = pendientes.filter((l) => pendienteDeLote(l) > 0)
  const enCamino = vivos.reduce((s, l) => s + pendienteDeLote(l), 0)
  if (!sinLotes(pedido)) {
    const r = validarRepartoDeLinea(pedido, cantidad)
    if (!r.ok) return r
    const porId = new Map(pendientes.map((l) => [l.loteId, l]))
    for (const x of r.reparto) {
      const lote = porId.get(x.loteId)
      if (!lote) return { ok: false, codigo: 'LOTE_AJENO', error: 'Uno de los lotes no es de esta transferencia.' }
      const falta = pendienteDeLote(lote)
      if (x.cantidad > falta) {
        return {
          ok: false,
          codigo: 'RECIBE_MAS_DE_LO_ENVIADO',
          error: falta <= 0 ? `El lote ${lote.codigo} ya llegó completo.` : `Del lote ${lote.codigo} solo faltan ${falta.toLocaleString('es-DO')} por llegar; no puedes recibir ${x.cantidad.toLocaleString('es-DO')}.`,
        }
      }
    }
    return r
  }
  if (cantidad === enCamino) return { ok: true, reparto: vivos.map((l) => ({ loteId: l.loteId, cantidad: pendienteDeLote(l) })) }
  if (vivos.length === 1) return { ok: true, reparto: [{ loteId: vivos[0].loteId, cantidad }] }
  return { ok: false, codigo: 'LOTES_FALTAN', error: 'Este producto llega en varios lotes: indica de qué lote llegó lo que recibes (o recibe todo lo que falta).' }
}

/** De qué lotes vuelve al origen lo que sigue en tránsito al cancelar: de cada lote, todo lo que falta. */
export function repartoDeCancelacion(pendientes: readonly LoteDeTraslado[]): RepartoLote[] {
  return pendientes.filter((l) => pendienteDeLote(l) > 0).map((l) => ({ loteId: l.loteId, cantidad: pendienteDeLote(l) }))
}

export type PlanDeRecepcion =
  | {
      ok: true
      /** Lo que entra al destino ahora (solo líneas con cantidad > 0). */
      recibir: LineaTraslado[]
      /** Lo que se da por perdido al cerrar con faltante (solo líneas con cantidad > 0). */
      perder: LineaTraslado[]
      estadoFinal: 'PARTIAL' | 'RECEIVED'
      /** Lo que queda en tránsito después de esta recepción. */
      pendienteDespues: number
    }
  | { ok: false; codigo: string; error: string }

/**
 * Qué pasa con una recepción. `pedidas === 'TODO'` recibe todo lo que falte;
 * si no, cada línea pedida es un entero de 1 hasta lo que falta de ella. Si
 * queda algo en camino y NO se pide cerrar, la transferencia queda «recibida en
 * parte»; si se pide cerrar con faltante, lo que falta se da por perdido y
 * entonces el motivo es OBLIGATORIO. Recibir todo lo que faltaba la cierra sola.
 */
export function planDeRecepcion(lineas: readonly LineaDeTraslado[], pedidas: readonly LineaTraslado[] | 'TODO', cerrarConFaltante: boolean, motivo: string | null): PlanDeRecepcion {
  const porId = new Map(lineas.map((l) => [l.varianteId, l]))
  let recibir: LineaTraslado[]
  if (pedidas === 'TODO') {
    recibir = lineas.filter((l) => pendienteDeLinea(l) > 0).map((l) => ({ varianteId: l.varianteId, cantidad: pendienteDeLinea(l) }))
  } else {
    const vistas = new Set<string>()
    recibir = []
    for (const p of pedidas) {
      const l = porId.get(p?.varianteId)
      if (!l) return { ok: false, codigo: 'LINEA_AJENA', error: 'Uno de los productos no es de esta transferencia.' }
      if (vistas.has(p.varianteId)) return { ok: false, codigo: 'LINEA_REPETIDA', error: 'Un producto aparece más de una vez en la recepción.' }
      vistas.add(p.varianteId)
      const c = validarCantidad(p.cantidad)
      if (!c.ok) {
        // Recibir 0 de una línea es lo mismo que no tocarla: se admite y se ignora.
        if (p.cantidad === 0) continue
        return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: c.error }
      }
      const falta = pendienteDeLinea(l)
      if (c.valor > falta) {
        return { ok: false, codigo: 'RECIBE_MAS_DE_LO_ENVIADO', error: falta === 0 ? 'Ese producto ya llegó completo.' : `Solo faltan ${falta.toLocaleString('es-DO')} por llegar de ese producto; no puedes recibir ${c.valor.toLocaleString('es-DO')}.` }
      }
      recibir.push({ varianteId: p.varianteId, cantidad: c.valor, ...(sinLotes(p.lotes) ? {} : { lotes: p.lotes }) })
    }
  }
  const recibidoAhora = new Map(recibir.map((r) => [r.varianteId, r.cantidad]))
  const quedan = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: pendienteDeLinea(l) - (recibidoAhora.get(l.varianteId) ?? 0) })).filter((x) => x.cantidad > 0)
  const pendienteDespues = quedan.reduce((s, x) => s + x.cantidad, 0)

  if (recibir.length === 0 && !(cerrarConFaltante && pendienteDespues > 0)) {
    return { ok: false, codigo: 'SIN_CANTIDADES', error: 'Indica cuántas unidades llegaron de al menos un producto.' }
  }
  if (pendienteDespues === 0) return { ok: true, recibir, perder: [], estadoFinal: 'RECEIVED', pendienteDespues: 0 }
  if (cerrarConFaltante) {
    if (!motivo || motivo.trim() === '') {
      return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Cerrar con faltante necesita un motivo: qué pasó con lo que no llegó.' }
    }
    return { ok: true, recibir, perder: quedan, estadoFinal: 'RECEIVED', pendienteDespues: 0 }
  }
  return { ok: true, recibir, perder: [], estadoFinal: 'PARTIAL', pendienteDespues }
}

/** Qué vuelve al origen al cancelar: todo lo que sigue en tránsito. */
export function planDeCancelacion(lineas: readonly LineaDeTraslado[]): LineaTraslado[] {
  return lineas.filter((l) => pendienteDeLinea(l) > 0).map((l) => ({ varianteId: l.varianteId, cantidad: pendienteDeLinea(l) }))
}

// ── Motivos que llevan los movimientos del ledger ────────────────────────────

/** El número del traslado en el motivo permite rastrear cada movimiento desde el historial. */
export function motivoDeEnvio(numero: string, destino: string): string {
  return `Transferencia ${numero} enviada a ${destino}`
}

export function motivoDeRecepcion(numero: string, origen: string): string {
  return `Transferencia ${numero} recibida de ${origen}`
}

export function motivoDeDevolucion(numero: string): string {
  return `Transferencia ${numero} cancelada: devuelto al origen`
}

/** Un enviado de más no cabe en un movimiento: el máximo por línea es el de siempre. */
export const MAX_UNIDADES_POR_LINEA = CANTIDAD_MAXIMA
