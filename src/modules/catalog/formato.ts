/**
 * COMMERCE CORE · catálogo — formato para pantallas. Puro: sin Prisma ni React.
 */

/** Precio con la moneda DEL ÍTEM (`DOP` → `RD$`), siempre a dos decimales. */
export function formatearPrecio(monto: number | string, moneda = 'DOP'): string {
  const n = typeof monto === 'string' ? Number(monto) : monto
  const valor = Number.isFinite(n) ? n : 0
  try {
    return new Intl.NumberFormat('es-DO', {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valor)
  } catch {
    return `${moneda} ${valor.toFixed(2)}`
  }
}

/**
 * URL pública de una imagen del catálogo a partir de su ruta en el bucket
 * `promociones`. null si no hay `NEXT_PUBLIC_SUPABASE_URL` (no se inventa una).
 */
export function urlPublicaCatalogo(
  ruta: string,
  base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): string | null {
  if (!base || !ruta) return null
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/promociones/${ruta}`
}

export const ETIQUETA_TIPO: Record<string, string> = {
  PHYSICAL_PRODUCT: 'Producto físico',
  SERVICE: 'Servicio',
  BUNDLE: 'Paquete',
  MEMBERSHIP: 'Membresía',
  VOUCHER: 'Voucher',
  DIGITAL_PRODUCT: 'Producto digital',
  GIFT_CARD: 'Tarjeta de regalo',
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Publicado',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
}

export const ETIQUETA_ESTADO_VARIANTE: Record<string, string> = {
  ACTIVE: 'Activa',
  OUT_OF_STOCK: 'Agotada',
  DISCONTINUED: 'Descontinuada',
}

export const ETIQUETA_CAPACIDAD: Record<string, string> = {
  trackInventory: 'Controla inventario',
  requiresBooking: 'Requiere reserva o cita',
  requiresRedemption: 'Se canjea (QR / voucher)',
  requiresPreparation: 'Requiere preparación',
  availableMarketplace: 'Visible en el marketplace',
  availablePOS: 'Disponible en caja (POS)',
}
