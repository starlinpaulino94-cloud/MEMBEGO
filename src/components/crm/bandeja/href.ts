/** La URL de la bandeja con sus filtros. Compartida entre lista, hilo y página. */
export const RUTA_BANDEJA = '/admin/crm/conversaciones'

export interface ParametrosBandeja {
  canal?: string | null
  estado?: string | null
  q?: string | null
  c?: string | null
}

export function hrefBandeja(p: ParametrosBandeja): string {
  const sp = new URLSearchParams()
  if (p.canal) sp.set('canal', p.canal)
  if (p.estado && p.estado !== 'ABIERTA') sp.set('estado', p.estado)
  if (p.q) sp.set('q', p.q)
  if (p.c) sp.set('c', p.c)
  const s = sp.toString()
  return s ? `${RUTA_BANDEJA}?${s}` : RUTA_BANDEJA
}
