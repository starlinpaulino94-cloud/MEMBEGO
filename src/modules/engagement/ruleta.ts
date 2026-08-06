import { conEmpresa } from '@/lib/tenant'

/**
 * Engagement Engine · Fase 6B — Ruleta de premios (lecturas).
 * Los premios los configura el negocio en /admin/gamificacion. El costo por
 * giro y el saldo del cliente viven en el motor de gamificación.
 */

export interface RuletaPremioPublico {
  id: string
  nombre: string
  tipo: 'PROMOCION' | 'NADA'
  color: string | null
}

/** Premios activos de la ruleta (para dibujar la rueda del cliente). */
export async function getRuletaPremiosActivos(
  companyId: string
): Promise<RuletaPremioPublico[]> {
  try {
    const premios = await conEmpresa(companyId, (tx) =>
      tx.ruletaPremio.findMany({
        where: { companyId, activo: true },
        orderBy: [{ orden: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, nombre: true, tipo: true, color: true },
      })
    )
    return premios
  } catch (e) {
    console.error('[engagement] getRuletaPremiosActivos:', e)
    return []
  }
}

/** Premios para el panel admin (incluye probabilidad y promoción vinculada). */
export async function getRuletaPremiosAdmin(companyId: string) {
  return conEmpresa(companyId, (tx) =>
    tx.ruletaPremio.findMany({
      where: { companyId },
      orderBy: [{ activo: 'desc' }, { orden: 'asc' }, { createdAt: 'asc' }],
      include: { promocion: { select: { id: true, titulo: true } } },
    })
  )
}

/** Últimas jugadas de un cliente (historial). */
export async function getUltimasJugadas(clienteId: string, companyId: string, limit = 8) {
  try {
    return await conEmpresa(companyId, (tx) =>
      tx.ruletaJugada.findMany({
        where: { clienteId, companyId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, premioNombre: true, gano: true, createdAt: true },
      })
    )
  } catch (e) {
    console.error('[engagement] getUltimasJugadas:', e)
    return []
  }
}
