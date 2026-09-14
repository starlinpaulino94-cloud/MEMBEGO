import { conEmpresa } from '@/lib/tenant'

export type EstadoHome = 'BORRADOR' | 'PROGRAMADA' | 'PUBLICADA' | 'PAUSADA' | 'ARCHIVADA'

const TRANSICIONES: Record<EstadoHome, EstadoHome[]> = {
  BORRADOR: ['PROGRAMADA', 'PUBLICADA', 'ARCHIVADA'],
  PROGRAMADA: ['PUBLICADA', 'PAUSADA', 'ARCHIVADA'],
  PUBLICADA: ['PAUSADA', 'ARCHIVADA'],
  PAUSADA: ['PUBLICADA', 'ARCHIVADA'],
  ARCHIVADA: [],
}

/** La máquina de estados, pura y probada: solo estos caminos existen. */
export function transicionPermitida(de: EstadoHome, hacia: EstadoHome): boolean {
  return TRANSICIONES[de]?.includes(hacia) ?? false
}

export interface RevisionCandidata {
  id: string
  estado: EstadoHome
  programadaPara: Date | null
  createdAt: Date
  updatedAt?: Date
}

/**
 * Revisión efectiva SIN escribir: la PUBLICADA más nueva, o la PROGRAMADA
 * vencida más nueva si supera a aquella. Programar no necesita cron: al
 * llegar la hora, la lectura la toma como vigente.
 */
export function revisionEfectiva<T extends RevisionCandidata>(
  revisiones: T[],
  ahora: Date = new Date()
): T | null {
  let mejor: T | null = null
  let fechaMejor = -Infinity
  for (const r of revisiones) {
    const vigente =
      r.estado === 'PUBLICADA' || r.estado === 'PAUSADA' ||
      (r.estado === 'PROGRAMADA' && r.programadaPara !== null && r.programadaPara <= ahora)
    if (!vigente) continue
    const fecha = (r.programadaPara ?? r.updatedAt ?? r.createdAt).getTime()
    if (fecha > fechaMejor) {
      mejor = r
      fechaMejor = fecha
    }
  }
  return mejor?.estado === 'PAUSADA' ? null : mejor
}

const CON_BLOQUES = {
  include: { bloques: { orderBy: { orden: 'asc' as const } } },
}

/** Composición visible para el cliente (solo revisiones con efecto). */
export async function getHomePublicada(companyId: string) {
  const ahora = new Date()
  const revisiones = await conEmpresa(companyId, (tx) => Promise.all([
    tx.homeRevision.findFirst({
      where: { companyId, estado: { in: ['PUBLICADA', 'PAUSADA'] } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], ...CON_BLOQUES,
    }),
    tx.homeRevision.findFirst({
      where: { companyId, estado: 'PROGRAMADA', programadaPara: { lte: ahora } },
      orderBy: [{ programadaPara: 'desc' }, { id: 'desc' }], ...CON_BLOQUES,
    }),
  ]))
  const efectiva = revisionEfectiva(
    revisiones.filter((r) => r !== null).map((r) => ({ ...r, estado: r.estado as EstadoHome })), ahora
  )
  return efectiva
}

/** Copia de trabajo del editor (borrador, programada futura o pausada). */
export async function getHomeBorrador(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.homeRevision.findFirst({
      where: { companyId, estado: { in: ['BORRADOR', 'PROGRAMADA', 'PAUSADA'] } },
      orderBy: { updatedAt: 'desc' },
      ...CON_BLOQUES,
    })
  ).catch(() => null)
}
