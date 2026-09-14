import { cookies } from 'next/headers'
import { differenceInDays } from 'date-fns'
import { getBeneficioDisponible, getClienteAllMemberships } from '@/modules/cliente/queries'
import { primerPaso, type PrimerPaso } from '@/modules/cliente/primerPaso'
import {
  getNovedadesInicio,
  getOnboardingCliente,
  type NovedadInicio,
} from '@/modules/social/queries'
import { getMomentosVivos, type MomentosVivos } from '@/modules/engagement/momentos'
import { getCampanasVivas, type CampanaViva } from '@/modules/engagement/campanas'
import { getGamificacion, type GamificacionData } from '@/modules/engagement/gamificacion'
import { getEngagementConfig } from '@/modules/engagement/config'
import { normalizeEngagementConfig, type EngagementConfig } from '@/lib/engagementConfig'
import { esMarcaUnica } from '@/modules/marketplace/marcaUnica'
import { elegirExperiencias, type ExperienciaHero } from '@/modules/experience/engine'
import type { WalletStackItem } from '@/components/wallet/WalletStack'
import { membresiaEstadoUi } from '@/lib/estados'
import type { SessionUser } from '@/types'

/**
 * LA FRANJA PERSONAL DEL INICIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO SON BLOQUES DE LA COMPOSICIÓN
 *
 * El Inicio tiene dos mitades con dueños distintos. La comercial la compone y
 * publica la empresa (`modules/home`): qué destaca, en qué orden, para quién.
 * Esta otra sale del estado de ESTA persona —su wallet, su onboarding, sus
 * puntos— y no es configurable.
 *
 * Meterlas en el modelo de composición habría dejado que un administrador le
 * apagara la wallet a sus clientes desde un panel. Eso no es personalizar: es
 * perder una función. Así que el orden de esta franja lo decide el contexto,
 * no un interruptor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA SOLA OLA
 *
 * Esto corre en cada visita al Inicio. Ninguna consulta depende de otra —solo
 * del usuario ya resuelto—, así que van en paralelo, y cada una cae a su
 * propio valor vacío: una novedad que no carga no puede tumbar la wallet.
 */

export interface PanelPersonal {
  /**
   * La acción elegida por el motor de experiencias, como POPUP (máx. 1/día).
   * El héroe que la pintaba arriba del Inicio se retiró por decisión del
   * usuario (2026-09-10): rompía el diseño retail. El aviso discreto basta —
   * los estados también viven donde se actúa (wallet, planes, detalle).
   */
  readonly popup: ExperienciaHero | null
  readonly wallet: readonly WalletStackItem[]
  /** La lectura de membresías falló: se dice, no se finge una wallet vacía. */
  readonly walletError: boolean
  readonly novedades: readonly NovedadInicio[]
  readonly onboarding: Awaited<ReturnType<typeof getOnboardingCliente>> | null
  readonly gamificacion: GamificacionData | null
  readonly engagement: EngagementConfig
  readonly primerPaso: PrimerPaso
  readonly nombre: string | null
}

export async function cargarPanelPersonal(user: SessionUser): Promise<PanelPersonal> {
  const cookieStore = await cookies()
  const onboardingVisto = cookieStore.has('membego_onboarding_seen')
  const { clienteId, companyId, dbUserId } = user.metadata

  const [
    beneficio,
    membresias,
    momentos,
    campanas,
    gamificacion,
    engagement,
    novedades,
    onboarding,
    marcaUnica,
  ] = await Promise.all([
    // La PERSONA, no la ficha activa: un beneficio reclamado en otro negocio
    // también está listo para usar, y el Inicio es donde más se nota que falte.
    getBeneficioDisponible(user.supabaseId),
    getClienteAllMemberships(user.supabaseId, clienteId).catch((error) => {
      console.error('[inicio] membresías:', error instanceof Error ? error.message : String(error))
      return null
    }),
    clienteId && companyId
      ? getMomentosVivos(clienteId, companyId).catch(
          () => ({ nombre: null, momentos: [] }) as MomentosVivos
        )
      : Promise.resolve({ nombre: null, momentos: [] } as MomentosVivos),
    companyId ? getCampanasVivas(companyId).catch(() => []) : Promise.resolve([] as CampanaViva[]),
    clienteId && companyId
      ? getGamificacion(clienteId, companyId).catch(() => null)
      : Promise.resolve(null),
    companyId
      ? getEngagementConfig(companyId).catch(() => normalizeEngagementConfig(null, null))
      : Promise.resolve<EngagementConfig>(normalizeEngagementConfig(null, null)),
    dbUserId ? getNovedadesInicio(dbUserId).catch(() => []) : Promise.resolve([]),
    dbUserId && !onboardingVisto
      ? getOnboardingCliente(dbUserId, user.supabaseId).catch(() => null)
      : Promise.resolve(null),
    esMarcaUnica().catch(() => true),
  ])

  const walletError = membresias === null
  const lista = membresias ?? []
  const ahora = new Date()

  const pendiente = lista.find((m) => ['PENDIENTE', 'RECHAZADA'].includes(m.estado))
  const experiencias = walletError
    ? []
    : elegirExperiencias({
        momentos: momentos.momentos,
        beneficio,
        pagoPendiente: pendiente
          ? { membresiaId: pendiente.id, planNombre: pendiente.plan.nombre }
          : null,
        campanas: engagement.campanas ? campanas : [],
      })

  const wallet: WalletStackItem[] = lista.map((m) => {
    const vence = m.fechaVencimiento ? new Date(m.fechaVencimiento) : null
    const activa = m.estado === 'ACTIVA' && (!vence || vence > ahora)
    const vencida = m.estado === 'VENCIDA' || (vence !== null && vence <= ahora)
    let expiryText: string | null = null
    if (vence) {
      const dias = differenceInDays(vence, ahora)
      const plural = (n: number) => (n !== 1 ? 's' : '')
      expiryText =
        dias > 0
          ? `Vence en ${dias} día${plural(dias)}`
          : dias === 0
            ? 'Vence hoy'
            : `Venció hace ${Math.abs(dias)} día${plural(Math.abs(dias))}`
    }
    return {
      id: m.id,
      card: {
        company: {
          name: m.company.name,
          logoUrl: m.company.logoUrl,
          colorPrimario: m.company.colorPrimario,
        },
        planNombre: m.plan.nombre,
        estadoLabel: membresiaEstadoUi(m.estado).labelCliente,
        tone: activa ? ('active' as const) : vencida ? ('expired' as const) : ('pending' as const),
        expiryText,
        esIlimitado: m.plan.esIlimitado,
        usosRestantes: m.lavadosRestantes,
        usosTotales: m.plan.lavadosIncluidos ?? null,
      },
      qrToken: m.qrToken?.token ?? null,
      isActive: activa,
    }
  })


  return {
    popup: experiencias[0] ?? null,
    wallet,
    walletError,
    novedades,
    onboarding,
    gamificacion,
    engagement,
    primerPaso: primerPaso({ companyId, marcaUnica }),
    nombre: momentos.nombre?.trim().split(' ')[0] ?? null,
  }
}
