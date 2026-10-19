import { exigirTransicion, puedeTransicionar, type Transiciones } from '@/lib/commerce-primitives/estados'
import { CANTIDAD_MAXIMA, validarCantidad } from './domain'
import { parsearCosto, valorDe, costoADecimal, type Costo } from './costos'
import { normalizarTextoLibre } from './entradas'

/**
 * COMMERCE CORE · inventario — INV-3b: proveedores y órdenes de compra. PURO: sin
 * base de datos ni servidor, para que lo usen el navegador, el servicio (que lo
 * vuelve a aplicar, porque no confía en lo que manda el navegador) y las pruebas.
 *
 * El modelo en una frase: una ORDEN es un documento (`OC-2026-000001`) con una
 * línea por producto —cuánto se pide y A QUÉ COSTO—. Nace como BORRADOR (se
 * edita), se PIDE (desde ahí solo avanza), se RECIBE en una o varias tandas y lo
 * que no llega se cierra con faltante y motivo. Cada tanda es una entrada de
 * mercancía normal con el costo de la línea, así que el costo promedio del
 * producto y el stock siguen teniendo un solo camino.
 *
 * Sin impuestos, sin cuentas por pagar, sin pagos y sin otra moneda: el costo es
 * el de la mercancía, tal cual lo cobra el proveedor.
 */

/** Prefijo del correlativo: `OC-2026-000001`. */
export const PREFIJO_ORDEN = 'OC'
/** Productos por orden (como una entrada a mano). */
export const MAX_LINEAS_ORDEN = 200
export const MAX_NOTA_ORDEN = 500
export const MAX_REFERENCIA_ORDEN = 120
export const MAX_MOTIVO_ORDEN = 300

export const MAX_NOMBRE_PROVEEDOR = 120
export const MAX_RNC_PROVEEDOR = 30
export const MAX_CONTACTO_PROVEEDOR = 120
export const MAX_TELEFONO_PROVEEDOR = 40
export const MAX_CORREO_PROVEEDOR = 160
export const MAX_NOTAS_PROVEEDOR = 500
export const MAX_DIAS_CREDITO = 365
export const MAX_CODIGO_PROVEEDOR = 80
export const MAX_DIAS_ENTREGA = 365

type Falla = { ok: false; codigo: string; error: string }

// ── Estados ──────────────────────────────────────────────────────────────────

export type EstadoOrden = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Pedida',
  PARTIAL: 'Recibida en parte',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
}

/**
 * Qué estado puede seguir a cuál. Una transición que no esté aquí NO OCURRE (la
 * base tiene la misma tabla en un disparador). Seguir recibiendo en `PARTIAL` sin
 * cambiar de estado no es una transición. Una orden recibida en parte NO se
 * cancela: lo que llegó ya es stock; lo que falta se cierra con faltante.
 */
export const TRANSICIONES_ORDEN: Transiciones<EstadoOrden> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
}

export function esEstadoOrden(v: unknown): v is EstadoOrden {
  return v === 'DRAFT' || v === 'ORDERED' || v === 'PARTIAL' || v === 'RECEIVED' || v === 'CANCELLED'
}

/** Mientras está pedida o recibida en parte, todavía puede llegar mercancía. */
export function puedeRecibirse(e: EstadoOrden): boolean {
  return e === 'ORDERED' || e === 'PARTIAL'
}

/** Los dos estados finales: una orden cerrada no cambia. */
export function estaCerrada(e: EstadoOrden): boolean {
  return e === 'RECEIVED' || e === 'CANCELLED'
}

export function puedePasarA(desde: EstadoOrden, hasta: EstadoOrden): boolean {
  return puedeTransicionar(TRANSICIONES_ORDEN, desde, hasta)
}

export function exigirPasoDeEstado(desde: EstadoOrden, hasta: EstadoOrden): void {
  exigirTransicion(TRANSICIONES_ORDEN, desde, hasta, 'La orden de compra')
}

// ── Textos y fechas ──────────────────────────────────────────────────────────

/** `YYYY-MM-DD` real (el 31 de febrero no existe), entre 2000 y 2100; vacío = sin fecha. La guarda como medianoche UTC. */
export function parsearFechaPrevista(v: unknown): { ok: true; valor: Date | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, valor: null }
  if (typeof v !== 'string') return { ok: false, error: 'La fecha prevista no es válida.' }
  const t = v.trim()
  if (t === '') return { ok: true, valor: null }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (!m) return { ok: false, error: 'La fecha prevista no es válida: usa el formato AAAA-MM-DD.' }
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return { ok: false, error: 'La fecha prevista no existe en el calendario.' }
  if (anio < 2000 || anio > 2100) return { ok: false, error: 'La fecha prevista debe estar entre los años 2000 y 2100.' }
  return { ok: true, valor: d }
}

/** La fecha prevista tal como se escribe en un campo de fecha. */
export function fechaPrevistaATexto(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

function idValido(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return t === '' || t.length > 120 ? null : t
}

// ── Proveedor ────────────────────────────────────────────────────────────────

export interface DatosProveedor {
  nombre: string
  rnc: string | null
  contacto: string | null
  telefono: string | null
  correo: string | null
  diasCredito: number
  notas: string | null
}

export type ResultadoProveedor = { ok: true; valor: DatosProveedor } | Falla

const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTROL = /[\u0000-\u001f\u007f]/

/** Un campo de texto de proveedor: opcional, recortado, sin caracteres de control y acotado. */
function campo(v: unknown, max: number, nombre: string): { ok: true; valor: string | null } | { ok: false; error: string } {
  const r = normalizarTextoLibre(v, max, nombre)
  if (!r.ok) return r
  if (r.valor !== null && CONTROL.test(r.valor)) return { ok: false, error: `${nombre} trae caracteres no válidos.` }
  return r
}

/**
 * Los datos de un proveedor: solo el nombre es obligatorio. El correo, si viene, tiene
 * forma de correo; los días de crédito son un entero de 0 a 365 (0 = de contado). El
 * RNC se guarda tal cual lo escribe la persona: no se adivina su formato.
 */
export function validarProveedor(entrada: unknown): ResultadoProveedor {
  const e = (entrada ?? {}) as Record<string, unknown>
  const nombre = campo(e.nombre, MAX_NOMBRE_PROVEEDOR, 'El nombre')
  if (!nombre.ok) return { ok: false, codigo: 'NOMBRE_INVALIDO', error: nombre.error }
  if (nombre.valor === null) return { ok: false, codigo: 'NOMBRE_OBLIGATORIO', error: 'Escribe el nombre del proveedor.' }
  const rnc = campo(e.rnc, MAX_RNC_PROVEEDOR, 'El RNC')
  if (!rnc.ok) return { ok: false, codigo: 'RNC_INVALIDO', error: rnc.error }
  const contacto = campo(e.contacto, MAX_CONTACTO_PROVEEDOR, 'El contacto')
  if (!contacto.ok) return { ok: false, codigo: 'CONTACTO_INVALIDO', error: contacto.error }
  const telefono = campo(e.telefono, MAX_TELEFONO_PROVEEDOR, 'El teléfono')
  if (!telefono.ok) return { ok: false, codigo: 'TELEFONO_INVALIDO', error: telefono.error }
  const correo = campo(e.correo, MAX_CORREO_PROVEEDOR, 'El correo')
  if (!correo.ok) return { ok: false, codigo: 'CORREO_INVALIDO', error: correo.error }
  if (correo.valor !== null && !FORMA_CORREO.test(correo.valor)) return { ok: false, codigo: 'CORREO_INVALIDO', error: 'El correo del proveedor no es válido.' }
  const notas = campo(e.notas, MAX_NOTAS_PROVEEDOR, 'Las notas')
  if (!notas.ok) return { ok: false, codigo: 'NOTAS_INVALIDAS', error: notas.error }

  let dias = 0
  const crudo = e.diasCredito
  if (typeof crudo === 'number') dias = crudo
  else if (typeof crudo === 'string' && crudo.trim() !== '') dias = /^\d{1,4}$/.test(crudo.trim()) ? Number(crudo.trim()) : Number.NaN
  else if (crudo !== undefined && crudo !== null && crudo !== '') dias = Number.NaN
  if (!Number.isInteger(dias) || dias < 0 || dias > MAX_DIAS_CREDITO) {
    return { ok: false, codigo: 'DIAS_CREDITO_INVALIDOS', error: `Los días de crédito son un número entero de 0 a ${MAX_DIAS_CREDITO} (0 = de contado).` }
  }
  return { ok: true, valor: { nombre: nombre.valor, rnc: rnc.valor, contacto: contacto.valor, telefono: telefono.valor, correo: correo.valor, diasCredito: dias, notas: notas.valor } }
}

// ── Producto ↔ proveedor ─────────────────────────────────────────────────────

export interface DatosVinculo {
  /** El código con que el proveedor conoce el producto. */
  codigoProveedor: string | null
  /** Días que tarda en llegar. null = no se sabe. */
  diasEntrega: number | null
  preferido: boolean
}

export type ResultadoVinculo = { ok: true; valor: DatosVinculo } | Falla

export function validarVinculo(entrada: unknown): ResultadoVinculo {
  const e = (entrada ?? {}) as Record<string, unknown>
  const codigo = campo(e.codigoProveedor, MAX_CODIGO_PROVEEDOR, 'El código del proveedor')
  if (!codigo.ok) return { ok: false, codigo: 'CODIGO_INVALIDO', error: codigo.error }
  let dias: number | null = null
  const crudo = e.diasEntrega
  if (typeof crudo === 'number') dias = crudo
  else if (typeof crudo === 'string' && crudo.trim() !== '') dias = /^\d{1,4}$/.test(crudo.trim()) ? Number(crudo.trim()) : Number.NaN
  else if (crudo !== undefined && crudo !== null && crudo !== '') dias = Number.NaN
  if (dias !== null && (!Number.isInteger(dias) || dias < 0 || dias > MAX_DIAS_ENTREGA)) {
    return { ok: false, codigo: 'DIAS_ENTREGA_INVALIDOS', error: `Los días de entrega son un número entero de 0 a ${MAX_DIAS_ENTREGA}.` }
  }
  return { ok: true, valor: { codigoProveedor: codigo.valor, diasEntrega: dias, preferido: e.preferido === true } }
}

// ── La orden: cabecera y líneas ──────────────────────────────────────────────

export interface CabeceraOrden {
  proveedorId: string
  sucursalId: string
  referencia: string | null
  nota: string | null
  fechaPrevista: Date | null
}

export type ResultadoCabecera = { ok: true; valor: CabeceraOrden } | Falla

export function validarCabeceraOrden(entrada: unknown): ResultadoCabecera {
  const e = (entrada ?? {}) as Record<string, unknown>
  const proveedorId = idValido(e.proveedorId)
  if (!proveedorId) return { ok: false, codigo: 'PROVEEDOR_OBLIGATORIO', error: 'Elige el proveedor de la orden.' }
  const sucursalId = idValido(e.sucursalId)
  if (!sucursalId) return { ok: false, codigo: 'SUCURSAL_OBLIGATORIA', error: 'Elige la sucursal que recibe la mercancía.' }
  const referencia = normalizarTextoLibre(e.referencia, MAX_REFERENCIA_ORDEN, 'La referencia')
  if (!referencia.ok) return { ok: false, codigo: 'REFERENCIA_INVALIDA', error: referencia.error }
  const nota = normalizarTextoLibre(e.nota, MAX_NOTA_ORDEN, 'La nota')
  if (!nota.ok) return { ok: false, codigo: 'NOTA_INVALIDA', error: nota.error }
  const fecha = parsearFechaPrevista(e.fechaPrevista)
  if (!fecha.ok) return { ok: false, codigo: 'FECHA_INVALIDA', error: fecha.error }
  return { ok: true, valor: { proveedorId, sucursalId, referencia: referencia.valor, nota: nota.valor, fechaPrevista: fecha.valor } }
}

export interface LineaOrden {
  varianteId: string
  cantidad: number
  /** Costo unitario ya normalizado a cuatro decimales (`'12.5000'`). OBLIGATORIO en una orden. */
  costo: string
}

export type ResultadoLineasOrden = { ok: true; lineas: LineaOrden[]; unidades: number; valor: Costo } | Falla

/**
 * Valida las líneas de una orden: al menos una, no más del tope, cada producto UNA
 * sola vez, cada cantidad un entero de 1 a CANTIDAD_MAXIMA y cada línea con su
 * COSTO (una orden sin costo no dice cuánto se va a gastar; cero sí es un costo
 * válido: la mercancía de regalo). Devuelve el total de unidades y su valor.
 */
export function validarLineasOrden(lineas: unknown, max: number = MAX_LINEAS_ORDEN): ResultadoLineasOrden {
  if (!Array.isArray(lineas) || lineas.length === 0) return { ok: false, codigo: 'ORDEN_SIN_LINEAS', error: 'Agrega al menos un producto a la orden.' }
  if (lineas.length > max) return { ok: false, codigo: 'DEMASIADAS_LINEAS', error: `Una orden admite hasta ${max} productos; esta trae ${lineas.length}. Divídela en varias.` }
  const vistas = new Set<string>()
  const limpias: LineaOrden[] = []
  let unidades = 0
  let valor = BigInt(0)
  for (const crudo of lineas as unknown[]) {
    const l = crudo as { varianteId?: unknown; cantidad?: unknown; costo?: unknown } | null
    const id = idValido(l?.varianteId)
    if (!id) return { ok: false, codigo: 'LINEA_INVALIDA', error: 'Una de las líneas no indica qué producto es.' }
    if (vistas.has(id)) return { ok: false, codigo: 'LINEA_REPETIDA', error: 'Un producto aparece más de una vez en la orden: junta sus cantidades en una sola línea.' }
    vistas.add(id)
    const c = validarCantidad(l?.cantidad)
    if (!c.ok) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: `Línea ${limpias.length + 1}: ${c.error}` }
    if (l?.costo === undefined || l.costo === null || (typeof l.costo === 'string' && l.costo.trim() === '')) {
      return { ok: false, codigo: 'COSTO_OBLIGATORIO', error: `Línea ${limpias.length + 1}: escribe el costo. Una orden de compra dice cuánto cuesta cada producto.` }
    }
    const costo = parsearCosto(l.costo)
    if (!costo.ok) return { ok: false, codigo: 'COSTO_INVALIDO', error: `Línea ${limpias.length + 1}: ${costo.error}` }
    limpias.push({ varianteId: id, cantidad: c.valor, costo: costoADecimal(costo.valor) })
    unidades += c.valor
    valor += valorDe(c.valor, costo.valor)
  }
  return { ok: true, lineas: limpias, unidades, valor }
}

/** Junta las líneas del mismo producto sumando cantidades (el costo que manda es el de la primera aparición). */
export function fusionarLineasOrden(lineas: readonly LineaOrden[]): LineaOrden[] {
  const porId = new Map<string, LineaOrden>()
  for (const l of lineas) {
    const previa = porId.get(l.varianteId)
    porId.set(l.varianteId, previa ? { ...previa, cantidad: Math.min(previa.cantidad + l.cantidad, CANTIDAD_MAXIMA) } : { ...l })
  }
  return [...porId.values()]
}

// ── Lo que va llegando ───────────────────────────────────────────────────────

/** Una línea de una orden ya pedida, con lo que ha pasado con ella. */
export interface LineaDeOrden {
  varianteId: string
  pedido: number
  recibido: number
  /** Lo que se cerró como faltante. */
  cancelado: number
}

/** Lo que todavía puede llegar: ni llegó ni se cerró como faltante. */
export function pendienteDeOrden(l: Pick<LineaDeOrden, 'pedido' | 'recibido' | 'cancelado'>): number {
  return l.pedido - l.recibido - l.cancelado
}

export interface ResumenDeOrden {
  pedidas: number
  recibidas: number
  canceladas: number
  pendientes: number
}

export function resumirOrden(lineas: readonly LineaDeOrden[]): ResumenDeOrden {
  const r: ResumenDeOrden = { pedidas: 0, recibidas: 0, canceladas: 0, pendientes: 0 }
  for (const l of lineas) {
    r.pedidas += l.pedido
    r.recibidas += l.recibido
    r.canceladas += l.cancelado
    r.pendientes += pendienteDeOrden(l)
  }
  return r
}

export interface LineaRecibida {
  varianteId: string
  cantidad: number
  /**
   * INV-5b2: de qué lotes llegó, si el producto LLEVA lotes (código, vencimiento opcional y cantidad de cada uno; suman la cantidad de
   * la línea). Aquí viaja SIN validar: qué productos llevan lotes lo sabe el servicio, que valida con `validarLotesDeLinea`.
   */
  lotes?: ReadonlyArray<{ codigo: string; vencimiento?: string | null; cantidad: number }>
}

export type PlanDeRecepcionOrden =
  | {
      ok: true
      /** Lo que entra al stock ahora (solo líneas con cantidad > 0). */
      recibir: LineaRecibida[]
      /** Lo que se cierra como faltante (solo líneas con cantidad > 0). */
      cerrar: LineaRecibida[]
      estadoFinal: 'PARTIAL' | 'RECEIVED'
      /** Lo que queda por llegar después de esta recepción. */
      pendienteDespues: number
    }
  | Falla

/**
 * Qué pasa con una recepción. `pedidas === 'TODO'` recibe todo lo que falte; si no,
 * cada línea es un entero de 1 hasta lo que falta de ella (RECIBIR DE MÁS NO SE
 * ADMITE: lo que el proveedor mandó de sobra se registra como una entrada aparte,
 * con su propio costo). Si queda algo por llegar y NO se pide cerrar, la orden queda
 * «recibida en parte»; si se pide cerrar con faltante, lo que falta se cierra y
 * entonces el motivo es OBLIGATORIO. Recibir todo lo que faltaba la cierra sola.
 * Cerrar sin que haya llegado NADA nunca ocurre: eso es cancelar.
 */
export function planDeRecepcionOrden(lineas: readonly LineaDeOrden[], pedidas: readonly LineaRecibida[] | 'TODO', cerrarConFaltante: boolean, motivo: string | null): PlanDeRecepcionOrden {
  const porId = new Map(lineas.map((l) => [l.varianteId, l]))
  let recibir: LineaRecibida[]
  if (pedidas === 'TODO') {
    recibir = lineas.filter((l) => pendienteDeOrden(l) > 0).map((l) => ({ varianteId: l.varianteId, cantidad: pendienteDeOrden(l) }))
  } else {
    const vistas = new Set<string>()
    recibir = []
    for (const p of pedidas) {
      const l = porId.get(p?.varianteId)
      if (!l) return { ok: false, codigo: 'LINEA_AJENA', error: 'Uno de los productos no es de esta orden.' }
      if (vistas.has(p.varianteId)) return { ok: false, codigo: 'LINEA_REPETIDA', error: 'Un producto aparece más de una vez en la recepción.' }
      vistas.add(p.varianteId)
      if (p.lotes !== undefined && p.lotes !== null && !Array.isArray(p.lotes)) return { ok: false, codigo: 'LOTES_INVALIDOS', error: 'Los lotes de uno de los productos no son válidos.' }
      const c = validarCantidad(p.cantidad)
      if (!c.ok) {
        // Recibir 0 de una línea es lo mismo que no tocarla: se admite y se ignora.
        if (p.cantidad === 0) continue
        return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: c.error }
      }
      const falta = pendienteDeOrden(l)
      if (c.valor > falta) {
        return {
          ok: false,
          codigo: 'RECIBE_MAS_DE_LO_PEDIDO',
          error:
            falta === 0
              ? 'Ese producto ya llegó completo. Si el proveedor mandó de más, regístralo como una entrada aparte.'
              : `Solo faltan ${falta.toLocaleString('es-DO')} por llegar de ese producto; no puedes recibir ${c.valor.toLocaleString('es-DO')}. Si el proveedor mandó de más, regístralo como una entrada aparte.`,
        }
      }
      recibir.push({ varianteId: p.varianteId, cantidad: c.valor, ...(p.lotes && p.lotes.length > 0 ? { lotes: p.lotes } : {}) })
    }
  }
  const recibidoAhora = new Map(recibir.map((r) => [r.varianteId, r.cantidad]))
  const quedan = lineas.map((l) => ({ varianteId: l.varianteId, cantidad: pendienteDeOrden(l) - (recibidoAhora.get(l.varianteId) ?? 0) })).filter((x) => x.cantidad > 0)
  const pendienteDespues = quedan.reduce((s, x) => s + x.cantidad, 0)

  if (recibir.length === 0 && !(cerrarConFaltante && pendienteDespues > 0)) {
    return { ok: false, codigo: 'SIN_CANTIDADES', error: 'Indica cuántas unidades llegaron de al menos un producto.' }
  }
  if (pendienteDespues === 0) return { ok: true, recibir, cerrar: [], estadoFinal: 'RECEIVED', pendienteDespues: 0 }
  if (cerrarConFaltante) {
    const llegado = lineas.reduce((s, l) => s + l.recibido, 0) + recibir.reduce((s, r) => s + r.cantidad, 0)
    if (llegado === 0) return { ok: false, codigo: 'NADA_RECIBIDO', error: 'No ha llegado nada de esta orden. Si ya no va a llegar, cancélala.' }
    if (!motivo || motivo.trim() === '') return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Cerrar con faltante necesita un motivo: qué pasó con lo que no llegó.' }
    return { ok: true, recibir, cerrar: quedan, estadoFinal: 'RECEIVED', pendienteDespues: 0 }
  }
  return { ok: true, recibir, cerrar: [], estadoFinal: 'PARTIAL', pendienteDespues }
}

/** Una línea de recepción lista para compararla con la que quedó registrada: el producto, cuánto llegó y de qué lotes (código → cantidad; vacío = sin lotes). */
export interface RecepcionComparable {
  varianteId: string
  cantidad: number
  lotes: ReadonlyMap<string, number>
}

/**
 * ¿Es la MISMA recepción? Una clave de idempotencia repetida solo es un reintento si trae los mismos productos, las mismas cantidades y
 * —INV-5b2— los mismos lotes (código y cantidad de cada uno): otro lote no es el mismo reintento, es otra mercancía.
 */
export function esMismaRecepcion(previa: readonly RecepcionComparable[], pedida: readonly RecepcionComparable[]): boolean {
  if (previa.length !== pedida.length) return false
  const porProducto = new Map(pedida.map((p) => [p.varianteId, p]))
  if (porProducto.size !== pedida.length) return false
  return previa.every((p) => {
    const q = porProducto.get(p.varianteId)
    if (!q || q.cantidad !== p.cantidad || q.lotes.size !== p.lotes.size) return false
    for (const [codigo, cantidad] of p.lotes) if (q.lotes.get(codigo) !== cantidad) return false
    return true
  })
}

// ── Cancelar ─────────────────────────────────────────────────────────────────

export type ResultadoCancelacion = { ok: true; motivo: string | null } | Falla

/**
 * Cancelar: un borrador se descarta sin más; una orden ya pedida (sin nada recibido)
 * lleva un motivo, porque alguien ya esperaba esa mercancía. Una recibida en parte no
 * se cancela —lo que llegó ya es stock—: se cierra con faltante. Una cerrada no cambia.
 */
export function validarCancelacionDeOrden(estado: EstadoOrden, motivo: unknown): ResultadoCancelacion {
  if (estado === 'PARTIAL') return { ok: false, codigo: 'ORDEN_CON_RECEPCIONES', error: 'Esta orden ya recibió mercancía: no se cancela. Ciérrala con faltante indicando el motivo.' }
  if (estaCerrada(estado)) return { ok: false, codigo: 'ORDEN_CERRADA', error: estado === 'RECEIVED' ? 'La orden ya está recibida: no admite cambios.' : 'La orden ya está cancelada.' }
  const m = normalizarTextoLibre(motivo, MAX_MOTIVO_ORDEN, 'El motivo')
  if (!m.ok) return { ok: false, codigo: 'MOTIVO_INVALIDO', error: m.error }
  if (estado === 'ORDERED' && m.valor === null) return { ok: false, codigo: 'MOTIVO_OBLIGATORIO', error: 'Cancelar una orden ya pedida necesita un motivo: el proveedor la estaba esperando.' }
  return { ok: true, motivo: m.valor }
}

// ── Valor de la orden ────────────────────────────────────────────────────────

/** Cuánto cuesta lo pedido (cantidad × costo de cada línea). */
export function valorPedido(lineas: ReadonlyArray<{ pedido: number; costo: Costo }>): Costo {
  return lineas.reduce((s, l) => s + valorDe(l.pedido, l.costo), BigInt(0))
}

/** Cuánto vale lo que falta por llegar (a los costos de la orden). */
export function valorPendiente(lineas: ReadonlyArray<LineaDeOrden & { costo: Costo }>): Costo {
  return lineas.reduce((s, l) => s + valorDe(pendienteDeOrden(l), l.costo), BigInt(0))
}

/** Un costo tal como se escribe en un campo: sin ceros de relleno (`'5.0000'` → `'5'`, `'12.5000'` → `'12.5'`). */
export function costoParaCampo(c: Costo): string {
  return costoADecimal(c).replace(/\.?0+$/, '')
}
