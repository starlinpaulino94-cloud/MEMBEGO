import { conEmpresa } from '@/lib/tenant'

/**
 * App Car Wash · E5 — EVIDENCIA FOTOGRÁFICA (antes/después).
 * Fotos ligadas a una entrada de la cola cuando existe, o solo a la placa.
 * Capacidad: EVIDENCIA_FOTOS (nace apagada). Bucket de storage: `evidencias`
 * (público) — crearlo en Supabase Storage antes del primer uso.
 */

export const EVIDENCIA_MOMENTOS = ['ANTES', 'DESPUES'] as const
export type EvidenciaMomento = (typeof EVIDENCIA_MOMENTOS)[number]

export const EVIDENCIA_MOMENTO_LABELS: Record<EvidenciaMomento, string> = {
  ANTES: 'Antes',
  DESPUES: 'Después',
}

export async function getEvidencias(
  companyId: string,
  filtro: { q?: string; colaId?: string } = {}
) {
  const q = filtro.q?.trim()
  return conEmpresa(companyId, (tx) =>
    tx.evidenciaFoto.findMany({
      where: {
        companyId,
        ...(filtro.colaId ? { colaId: filtro.colaId } : {}),
        ...(q
          ? {
              OR: [
                { placa: { contains: q, mode: 'insensitive' } },
                { cliente: { nombre: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        momento: true,
        url: true,
        placa: true,
        nota: true,
        createdAt: true,
        cliente: { select: { id: true, nombre: true } },
        subidaPor: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    })
  )
}
