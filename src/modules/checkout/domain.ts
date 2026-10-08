import type { MembegoPaymentMethod } from '@prisma/client'

/**
 * MARKETPLACE CHECKOUT · núcleo puro (Fase 8). Sin Prisma ni Next: lo importan también los componentes de
 * cliente (el carrito vive en el navegador) y las pruebas.
 *
 * EL CARRITO ES DEL NEGOCIO. Un carrito mezclando negocios no se puede cobrar ni entregar: cada empresa
 * atiende su pedido, con su sucursal y su caja. Por eso el carrito guarda un renglón por variante DENTRO de
 * cada negocio (su `slug`), y el pago se hace de un negocio a la vez.
 *
 * EL CARRITO NO ES UNA FUENTE DE VERDAD. Guarda solo qué variante y cuántas; el nombre, el precio y la
 * disponibilidad se piden al servidor cada vez que se enseñan, y el pedido se arma con los precios del catálogo
 * en el momento de pagar. Un precio guardado en el navegador no vale para nada.
 */

export const MAX_LINEAS_CARRITO = 30
export const MAX_CANTIDAD_POR_LINEA = 99
export const MAX_NEGOCIOS_EN_CARRITO = 10
export const CLAVE_CARRITO = 'mg_carrito_v1'

export interface LineaDeCarrito {
  varianteId: string
  cantidad: number
}

/** `slug` del negocio → sus renglones. */
export interface Carrito {
  v: 1
  negocios: Record<string, LineaDeCarrito[]>
}

export const CARRITO_VACIO: Carrito = { v: 1, negocios: {} }

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/

const entero = (n: unknown, min: number, max: number): number | null => {
  const x = typeof n === 'number' ? n : Number(n)
  return Number.isInteger(x) && x >= min && x <= max ? x : null
}

/**
 * Lee lo guardado en el navegador SIN confiar en ello: el JSON pudo escribirlo cualquiera (o un código viejo).
 * Lo que no encaja se descarta renglón por renglón; nada de lo que haya ahí puede romper la pantalla.
 */
export function leerCarrito(crudo: unknown): Carrito {
  let obj: unknown = crudo
  if (typeof crudo === 'string') {
    try {
      obj = JSON.parse(crudo)
    } catch {
      return { v: 1, negocios: {} }
    }
  }
  if (typeof obj !== 'object' || obj === null || (obj as { v?: unknown }).v !== 1) return { v: 1, negocios: {} }
  const negociosCrudos = (obj as { negocios?: unknown }).negocios
  if (typeof negociosCrudos !== 'object' || negociosCrudos === null || Array.isArray(negociosCrudos)) return { v: 1, negocios: {} }
  const negocios: Record<string, LineaDeCarrito[]> = {}
  for (const [slug, lineas] of Object.entries(negociosCrudos).slice(0, MAX_NEGOCIOS_EN_CARRITO)) {
    if (!SLUG.test(slug) || !Array.isArray(lineas)) continue
    const porVariante = new Map<string, number>()
    for (const l of lineas.slice(0, MAX_LINEAS_CARRITO)) {
      const varianteId = typeof (l as LineaDeCarrito)?.varianteId === 'string' ? (l as LineaDeCarrito).varianteId : ''
      const cantidad = entero((l as LineaDeCarrito)?.cantidad, 1, MAX_CANTIDAD_POR_LINEA)
      if (!ID.test(varianteId) || cantidad === null) continue
      porVariante.set(varianteId, Math.min(MAX_CANTIDAD_POR_LINEA, (porVariante.get(varianteId) ?? 0) + cantidad))
    }
    if (porVariante.size > 0) negocios[slug] = [...porVariante.entries()].map(([varianteId, cantidad]) => ({ varianteId, cantidad }))
  }
  return { v: 1, negocios }
}

export type ResultadoCarrito = { ok: true; carrito: Carrito } | { ok: false; error: string }

/** Agrega `cantidad` de una variante al carrito del negocio (suma si ya estaba). Devuelve un carrito NUEVO. */
/**
 * Los renglones de un negocio. Se lee con `hasOwn`: un slug como `constructor` o `toString` no puede devolver lo que hereda
 * el objeto (un negocio llamado «Constructor» existe y su slug pasa la validación).
 */
export function lineasDe(carrito: Carrito, slug: string): LineaDeCarrito[] {
  return Object.hasOwn(carrito.negocios, slug) ? carrito.negocios[slug] : []
}

export function agregar(carrito: Carrito, slug: string, varianteId: string, cantidad: number): ResultadoCarrito {
  if (!SLUG.test(slug)) return { ok: false, error: 'El negocio no es válido.' }
  if (!ID.test(varianteId)) return { ok: false, error: 'El producto no es válido.' }
  const n = entero(cantidad, 1, MAX_CANTIDAD_POR_LINEA)
  if (n === null) return { ok: false, error: `La cantidad tiene que ser un entero entre 1 y ${MAX_CANTIDAD_POR_LINEA}.` }
  const actuales = lineasDe(carrito, slug)
  if (!Object.hasOwn(carrito.negocios, slug) && Object.keys(carrito.negocios).length >= MAX_NEGOCIOS_EN_CARRITO) return { ok: false, error: `El carrito admite como máximo ${MAX_NEGOCIOS_EN_CARRITO} negocios a la vez.` }
  const i = actuales.findIndex((l) => l.varianteId === varianteId)
  if (i < 0 && actuales.length >= MAX_LINEAS_CARRITO) return { ok: false, error: `Un carrito admite como máximo ${MAX_LINEAS_CARRITO} productos distintos por negocio.` }
  const lineas = i >= 0 ? actuales.map((l, j) => (j === i ? { ...l, cantidad: Math.min(MAX_CANTIDAD_POR_LINEA, l.cantidad + n) } : l)) : [...actuales, { varianteId, cantidad: n }]
  return { ok: true, carrito: { v: 1, negocios: { ...carrito.negocios, [slug]: lineas } } }
}

/** Pone la cantidad exacta de un renglón (1–99). Si el renglón no está, no hace nada. */
export function fijarCantidad(carrito: Carrito, slug: string, varianteId: string, cantidad: number): Carrito {
  const n = entero(cantidad, 1, MAX_CANTIDAD_POR_LINEA)
  const lineas = Object.hasOwn(carrito.negocios, slug) ? carrito.negocios[slug] : undefined
  if (n === null || !lineas) return carrito
  return { v: 1, negocios: { ...carrito.negocios, [slug]: lineas.map((l) => (l.varianteId === varianteId ? { ...l, cantidad: n } : l)) } }
}

/** Quita un renglón; si era el último del negocio, el negocio sale del carrito. */
export function quitar(carrito: Carrito, slug: string, varianteId: string): Carrito {
  const lineas = Object.hasOwn(carrito.negocios, slug) ? carrito.negocios[slug] : undefined
  if (!lineas) return carrito
  const resto = lineas.filter((l) => l.varianteId !== varianteId)
  const { [slug]: _quitado, ...otros } = carrito.negocios
  void _quitado
  return { v: 1, negocios: resto.length > 0 ? { ...otros, [slug]: resto } : otros }
}

/** Vacía el carrito de un negocio (lo que se hace al pagarlo). */
export function vaciarNegocio(carrito: Carrito, slug: string): Carrito {
  const { [slug]: _quitado, ...otros } = carrito.negocios
  void _quitado
  return { v: 1, negocios: otros }
}

/** Cuántas unidades hay en todo el carrito (para el contador del encabezado). */
export function totalDeUnidades(carrito: Carrito): number {
  return Object.values(carrito.negocios).reduce((t, ls) => t + ls.reduce((s, l) => s + l.cantidad, 0), 0)
}

// ── Cómo se paga ─────────────────────────────────────────────────────────────

export const METODOS_CHECKOUT = ['AL_RECOGER', 'TRANSFERENCIA'] as const
export type MetodoCheckout = (typeof METODOS_CHECKOUT)[number]

export const ETIQUETA_METODO_CHECKOUT: Readonly<Record<MetodoCheckout, string>> = {
  AL_RECOGER: 'Pago al recoger en el negocio',
  TRANSFERENCIA: 'Pago por transferencia bancaria',
}

export function esMetodoCheckout(v: unknown): v is MetodoCheckout {
  return typeof v === 'string' && (METODOS_CHECKOUT as readonly string[]).includes(v)
}

/**
 * El método que se anota en el pedido como INTENCIÓN. «Al recoger» no fija ninguno: quien cobra elige
 * efectivo, tarjeta o transferencia en el mostrador. Una transferencia elegida aquí no verifica nada por sí
 * sola: el pago se verifica cuando el negocio registra la referencia que ve en su banco.
 */
export function metodoDePedidoDelCheckout(m: MetodoCheckout): MembegoPaymentMethod | null {
  return m === 'TRANSFERENCIA' ? 'TRANSFER' : null
}

export const NOTAS_MAXIMAS = 300

/** La nota que ve el negocio: cómo piensa pagar el cliente y, si lo dejó, su recado. */
export function notaDelPedido(metodo: MetodoCheckout, notasDelCliente: unknown): string | null {
  const recado = typeof notasDelCliente === 'string' ? notasDelCliente.trim().replace(/\s+/g, ' ') : ''
  const pago = metodo === 'TRANSFERENCIA' ? 'Pagará por transferencia' : 'Pagará al recoger'
  const completa = recado ? `${pago}. ${recado}` : pago
  return completa.slice(0, NOTAS_MAXIMAS)
}

/** Los canales de origen que el navegador puede declarar (los demás los fija el servidor). */
export const CANALES_DE_CHECKOUT = { navegacion: 'MARKETPLACE_BROWSE', busqueda: 'MARKETPLACE_SEARCH', directo: 'DIRECT' } as const
