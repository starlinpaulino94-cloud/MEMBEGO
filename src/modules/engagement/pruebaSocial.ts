import { conEmpresa } from '@/lib/tenant'

/**
 * Engagement Engine · Fase 4 — Urgencia y prueba social (SOLO datos reales).
 *
 * Arma la "prueba social" del Home a partir de hechos reales de la empresa:
 * miembros totales, registros de la última semana, beneficios efectivamente
 * reclamados y la actividad reciente ("Juan R. · hace 2 min"). Nunca inventa
 * números: si algo falla, devuelve null y el Home simplemente no lo muestra.
 */

export interface ActividadReciente {
  /** Nombre + inicial del apellido (p. ej. "Juan R."). Nunca el nombre completo. */
  nombre: string
  /** Etiqueta relativa ya formateada ("hace 2 min"). */
  hace: string
  tipo: 'registro' | 'beneficio'
}

export interface PruebaSocial {
  totalMiembros: number
  registrosSemana: number
  beneficiosReclamados: number
  recientes: ActividadReciente[]
}

/** "Juan Rodríguez" → "Juan R." · "Juan" → "Juan" (privacidad: no nombre completo). */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const first = partes[0] ?? 'Alguien'
  const ap = partes[1]?.[0]
  return ap ? `${first} ${ap.toUpperCase()}.` : first
}

/** Etiqueta relativa en español a partir de una fecha pasada. */
function hace(date: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (s < 60) return 'hace un momento'
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  const sem = Math.floor(d / 7)
  return sem <= 1 ? 'hace 1 semana' : `hace ${sem} semanas`
}

export async function getPruebaSocial(companyId: string): Promise<PruebaSocial | null> {
  try {
    const hace7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [totalMiembros, registrosSemana, beneficiosReclamados, ultimasCompras, ultimosClientes] =
      await conEmpresa(companyId, (tx) =>
        Promise.all([
          tx.cliente.count({ where: { companyId } }),
          tx.cliente.count({ where: { companyId, createdAt: { gte: hace7 } } }),
          tx.productoCompra.count({
            where: { companyId, estado: { in: ['ACTIVA', 'CONSUMIDA'] } },
          }),
          tx.productoCompra.findMany({
            where: { companyId, estado: { in: ['ACTIVA', 'CONSUMIDA'] } },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { createdAt: true, cliente: { select: { nombre: true } } },
          }),
          tx.cliente.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { createdAt: true, nombre: true },
          }),
        ])
      )

    const recientes = [
      ...ultimasCompras.map((c) => ({
        nombre: iniciales(c.cliente.nombre),
        hace: hace(c.createdAt),
        tipo: 'beneficio' as const,
        t: c.createdAt.getTime(),
      })),
      ...ultimosClientes.map((c) => ({
        nombre: iniciales(c.nombre),
        hace: hace(c.createdAt),
        tipo: 'registro' as const,
        t: c.createdAt.getTime(),
      })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, 6)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ t, ...r }) => r)

    return { totalMiembros, registrosSemana, beneficiosReclamados, recientes }
  } catch (e) {
    console.error('[engagement] getPruebaSocial:', e)
    return null
  }
}
