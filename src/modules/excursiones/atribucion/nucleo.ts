/**
 * EXCURSIONES · Atribución — NÚCLEO PURO.
 *
 * Una atribución es un HECHO INMUTABLE: «esta persona entró por el enlace de
 * este vendedor en esta fecha». Jamás se edita ni se borra. La POLÍTICA
 * (primera, última o la de la reserva) no se aplica al guardar el hecho, sino
 * al momento de decidir a quién le toca la comisión — por eso vive aquí, como
 * función pura, y no repartida por el código (§12).
 */

// ── Etapas del embudo ────────────────────────────────────────────────────────

export const ETAPAS_ATRIBUCION = ['VISITA', 'REGISTRO', 'RESERVA', 'COMPRA'] as const
export type EtapaAtribucion = (typeof ETAPAS_ATRIBUCION)[number]

export const ETAPA_ATRIBUCION_LABEL: Record<EtapaAtribucion, string> = {
  VISITA: 'Visita',
  REGISTRO: 'Registro',
  RESERVA: 'Reserva',
  COMPRA: 'Compra',
}

// ── Canales ──────────────────────────────────────────────────────────────────

export const CANALES_ATRIBUCION = ['QR', 'ENLACE', 'WHATSAPP', 'REDES'] as const
export type CanalAtribucion = (typeof CANALES_ATRIBUCION)[number]

/**
 * Canal declarado en el enlace (`?c=qr`). Lo que no reconocemos es un enlace
 * normal: preferimos un dato honesto y genérico antes que inventar precisión.
 */
export function sanitizarCanalAtribucion(valor: unknown): CanalAtribucion {
  const v = typeof valor === 'string' ? valor.trim().toUpperCase() : ''
  return (CANALES_ATRIBUCION as readonly string[]).includes(v) ? (v as CanalAtribucion) : 'ENLACE'
}

// ── Cookie y ventana ─────────────────────────────────────────────────────────

/** Enlace del vendedor que trajo a este visitante (guarda el slug). */
export const VENDEDOR_COOKIE = 'mg_ven'

/** Defecto de `ExcursionesConfig.ventanaAtribucionDias`. */
export const VENTANA_ATRIBUCION_DIAS = 30

export const POLITICAS_ATRIBUCION = ['PRIMERA', 'ULTIMA', 'RESERVA'] as const
export type PoliticaAtribucion = (typeof POLITICAS_ATRIBUCION)[number]

export const POLITICA_ATRIBUCION_LABEL: Record<PoliticaAtribucion, string> = {
  PRIMERA: 'Primera atribución (quien lo trajo)',
  ULTIMA: 'Última atribución (quien lo cerró)',
  RESERVA: 'Quien tomó la reserva',
}

export function politicaValida(valor: unknown): PoliticaAtribucion {
  const v = typeof valor === 'string' ? valor.trim().toUpperCase() : ''
  return (POLITICAS_ATRIBUCION as readonly string[]).includes(v)
    ? (v as PoliticaAtribucion)
    : 'PRIMERA'
}

/** ¿La atribución sigue viva al momento `ahora`? (0 o menos = sin caducidad). */
export function dentroDeVentana(fecha: Date, dias: number, ahora: Date): boolean {
  if (!Number.isFinite(dias) || dias <= 0) return true
  const limite = ahora.getTime() - dias * 24 * 60 * 60 * 1000
  return fecha.getTime() >= limite
}

export interface AtribucionHecho {
  vendedorId: string
  etapa: string
  createdAt: Date
}

/**
 * A quién le corresponde la venta, según la política de la empresa. Puro:
 * recibe los hechos y devuelve el vendedor, sin tocar la base de datos.
 *
 * - PRIMERA: quien lo trajo (la atribución más antigua todavía dentro de la
 *   ventana). Es el defecto: premia el esfuerzo de captación.
 * - ULTIMA: quien lo cerró (la más reciente dentro de la ventana).
 * - RESERVA: quien tomó la reserva; si esa venta no nació de una reserva
 *   atribuida, cae a la última — nunca deja la comisión sin dueño por un
 *   tecnicismo.
 *
 * Fuera de la ventana no hay atribución: la comisión no tiene dueño y el
 * llamador decide (venta directa de la empresa). Devolver un vendedor
 * caducado sería inventar una deuda.
 */
export function resolverVendedorAtribuido(
  hechos: AtribucionHecho[],
  opciones: { politica: PoliticaAtribucion; ventanaDias?: number; ahora?: Date }
): string | null {
  const ahora = opciones.ahora ?? new Date()
  const ventana = opciones.ventanaDias ?? VENTANA_ATRIBUCION_DIAS
  const vivos = hechos
    .filter((h) => h.vendedorId && dentroDeVentana(h.createdAt, ventana, ahora))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  if (vivos.length === 0) return null

  if (opciones.politica === 'RESERVA') {
    const deReserva = vivos.filter((h) => h.etapa === 'RESERVA')
    if (deReserva.length > 0) return deReserva[deReserva.length - 1].vendedorId
    return vivos[vivos.length - 1].vendedorId
  }
  if (opciones.politica === 'ULTIMA') return vivos[vivos.length - 1].vendedorId
  return vivos[0].vendedorId
}
