import { conEmpresa } from '@/lib/tenant'
import { membresiaVigente } from '@/modules/membresia/vigencia'
import {
  calcularPuntos,
  nivelPara,
  LOGROS,
  type GamificacionStats,
  type LogroDef,
} from '@/lib/gamificacion'

/**
 * Engagement Engine · Fase 6A — Gamificación (puntos + niveles + logros).
 *
 * Los puntos se DERIVAN de hechos reales del cliente (beneficios reclamados y
 * usados, referidos completados, membresías activas). No se inventan ni se
 * guardan: si algo falla, devuelve null y el Home no muestra la tarjeta.
 */

export interface LogroData {
  id: string
  nombre: string
  desc: string
  icono: LogroDef['icono']
  objetivo: number
  valor: number
  desbloqueado: boolean
}

export interface GamificacionData {
  /** Puntos GANADOS (derivados; determinan el nivel). */
  puntos: number
  /** Puntos gastados en la ruleta (libro mayor). */
  gastados: number
  /** Saldo disponible para gastar = ganados − gastados. */
  saldo: number
  /** ¿La empresa tiene premios de ruleta activos? (para mostrar el acceso). */
  hayRuleta: boolean
  nivel: { nivel: number; nombre: string; color: string }
  siguiente: { nombre: string; min: number } | null
  progreso: number
  faltan: number
  logros: LogroData[]
  stats: GamificacionStats
}

export async function getGamificacion(
  clienteId: string,
  companyId: string
): Promise<GamificacionData | null> {
  try {
    const [
      beneficiosReclamados,
      beneficiosUsados,
      referidosCompletados,
      membresiasActivas,
      gastoAgg,
      premiosActivos,
    ] = await conEmpresa(companyId, (tx) =>
      Promise.all([
        tx.productoCompra.count({
          where: { clienteId, companyId, estado: { in: ['ACTIVA', 'CONSUMIDA'] } },
        }),
        tx.productoCompra.count({
          where: { clienteId, companyId, estado: 'CONSUMIDA' },
        }),
        tx.referido.count({
          where: { referenteClienteId: clienteId, companyId, estado: 'COMPLETADO' },
        }),
        tx.membership.count({ where: { clienteId, companyId, ...membresiaVigente() } }),
        tx.ruletaJugada.aggregate({
          where: { clienteId, companyId },
          _sum: { costoPuntos: true },
        }),
        tx.ruletaPremio.count({ where: { companyId, activo: true } }),
      ])
    )

    const stats: GamificacionStats = {
      beneficiosReclamados,
      beneficiosUsados,
      referidosCompletados,
      membresiasActivas,
    }

    const puntos = calcularPuntos(stats)
    const gastados = gastoAgg._sum.costoPuntos ?? 0
    const saldo = Math.max(0, puntos - gastados)
    const { actual, siguiente, progreso, faltan } = nivelPara(puntos)

    const logros: LogroData[] = LOGROS.map((l) => {
      const real = l.valor(stats)
      return {
        id: l.id,
        nombre: l.nombre,
        desc: l.desc,
        icono: l.icono,
        objetivo: l.objetivo,
        valor: Math.min(l.objetivo, real),
        desbloqueado: real >= l.objetivo,
      }
    })

    return {
      puntos,
      gastados,
      saldo,
      hayRuleta: premiosActivos > 0,
      nivel: { nivel: actual.nivel, nombre: actual.nombre, color: actual.color },
      siguiente: siguiente ? { nombre: siguiente.nombre, min: siguiente.min } : null,
      progreso,
      faltan,
      logros,
      stats,
    }
  } catch (e) {
    console.error('[engagement] getGamificacion:', e)
    return null
  }
}
