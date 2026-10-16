import { CANTIDAD_MAXIMA, validarCantidad } from './domain'

/**
 * COMMERCE CORE · inventario — INV-5a: LOTES Y VENCIMIENTO. Las reglas PURAS: sin Prisma ni base. Las usan el servicio (que las vuelve
 * a aplicar, porque no confía en lo que manda el navegador), los formularios y las pruebas.
 *
 * QUÉ ES UN LOTE. Un producto puede llevar LOTES: cada unidad es de un lote (un código del empaque) y cada lote puede tener un día de
 * vencimiento. Cada producto con lotes tiene además el lote «SIN LOTE», que recibe lo que ya había el día que se activaron.
 *
 * FEFO (primero lo que antes vence). Lo que se vende, se aparta o se saca sale del lote que vence primero; los lotes sin fecha van
 * después de los que la tienen (no vencen nunca, así que no urgen); lo VENCIDO no se vende ni se aparta.
 *
 * LAS FECHAS SON DÍAS DE CALENDARIO, no instantes: `'2027-05-31'`. «Vence el 31» significa que se vende hasta el 31 inclusive y desde
 * el 1 ya no; «hoy» es el día local de la EMPRESA (su zona horaria), no el del servidor: lo calcula quien llama (`diaLocal`) y llega
 * aquí como texto, para que estas funciones no dependan del reloj ni de la zona.
 */

// ── Códigos ──────────────────────────────────────────────────────────────────

/** El lote legado: recibe lo que había al activar los lotes, y no es un lote que se pueda crear a mano. */
export const CODIGO_SIN_LOTE = 'SIN LOTE'
export const LONGITUD_MAXIMA_CODIGO = 60
/** Lotes máximos que una línea de entrada puede repartir. */
export const MAX_LOTES_POR_LINEA = 20

/** Letras y dígitos de cualquier idioma, y los signos que traen los códigos de lote reales (`-`, `_`, `.`, `/`, `#`, `+`, `:`). */
const FORMA_DE_CODIGO = /^[\p{L}\p{N}][\p{L}\p{N} _.\-/#+:]*$/u

export function esCodigoSinLote(codigo: string): boolean {
  return codigo === CODIGO_SIN_LOTE
}

export type ResultadoTexto = { ok: true; valor: string } | { ok: false; error: string }

/**
 * El código tal como se guarda: sin espacios sobrantes, con los espacios internos reducidos a uno y en MAYÚSCULAS («lote  a-12» y
 * «LOTE A-12» son el mismo lote). Entre 1 y 60 caracteres; sin comas, comillas ni saltos de línea (viajan por CSV y por etiquetas).
 * Acepta «SIN LOTE» (es el legado); quien CREA un lote nuevo usa `validarCodigoDeLoteNuevo`, que lo rechaza.
 */
export function normalizarCodigoLote(v: unknown): ResultadoTexto {
  if (typeof v !== 'string') return { ok: false, error: 'Escribe el código del lote.' }
  const t = v.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase()
  if (t === '') return { ok: false, error: 'Escribe el código del lote.' }
  if (t.length > LONGITUD_MAXIMA_CODIGO) return { ok: false, error: `El código del lote no puede pasar de ${LONGITUD_MAXIMA_CODIGO} caracteres.` }
  if (!FORMA_DE_CODIGO.test(t)) return { ok: false, error: 'El código del lote solo admite letras, números, espacios y - _ . / # + :' }
  return { ok: true, valor: t }
}

/** Un código para un lote que se va a CREAR: «SIN LOTE» está reservado para el legado. */
export function validarCodigoDeLoteNuevo(v: unknown): ResultadoTexto {
  const r = normalizarCodigoLote(v)
  if (!r.ok) return r
  if (esCodigoSinLote(r.valor)) return { ok: false, error: '«SIN LOTE» es el lote de lo que ya había antes de usar lotes; elige otro código.' }
  return r
}

// ── Fechas (días de calendario) ──────────────────────────────────────────────

export const VENCIMIENTO_MINIMO = '2000-01-01'
export const VENCIMIENTO_MAXIMO = '2100-12-31'
/** Desde cuántos días antes de vencer un lote se considera «por vencer». */
export const DIAS_AVISO_POR_DEFECTO = 30
export const DIAS_AVISO_MAXIMO = 365

/** ¿Es `s` un día real del calendario, en la forma `YYYY-MM-DD`? («2027-02-30» no lo es.) */
export function esDiaValido(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [a, m, d] = s.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

/**
 * El vencimiento que escribió quien captura: vacío = el lote no vence (`null`); si no, un día real entre el 2000 y el 2100 (el límite
 * atrapa el «0225» o el «2205» por «2025» antes de guardarlo; la base lo vuelve a vigilar).
 */
export function parsearVencimiento(v: unknown): { ok: true; valor: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, valor: null }
  if (typeof v !== 'string') return { ok: false, error: 'El vencimiento no es una fecha válida.' }
  const t = v.trim()
  if (t === '') return { ok: true, valor: null }
  if (!esDiaValido(t)) return { ok: false, error: 'El vencimiento debe ser un día real con la forma AAAA-MM-DD.' }
  if (t < VENCIMIENTO_MINIMO || t > VENCIMIENTO_MAXIMO) return { ok: false, error: `El vencimiento debe estar entre ${VENCIMIENTO_MINIMO} y ${VENCIMIENTO_MAXIMO}.` }
  return { ok: true, valor: t }
}

/**
 * INV-5b5 · Qué pasa al CORREGIR el vencimiento de un lote. El «SIN LOTE» no vence y no se corrige; la fecha nueva sigue las mismas
 * reglas que al capturarla (vacía = no vence); un producto que exige vencimiento no admite dejar un lote sin fecha; y poner la fecha que
 * ya tenía no cambia nada (un reintento no deja una segunda fila de historia).
 */
export type PlanDeCorreccion =
  | { ok: true; sinCambio: true }
  | { ok: true; sinCambio: false; anterior: string | null; nuevo: string | null }
  | { ok: false; codigo: string; error: string }

export function planDeCorreccionDeVencimiento(lote: { vencimiento: string | null; legado: boolean }, nuevo: unknown, exigeVencimiento: boolean): PlanDeCorreccion {
  if (lote.legado) return { ok: false, codigo: 'LOTE_LEGADO', error: 'El lote «SIN LOTE» no vence: no tiene fecha que corregir.' }
  const f = parsearVencimiento(nuevo)
  if (!f.ok) return { ok: false, codigo: 'VENCIMIENTO_INVALIDO', error: f.error }
  if (f.valor === null && exigeVencimiento) return { ok: false, codigo: 'VENCIMIENTO_REQUERIDO', error: 'Este producto exige fecha de vencimiento en cada lote: escribe la fecha correcta.' }
  if (f.valor === lote.vencimiento) return { ok: true, sinCambio: true }
  return { ok: true, sinCambio: false, anterior: lote.vencimiento, nuevo: f.valor }
}

/**
 * INV-5b5 · ¿Se puede DESHACER la activación de lotes de un producto? Solo mientras los lotes sean configuración: ningún movimiento
 * repartido entre lotes (ni una venta, entrada, transferencia o ajuste desde que se activaron), ningún lote aparte del «SIN LOTE», ninguna
 * línea de conteo con lote y ninguna corrección de vencimiento. Devuelve `null` si se puede, o el motivo (código y texto) si no.
 */
export function motivoParaNoDeshacerLotes(h: { movimientosRepartidos: number; lotesPropios: number; lineasDeConteo: number; correcciones: number }): { codigo: string; error: string } | null {
  if (h.movimientosRepartidos > 0 || h.lotesPropios > 0) {
    return { codigo: 'DESACTIVAR_CON_HISTORIAL', error: 'Este producto ya se movió con lotes (ventas, entradas, transferencias o ajustes): su historia está repartida entre lotes y no se puede deshacer. Solo se deshace la activación mientras nada se haya movido con lotes.' }
  }
  if (h.lineasDeConteo > 0) return { codigo: 'DESACTIVAR_CON_CONTEO', error: 'Este producto ya se contó por lote en un conteo: esa historia usa sus lotes y no se puede deshacer.' }
  if (h.correcciones > 0) return { codigo: 'DESACTIVAR_CON_HISTORIAL', error: 'Algún lote de este producto tiene correcciones de vencimiento guardadas y no se puede deshacer.' }
  return null
}

/** Días de calendario de `hoy` a `dia` (negativo si `dia` ya pasó). Los dos son `YYYY-MM-DD`. */
export function diasEntre(hoy: string, dia: string): number {
  return Math.round((Date.parse(`${dia}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86_400_000)
}

export type EstadoLote = 'SIN_VENCIMIENTO' | 'VIGENTE' | 'POR_VENCER' | 'VENCIDO'

export const ETIQUETA_ESTADO_LOTE: Record<EstadoLote, string> = {
  SIN_VENCIMIENTO: 'No vence',
  VIGENTE: 'Vigente',
  POR_VENCER: 'Por vencer',
  VENCIDO: 'Vencido',
}

/** Vencido = su día ya pasó (un lote que vence HOY todavía se vende). Por vencer = vence dentro de `diasAviso` días o menos. */
export function estadoDeLote(vencimiento: string | null, hoy: string, diasAviso: number = DIAS_AVISO_POR_DEFECTO): EstadoLote {
  if (vencimiento === null) return 'SIN_VENCIMIENTO'
  if (vencimiento < hoy) return 'VENCIDO'
  return diasEntre(hoy, vencimiento) <= diasAviso ? 'POR_VENCER' : 'VIGENTE'
}

/** ¿Se puede vender (o apartar, o entregar) lo de este lote hoy? */
export function esVendible(vencimiento: string | null, hoy: string): boolean {
  return vencimiento === null || vencimiento >= hoy
}

/** «Vence hoy», «Vence mañana», «Vence en 12 días», «Venció ayer», «Venció hace 3 días», «No vence». */
export function textoVencimiento(vencimiento: string | null, hoy: string): string {
  if (vencimiento === null) return 'No vence'
  const d = diasEntre(hoy, vencimiento)
  if (d === 0) return 'Vence hoy'
  if (d === 1) return 'Vence mañana'
  if (d > 1) return `Vence en ${d} días`
  if (d === -1) return 'Venció ayer'
  return `Venció hace ${-d} días`
}

export function validarDiasAviso(v: unknown): { ok: true; valor: number } | { ok: false; error: string } {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > DIAS_AVISO_MAXIMO) return { ok: false, error: `Los días de aviso van de 0 a ${DIAS_AVISO_MAXIMO}.` }
  return { ok: true, valor: n }
}

// ── Saldos por lote y FEFO ───────────────────────────────────────────────────

/** Un lote con lo que hay de él EN UNA SUCURSAL (las tres cubetas del saldo). */
export interface LoteConSaldo {
  loteId: string
  codigo: string
  vencimiento: string | null
  legado: boolean
  /** Orden de creación (milisegundos): desempata dos lotes que vencen el mismo día. */
  creadoEn: number
  onHand: number
  reserved: number
  damaged: number
}

export interface RepartoLote {
  loteId: string
  cantidad: number
}

/** Lo que se puede vender de un lote: lo que hay menos lo apartado. */
export function disponibleDeLote(l: Pick<LoteConSaldo, 'onHand' | 'reserved'>): number {
  return l.onHand - l.reserved
}

/**
 * El orden FEFO: primero el que vence antes; los que no vencen, al final. A igual día, el legado primero (es lo más viejo) y luego el
 * más antiguo; el código y el id cierran el empate para que el orden NUNCA dependa del orden en que llegaron las filas.
 */
export function ordenFefo(a: LoteConSaldo, b: LoteConSaldo): number {
  if (a.vencimiento !== b.vencimiento) {
    if (a.vencimiento === null) return 1
    if (b.vencimiento === null) return -1
    return a.vencimiento < b.vencimiento ? -1 : 1
  }
  if (a.legado !== b.legado) return a.legado ? -1 : 1
  if (a.creadoEn !== b.creadoEn) return a.creadoEn - b.creadoEn
  if (a.codigo !== b.codigo) return a.codigo < b.codigo ? -1 : 1
  return a.loteId < b.loteId ? -1 : a.loteId > b.loteId ? 1 : 0
}

/** Los lotes de los que HOY se puede sacar algo, en orden FEFO: con disponible y sin vencer. */
export function lotesVendibles(lotes: readonly LoteConSaldo[], hoy: string): LoteConSaldo[] {
  return lotes.filter((l) => disponibleDeLote(l) > 0 && esVendible(l.vencimiento, hoy)).sort(ordenFefo)
}

export type ResultadoReparto =
  | { ok: true; reparto: RepartoLote[] }
  | { ok: false; faltan: number; vendible: number; vencido: number }

/**
 * Reparte `cantidad` entre los lotes en orden FEFO, tomando de cada uno lo que tiene disponible. Lo vencido NO cuenta: si no alcanza
 * lo vendible, dice cuánto falta y cuánto hay vencido (para decir «hay 3, pero están vencidas»). Sirve para vender y para apartar.
 */
export function repartirFefo(lotes: readonly LoteConSaldo[], cantidad: number, hoy: string): ResultadoReparto {
  const vendibles = lotesVendibles(lotes, hoy)
  const vendible = vendibles.reduce((s, l) => s + disponibleDeLote(l), 0)
  const vencido = lotes.filter((l) => !esVendible(l.vencimiento, hoy)).reduce((s, l) => s + Math.max(0, disponibleDeLote(l)), 0)
  if (!Number.isInteger(cantidad) || cantidad <= 0) return { ok: false, faltan: Math.max(0, cantidad), vendible, vencido }
  if (vendible < cantidad) return { ok: false, faltan: cantidad - vendible, vendible, vencido }
  const reparto: RepartoLote[] = []
  let resto = cantidad
  for (const l of vendibles) {
    if (resto === 0) break
    const toma = Math.min(resto, disponibleDeLote(l))
    reparto.push({ loteId: l.loteId, cantidad: toma })
    resto -= toma
  }
  return { ok: true, reparto }
}

/** Junta los renglones del mismo lote (suma), quita los de cantidad cero y conserva el orden de la primera aparición. */
export function fusionarReparto(reparto: readonly RepartoLote[]): RepartoLote[] {
  const por = new Map<string, number>()
  for (const r of reparto) por.set(r.loteId, (por.get(r.loteId) ?? 0) + r.cantidad)
  return [...por.entries()].filter(([, cantidad]) => cantidad !== 0).map(([loteId, cantidad]) => ({ loteId, cantidad }))
}

export function sumaDeReparto(reparto: readonly RepartoLote[]): number {
  return reparto.reduce((s, r) => s + r.cantidad, 0)
}

// ── Lo apartado: de qué lote es cada reserva ─────────────────────────────────

/**
 * Las unidades apartadas de una reserva, POR LOTE, a partir de lo que dicen sus movimientos: cada renglón de reparto de un movimiento
 * que la toca suma (apartar: `+`) o resta (liberar, vender de lo apartado, vencer: `-`). No hay una tabla de asignaciones: la
 * asignación SE DERIVA del ledger y por eso no puede contradecirlo.
 *
 * Lo que la reserva tiene de más que su reparto (una reserva hecha ANTES de activar los lotes no tiene reparto) es del lote legado.
 * Si el reparto derivado es negativo o supera la reserva, el ledger no cuadra con ella y se dice, no se arregla en silencio.
 */
export function asignacionDeReserva(
  efectos: readonly RepartoLote[],
  cantidadReserva: number,
  loteLegadoId: string
): { ok: true; reparto: RepartoLote[] } | { ok: false; error: string } {
  const neto = fusionarReparto(efectos)
  if (neto.some((r) => r.cantidad < 0)) return { ok: false, error: 'El ledger libera más unidades de un lote de las que esa reserva apartó.' }
  const derivado = sumaDeReparto(neto)
  if (derivado > cantidadReserva) return { ok: false, error: 'La reserva tiene más unidades repartidas entre lotes que su cantidad.' }
  const resto = cantidadReserva - derivado
  return { ok: true, reparto: fusionarReparto(resto > 0 ? [...neto, { loteId: loteLegadoId, cantidad: resto }] : neto) }
}

/**
 * Qué hacer para CONSUMIR (vender) una reserva cuando alguno de sus lotes ya venció. Cada lote apartado que aún se vende, se vende
 * tal cual; el apartado en un lote vencido NO se entrega: se libera (queda como disponible vencido, para el barrido) y se aparta de
 * nuevo del siguiente lote que sí se vende, en orden FEFO. Si no hay con qué reponerlo, la venta no se puede completar.
 *
 * `lotes` es el estado ANTES de consumir (con lo apartado ya dentro de `reserved`).
 */
export type PlanDeConsumo =
  | { ok: true; vender: RepartoLote[]; liberar: RepartoLote[]; reapartar: RepartoLote[] }
  | { ok: false; faltan: number; vendible: number; vencido: number }

export function planDeConsumo(asignada: readonly RepartoLote[], lotes: readonly LoteConSaldo[], hoy: string): PlanDeConsumo {
  const por = new Map(lotes.map((l) => [l.loteId, l]))
  const vender: RepartoLote[] = []
  const liberar: RepartoLote[] = []
  for (const a of asignada) {
    const lote = por.get(a.loteId)
    if (lote && !esVendible(lote.vencimiento, hoy)) liberar.push(a)
    else vender.push(a)
  }
  if (liberar.length === 0) return { ok: true, vender, liberar, reapartar: [] }
  const falta = sumaDeReparto(liberar)
  // Lo que se libera queda como disponible EN un lote vencido, que no cuenta; lo demás no cambia.
  const r = repartirFefo(lotes, falta, hoy)
  if (!r.ok) return r
  return { ok: true, vender: fusionarReparto([...vender, ...r.reparto]), liberar, reapartar: r.reparto }
}

// ── Devoluciones ─────────────────────────────────────────────────────────────

/**
 * A qué lotes vuelve lo que devuelve un cliente. `vendidoPorLote` es lo que el pedido sacó de cada lote y todavía no volvió (en el
 * orden en que salió). Se devuelve a los MISMOS lotes de que salió, hasta lo que salió de cada uno; si se devuelve más de lo que los
 * movimientos del pedido explican (un pedido anterior a los lotes, una venta de otro modo), el resto vuelve al lote legado: no se
 * inventa un lote al que la mercancía nunca perteneció.
 */
export function repartoDeDevolucion(vendidoPorLote: readonly RepartoLote[], cantidad: number, loteLegadoId: string): RepartoLote[] {
  const reparto: RepartoLote[] = []
  let resto = cantidad
  for (const v of fusionarReparto(vendidoPorLote)) {
    if (resto <= 0) break
    if (v.cantidad <= 0) continue
    const toma = Math.min(resto, v.cantidad)
    reparto.push({ loteId: v.loteId, cantidad: toma })
    resto -= toma
  }
  if (resto > 0) reparto.push({ loteId: loteLegadoId, cantidad: resto })
  return fusionarReparto(reparto)
}

// ── Mover unidades de un lote a otro ─────────────────────────────────────────

/**
 * Corregir un lote mal capturado se hace moviendo sus unidades a otro lote (un par de ajustes con su traza). Devuelve el mensaje de
 * error o `null`. Se mueve lo DISPONIBLE del lote de origen: lo apartado ya está comprometido con un pedido.
 */
export function validarMovimientoEntreLotes(o: { origen: LoteConSaldo; destino: LoteConSaldo; cantidad: number }): string | null {
  if (o.origen.loteId === o.destino.loteId) return 'El lote de origen y el de destino son el mismo.'
  const c = validarCantidad(o.cantidad)
  if (!c.ok) return c.error
  if (c.valor > disponibleDeLote(o.origen)) return `El lote ${o.origen.codigo} solo tiene ${Math.max(0, disponibleDeLote(o.origen))} unidades disponibles.`
  return null
}

// ── Barrido de vencimientos ──────────────────────────────────────────────────

export interface LoteDeSaldo extends LoteConSaldo {
  nivelId: string
}

export interface BajaPorVencimiento {
  nivelId: string
  loteId: string
  cantidad: number
}

/**
 * Lo que el barrido saca de lo vendible: las unidades DISPONIBLES de cada lote ya vencido (no las apartadas: esas se resuelven al
 * consumir o al vencer la reserva). Pasan a dañado con el motivo «vencido»: ya no cuentan como existencia vendible. En orden estable.
 */
export function planDeBarrido(lotes: readonly LoteDeSaldo[], hoy: string): BajaPorVencimiento[] {
  return lotes
    .filter((l) => !esVendible(l.vencimiento, hoy) && disponibleDeLote(l) > 0)
    .map((l) => ({ nivelId: l.nivelId, loteId: l.loteId, cantidad: disponibleDeLote(l) }))
    .sort((a, b) => (a.nivelId < b.nivelId ? -1 : a.nivelId > b.nivelId ? 1 : a.loteId < b.loteId ? -1 : a.loteId > b.loteId ? 1 : 0))
}

// ── Lotes en una línea de entrada ────────────────────────────────────────────

/** Un lote dentro de una línea de entrada: cuántas unidades de esa línea son de ese lote. */
export interface LoteDeLinea {
  /** Normalizado. `SIN LOTE` = el lote legado. */
  codigo: string
  vencimiento: string | null
  cantidad: number
}

export type ResultadoLotesDeLinea = { ok: true; lotes: LoteDeLinea[] } | { ok: false; codigo: string; error: string }

/**
 * Los lotes de una línea de entrada de un producto QUE LLEVA LOTES. Cada renglón: código, vencimiento (opcional) y cantidad; la suma
 * es la cantidad de la línea. Un mismo código dos veces en la línea se junta si traen el mismo vencimiento y es un error si no (un
 * lote tiene UN vencimiento). «SIN LOTE» no lleva vencimiento. Si el producto exige vencimiento, todo lote con código lo trae.
 */
export function validarLotesDeLinea(lotes: unknown, cantidadLinea: number, opciones: { exigirVencimiento: boolean }): ResultadoLotesDeLinea {
  if (!Array.isArray(lotes) || lotes.length === 0) return { ok: false, codigo: 'LOTES_FALTAN', error: 'Este producto lleva lotes: indica de qué lote es lo que entra (o «SIN LOTE»).' }
  if (lotes.length > MAX_LOTES_POR_LINEA) return { ok: false, codigo: 'DEMASIADOS_LOTES', error: `Una línea admite hasta ${MAX_LOTES_POR_LINEA} lotes.` }
  const por = new Map<string, LoteDeLinea>()
  for (const crudo of lotes as unknown[]) {
    const l = crudo as { codigo?: unknown; vencimiento?: unknown; cantidad?: unknown } | null
    const codigo = normalizarCodigoLote(l?.codigo)
    if (!codigo.ok) return { ok: false, codigo: 'LOTE_INVALIDO', error: codigo.error }
    const venc = parsearVencimiento(l?.vencimiento)
    if (!venc.ok) return { ok: false, codigo: 'VENCIMIENTO_INVALIDO', error: `Lote ${codigo.valor}: ${venc.error}` }
    if (esCodigoSinLote(codigo.valor) && venc.valor !== null) return { ok: false, codigo: 'SIN_LOTE_CON_VENCIMIENTO', error: '«SIN LOTE» no lleva vencimiento.' }
    if (opciones.exigirVencimiento && !esCodigoSinLote(codigo.valor) && venc.valor === null) {
      return { ok: false, codigo: 'VENCIMIENTO_OBLIGATORIO', error: `Este producto exige vencimiento: indica el del lote ${codigo.valor}.` }
    }
    const c = validarCantidad(l?.cantidad)
    if (!c.ok) return { ok: false, codigo: 'CANTIDAD_INVALIDA', error: `Lote ${codigo.valor}: ${c.error}` }
    const previo = por.get(codigo.valor)
    if (previo) {
      if (previo.vencimiento !== venc.valor) return { ok: false, codigo: 'VENCIMIENTO_DISTINTO', error: `El lote ${codigo.valor} aparece con dos vencimientos distintos; un lote tiene uno solo.` }
      previo.cantidad = Math.min(previo.cantidad + c.valor, CANTIDAD_MAXIMA)
    } else {
      por.set(codigo.valor, { codigo: codigo.valor, vencimiento: venc.valor, cantidad: c.valor })
    }
  }
  const resultado = [...por.values()]
  const suma = resultado.reduce((s, l) => s + l.cantidad, 0)
  if (suma !== cantidadLinea) return { ok: false, codigo: 'LOTES_NO_CUADRAN', error: `Los lotes suman ${suma} unidades y la línea dice ${cantidadLinea}.` }
  return { ok: true, lotes: resultado }
}
