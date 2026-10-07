import type { CatalogItemStatus, CatalogItemType, CatalogVariantStatus } from '@prisma/client'
import { decimal, redondear2 } from '@/lib/commerce-primitives/dinero'
import { puedeTransicionar, type Transiciones } from '@/lib/commerce-primitives/estados'

/**
 * COMMERCE CORE · catálogo unificado: reglas PURAS (Fase 1).
 *
 * Sin Prisma ni red: todo lo que aquí se decide se prueba sin base de datos.
 * El servicio (`service.ts`) lo usa y la base lo respalda con sus propias
 * restricciones (ver la migración `20261036_catalog_core`).
 *
 * LA REGLA DE FONDO: un ítem es lo que se OFRECE y una variante es lo que se
 * COMPRA. Todo ítem tiene al menos una variante; un ítem simple nace con una
 * `isDefault` que la interfaz no muestra mientras sea la única.
 */

export const TIPOS_ITEM: readonly CatalogItemType[] = [
  'PHYSICAL_PRODUCT',
  'SERVICE',
  'BUNDLE',
  'MEMBERSHIP',
  'VOUCHER',
  'DIGITAL_PRODUCT',
  'GIFT_CARD',
]

export const MAX_NOMBRE_ITEM = 160
export const MAX_DESCRIPCION = 4000
export const MAX_NOMBRE_VARIANTE = 120
/** Techo de `Decimal(12,2)`. Un precio que no cabe es un error de captura. */
const MAX_MONTO = 9_999_999_999.99

// ── Capacidades del ítem ─────────────────────────────────────────────────────

/**
 * Qué hace el ítem. Es lo que los demás módulos preguntarán (inventario mira
 * `trackInventory`; las citas, `requiresBooking`…) en vez de preguntar por el
 * tipo, que es una etiqueta comercial y no un comportamiento.
 */
export interface CapacidadesItem {
  trackInventory: boolean
  requiresBooking: boolean
  requiresRedemption: boolean
  requiresPreparation: boolean
  availableMarketplace: boolean
  availablePOS: boolean
}

const CLAVES_CAPACIDAD: readonly (keyof CapacidadesItem)[] = [
  'trackInventory',
  'requiresBooking',
  'requiresRedemption',
  'requiresPreparation',
  'availableMarketplace',
  'availablePOS',
]

const base: CapacidadesItem = {
  trackInventory: false,
  requiresBooking: false,
  requiresRedemption: false,
  requiresPreparation: false,
  availableMarketplace: true,
  availablePOS: true,
}

/** Valores de partida por tipo. La empresa los puede cambiar ítem por ítem. */
export const CAPACIDADES_POR_TIPO: Record<CatalogItemType, CapacidadesItem> = {
  PHYSICAL_PRODUCT: { ...base, trackInventory: true },
  SERVICE: { ...base },
  BUNDLE: { ...base },
  MEMBERSHIP: { ...base, requiresRedemption: true },
  VOUCHER: { ...base, requiresRedemption: true, availablePOS: false },
  DIGITAL_PRODUCT: { ...base, availablePOS: false },
  GIFT_CARD: { ...base, requiresRedemption: true },
}

/**
 * Capacidades finales de un ítem: los valores del tipo, con encima lo que la
 * empresa haya indicado. Solo cuentan las seis claves conocidas y solo si son
 * booleanos: lo demás se descarta, porque este JSON lo leen otros módulos y no
 * debe poder colar claves ni tipos arbitrarios.
 */
export function normalizarCapacidades(tipo: CatalogItemType, entrada?: unknown): CapacidadesItem {
  const resultado = { ...CAPACIDADES_POR_TIPO[tipo] }
  if (entrada && typeof entrada === 'object' && !Array.isArray(entrada)) {
    for (const clave of CLAVES_CAPACIDAD) {
      const v = (entrada as Record<string, unknown>)[clave]
      if (typeof v === 'boolean') resultado[clave] = v
    }
  }
  return resultado
}

// ── Estados ──────────────────────────────────────────────────────────────────

/**
 * Ciclo de vida del ítem. DRAFT es lo que nace; ARCHIVED se puede restaurar a
 * DRAFT (nunca directo a ACTIVE: hay que volver a revisarlo antes de publicar).
 */
export const TRANSICIONES_ITEM: Transiciones<CatalogItemStatus> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
}

export function puedeCambiarEstadoItem(desde: CatalogItemStatus, hasta: CatalogItemStatus): boolean {
  return puedeTransicionar(TRANSICIONES_ITEM, desde, hasta)
}

/**
 * Un ítem se publica solo si se puede COMPRAR: necesita al menos una variante
 * activa. Un ítem con todas sus variantes agotadas o descontinuadas no tiene
 * nada que vender.
 */
export function motivoParaNoPublicar(variantes: readonly { status: CatalogVariantStatus }[]): string | null {
  if (!variantes.some((v) => v.status === 'ACTIVE')) {
    return 'Para publicarlo necesita al menos una variante activa.'
  }
  return null
}

// ── Textos ───────────────────────────────────────────────────────────────────

// Las entradas de una Server Action llegan del navegador: cualquier campo puede
// no ser texto. `t` no lanza, devuelve null.
const t = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** `Pizza Grande — 12"` → `pizza-grande-12`. Sin acentos ni símbolos. */
export function slugDeNombre(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return base || 'item'
}

/**
 * Slug libre dentro de la empresa. `ocupados` son los que ya existen ahí. Los
 * sufijos empiezan en `-2`: «lavado-1» sugiere que hay una serie y no la hay.
 */
export function elegirSlugLibre(base: string, ocupados: ReadonlySet<string>): string {
  if (!ocupados.has(base)) return base
  for (let n = 2; ; n++) {
    const candidato = `${base}-${n}`
    if (!ocupados.has(candidato)) return candidato
  }
}

// ── Dinero ───────────────────────────────────────────────────────────────────

/** Monto válido (≥ 0, cabe en Decimal(12,2)) redondeado a 2 decimales, o null. */
export function normalizarMonto(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const s = typeof v === 'string' ? v.trim().replace(',', '.') : v
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONTO) return null
  return redondear2(decimal(typeof s === 'number' ? s : String(s))).toFixed(2)
}

// ── Variantes ────────────────────────────────────────────────────────────────

export interface DatosVariante {
  name?: string | null
  sku?: string | null
  barcode?: string | null
  price: number | string
  cost?: number | string | null
  compareAtPrice?: number | string | null
  attributes?: Record<string, unknown> | null
  status?: CatalogVariantStatus
}

export interface VarianteNormalizada {
  name: string
  /** null = que el servicio genere uno. */
  sku: string | null
  barcode: string | null
  price: string
  cost: string | null
  compareAtPrice: string | null
  attributes: Record<string, string>
  status: CatalogVariantStatus
}

const SKU_VALIDO = /^[A-Z0-9][A-Z0-9._-]{0,39}$/
const ESTADOS_VARIANTE: readonly CatalogVariantStatus[] = ['ACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED']
const MAX_ATRIBUTOS = 20

/** SKU en su forma canónica (mayúsculas, sin espacios en los bordes), o null. */
export function normalizarSku(v: string | null | undefined): string | null {
  return t(v)?.toUpperCase() ?? null
}

/**
 * Atributos como texto plano: `{ talla: 'M', color: 'Rojo' }`. Se descartan
 * valores vacíos y no-texto. Devuelve un error legible si hay demasiados o si
 * una clave/valor es excesivamente largo.
 */
export function normalizarAtributos(
  entrada: Record<string, unknown> | null | undefined
): { ok: true; atributos: Record<string, string> } | { ok: false; error: string } {
  const atributos: Record<string, string> = {}
  if (!entrada) return { ok: true, atributos }
  if (typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, error: 'Los atributos deben ser pares nombre/valor.' }
  }
  for (const [k, v] of Object.entries(entrada)) {
    const clave = k.trim()
    const valor = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
    if (!clave || !valor) continue
    if (clave.length > 40 || valor.length > 80) return { ok: false, error: 'Un atributo es demasiado largo.' }
    atributos[clave] = valor
  }
  if (Object.keys(atributos).length > MAX_ATRIBUTOS) {
    return { ok: false, error: `Una variante admite hasta ${MAX_ATRIBUTOS} atributos.` }
  }
  return { ok: true, atributos }
}

export function validarVariante(
  d: DatosVariante
): { ok: true; datos: VarianteNormalizada } | { ok: false; error: string } {
  const name = t(d.name) ?? 'Default'
  if (name.length > MAX_NOMBRE_VARIANTE) return { ok: false, error: 'El nombre de la variante es demasiado largo.' }

  const price = normalizarMonto(d.price)
  if (price == null) return { ok: false, error: 'El precio debe ser un monto válido, mayor o igual a cero.' }

  let cost: string | null = null
  if (d.cost != null && d.cost !== '') {
    cost = normalizarMonto(d.cost)
    if (cost == null) return { ok: false, error: 'El costo debe ser un monto válido, mayor o igual a cero.' }
  }

  let compareAtPrice: string | null = null
  if (d.compareAtPrice != null && d.compareAtPrice !== '') {
    compareAtPrice = normalizarMonto(d.compareAtPrice)
    if (compareAtPrice == null) return { ok: false, error: 'El precio anterior debe ser un monto válido.' }
    if (decimal(compareAtPrice).lt(decimal(price))) {
      return { ok: false, error: 'El precio anterior no puede ser menor que el precio actual.' }
    }
  }

  const sku = normalizarSku(d.sku)
  if (sku && !SKU_VALIDO.test(sku)) {
    return { ok: false, error: 'El SKU solo admite letras, números, punto, guion y guion bajo (hasta 40).' }
  }

  const barcode = t(d.barcode)
  if (barcode && !/^[A-Za-z0-9-]{1,64}$/.test(barcode)) {
    return { ok: false, error: 'El código de barras solo admite letras, números y guion.' }
  }

  const attrs = normalizarAtributos(d.attributes)
  if (!attrs.ok) return attrs

  const status = d.status ?? 'ACTIVE'
  if (!ESTADOS_VARIANTE.includes(status)) return { ok: false, error: 'Estado de variante no válido.' }

  return { ok: true, datos: { name, sku, barcode, price, cost, compareAtPrice, attributes: attrs.atributos, status } }
}

// ── Ítems ────────────────────────────────────────────────────────────────────

export interface DatosItem {
  name: string
  description?: string | null
  type: CatalogItemType
  currency?: string | null
  capabilities?: unknown
  /**
   * Variantes explícitas. Ausente o vacío = ítem SIMPLE: se crea una variante
   * `isDefault` con `price` (y opcionalmente `cost`, `compareAtPrice`, `sku`,
   * `barcode`).
   */
  variants?: DatosVariante[] | null
  price?: number | string | null
  cost?: number | string | null
  compareAtPrice?: number | string | null
  sku?: string | null
  barcode?: string | null
}

export interface ItemNormalizado {
  name: string
  description: string | null
  type: CatalogItemType
  currency: string
  capabilities: CapacidadesItem
  /** true = ítem simple: la única variante es la automática. */
  simple: boolean
  variantes: VarianteNormalizada[]
}

export const MAX_VARIANTES_POR_ITEM = 100

export function validarItem(d: DatosItem): { ok: true; datos: ItemNormalizado } | { ok: false; error: string } {
  const name = t(d.name)
  if (!name) return { ok: false, error: 'El producto o servicio necesita un nombre.' }
  if (name.length > MAX_NOMBRE_ITEM) return { ok: false, error: 'El nombre es demasiado largo.' }
  const description = t(d.description)
  if (description && description.length > MAX_DESCRIPCION) return { ok: false, error: 'La descripción es demasiado larga.' }
  if (!TIPOS_ITEM.includes(d.type)) return { ok: false, error: 'Tipo de producto no válido.' }

  const currency = (t(d.currency) ?? 'DOP').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'La moneda debe ser un código de 3 letras (p. ej. DOP).' }

  if (d.variants != null && !Array.isArray(d.variants)) return { ok: false, error: 'Las variantes deben ser una lista.' }
  const explicitas = d.variants ?? []
  const simple = explicitas.length === 0
  if (explicitas.length > MAX_VARIANTES_POR_ITEM) {
    return { ok: false, error: `Un producto admite hasta ${MAX_VARIANTES_POR_ITEM} variantes.` }
  }

  const entradas: DatosVariante[] = simple
    ? [
        {
          name: 'Default',
          price: d.price ?? '',
          cost: d.cost,
          compareAtPrice: d.compareAtPrice,
          sku: d.sku,
          barcode: d.barcode,
        },
      ]
    : explicitas

  const variantes: VarianteNormalizada[] = []
  for (const [i, e] of entradas.entries()) {
    const prefijo = simple ? '' : `Variante ${i + 1}: `
    // Una variante real se distingue por su nombre; solo la automática puede
    // llamarse «Default» sin que nadie lo escriba.
    if (!simple && !t(e.name)) return { ok: false, error: `${prefijo}necesita un nombre (p. ej. «M / Rojo»).` }
    const v = validarVariante(e)
    if (!v.ok) return { ok: false, error: prefijo + v.error }
    variantes.push(v.datos)
  }

  // Repetidos dentro del MISMO envío: el índice único los rechazaría de todas
  // formas, pero con un error de base de datos en vez de uno que diga cuál es.
  const skus = variantes.map((v) => v.sku).filter((s): s is string => !!s)
  if (new Set(skus).size !== skus.length) return { ok: false, error: 'Hay SKUs repetidos entre las variantes.' }
  const codigos = variantes.map((v) => v.barcode).filter((s): s is string => !!s)
  if (new Set(codigos).size !== codigos.length) {
    return { ok: false, error: 'Hay códigos de barras repetidos entre las variantes.' }
  }
  const nombres = variantes.map((v) => v.name.toLowerCase())
  if (!simple && new Set(nombres).size !== nombres.length) {
    return { ok: false, error: 'Hay variantes con el mismo nombre.' }
  }

  return {
    ok: true,
    datos: { name, description, type: d.type, currency, capabilities: normalizarCapacidades(d.type, d.capabilities), simple, variantes },
  }
}
