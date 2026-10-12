// Catálogo de tipos de campaña de marketing (fuente única para formularios,
// validación en actions y etiquetas en listas). Puro: seguro en cliente.

export const MARKETING_TIPOS = [
  { value: 'FLASH_SALE', label: 'Oferta relámpago', desc: 'Contador; por tiempo muy limitado' },
  { value: 'OFERTA_DIA', label: 'Oferta del día', desc: 'Válida hoy' },
  { value: 'FIN_DE_SEMANA', label: 'Fin de semana', desc: 'Viernes a domingo' },
  { value: 'HAPPY_HOUR', label: 'Happy Hour', desc: 'Ventana horaria diaria' },
  { value: 'PRIMERA_COMPRA', label: 'Primera compra', desc: 'Nuevos clientes' },
  { value: 'BIENVENIDA', label: 'Bienvenida', desc: 'Al registrarse' },
  { value: 'REGRESO', label: 'Regreso', desc: 'Clientes inactivos' },
  { value: 'CUMPLEANOS', label: 'Cumpleaños', desc: 'Cupón de cumpleaños' },
  { value: 'POR_VENCER', label: 'Por vencer', desc: 'Recordatorio de beneficio' },
  { value: 'PERSONALIZADA', label: 'Personalizada', desc: 'Genérica' },
] as const

export type MarketingTipo = (typeof MARKETING_TIPOS)[number]['value']

export const MARKETING_TIPO_LABEL: Record<string, string> = Object.fromEntries(
  MARKETING_TIPOS.map((t) => [t.value, t.label])
)

export function esMarketingTipoValido(v: string): v is MarketingTipo {
  return MARKETING_TIPOS.some((t) => t.value === v)
}

/** Destinos internos frecuentes para el botón de la campaña. */
export const MARKETING_CTA_DESTINOS = [
  { value: '/cliente/promociones', label: 'Promociones' },
  { value: '/cliente/planes', label: 'Planes' },
  { value: '/cliente/explorar', label: 'Explorar empresas' },
  { value: '/cliente/invita-y-gana', label: 'Invita y Gana' },
] as const

export function esMarketingCtaDestinoValido(v: string): boolean {
  return MARKETING_CTA_DESTINOS.some((destino) => destino.value === v)
}

export const DIAS_SEMANA = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
] as const

/** "14:30" → 870 minutos. Devuelve null si vacío/ inválido. */
export function horaAMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** 870 → "14:30". */
export function minutosAHora(min: number | null | undefined): string {
  if (min == null) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}
