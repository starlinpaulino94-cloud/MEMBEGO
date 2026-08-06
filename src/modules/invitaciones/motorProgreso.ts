import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { otorgarBeneficioCampana } from '@/modules/invitaciones/beneficios'
import { crearNotificacion } from '@/modules/notificaciones/service'

/**
 * Motor de Progreso del Growth Engine (campañas "Invita y Gana").
 *
 * Cuando un referido completa el registro: incrementa `registrosCompletados`
 * del invitante, entrega el regalo de bienvenida al invitado, y al alcanzar
 * la meta entrega AUTOMÁTICAMENTE el premio del invitante (beneficio digital
 * con QR en su wallet) — sin ninguna intervención manual, respetando el
 * stock de premios de la campaña (`maxPremios`).
 *
 * No lanza: un fallo del motor nunca rompe el registro del referido.
 */
export async function incrementarProgresoCampana(
  campanaId: string,
  referenteClienteId: string,
  companyId: string,
  referidoClienteId?: string
): Promise<void> {
  try {
    const campana = await conEmpresa(companyId, (tx) =>
      tx.campanaInvitacion.findUnique({
        where: { id: campanaId },
        select: { id: true, nombre: true, metaRegistros: true, estado: true },
      })
    )
    if (!campana || campana.estado !== 'ACTIVA') return

    const progreso = await conEmpresa(companyId, (tx) =>
      tx.invitacionProgreso.upsert({
        where: { campanaId_clienteId: { campanaId, clienteId: referenteClienteId } },
        update: { registrosCompletados: { increment: 1 } },
        create: {
          campanaId,
          clienteId: referenteClienteId,
          companyId,
          registrosCompletados: 1,
        },
      })
    )

    await conEmpresa(companyId, (tx) =>
      tx.invitacionEvento.create({
        data: {
          campanaId,
          clienteId: referenteClienteId,
          companyId,
          tipo: 'REGISTRO_COMPLETADO',
          ...(referidoClienteId ? { meta: { referidoClienteId } } : {}),
        },
      })
    )

    // Regalo de bienvenida prometido en la landing: se entrega al INVITADO
    // en cuanto su registro queda atribuido a la campaña.
    if (referidoClienteId) {
      await otorgarBeneficioCampana({
        campanaId,
        clienteId: referidoClienteId,
        rol: 'INVITADO',
      })
    }

    // Meta cumplida → premio automático del INVITANTE.
    if (!progreso.metaAlcanzada && progreso.registrosCompletados >= campana.metaRegistros) {
      await entregarPremioMeta(campanaId, referenteClienteId, companyId, campana.nombre)
    }
  } catch (e) {
    console.error('[invitaciones] incrementarProgresoCampana error:', e)
  }
}

/**
 * Entrega automática del premio al alcanzar la meta (spec: "no debe existir
 * intervención manual"). El guard atómico sobre `maxPremios` en el UPDATE
 * evita sobre-otorgar cuando varios invitantes alcanzan la meta a la vez;
 * `metaAlcanzada: false` en el WHERE hace la operación idempotente.
 */
async function entregarPremioMeta(
  campanaId: string,
  clienteId: string,
  companyId: string,
  campanaNombre: string
): Promise<void> {
  const conStock = await conEmpresa(companyId, async (tx) => {
    const campana = await tx.campanaInvitacion.findUnique({
      where: { id: campanaId },
      select: { maxPremios: true, premiosOtorgados: true },
    })
    if (!campana) return false

    const agotado =
      campana.maxPremios !== null && campana.premiosOtorgados >= campana.maxPremios

    const upd = await tx.invitacionProgreso.updateMany({
      where: { campanaId, clienteId, metaAlcanzada: false },
      data: { metaAlcanzada: true, premioReclamado: !agotado },
    })
    if (upd.count === 0) return false // otra ejecución ya lo procesó

    if (agotado) return false
    await tx.campanaInvitacion.update({
      where: { id: campanaId },
      data: { premiosOtorgados: { increment: 1 } },
    })
    return true
  })

  if (!conStock) return

  await conEmpresa(companyId, (tx) =>
    tx.invitacionEvento.create({
      data: {
        campanaId,
        clienteId,
        companyId,
        tipo: 'PREMIO_RECLAMADO',
        meta: { automatico: true },
      },
    })
  )

  // Beneficio digital real (QR + wallet) + su notificación de entrega.
  await otorgarBeneficioCampana({ campanaId, clienteId, rol: 'INVITANTE' })

  // Celebración de la meta (además de la notificación del beneficio).
  await notificarMetaAlcanzada(clienteId, campanaNombre)
}

async function notificarMetaAlcanzada(clienteId: string, campanaNombre: string) {
  try {
    const cliente = await sinEmpresa('invitaciones: buscar cliente por id (empresa desconocida)', (tx) =>
      tx.cliente.findUnique({
        where: { id: clienteId },
        select: { supabaseId: true },
      })
    )
    if (!cliente) return
    const user = await sinEmpresa('invitaciones: buscar user por supabaseId (users son globales, no por empresa)', (tx) =>
      tx.user.findUnique({
        where: { supabaseId: cliente.supabaseId },
        select: { id: true },
      })
    )
    if (!user) return
    await crearNotificacion({
      userId: user.id,
      tipo: 'RECOMPENSA_REFERIDO',
      titulo: '🏆 ¡Meta alcanzada!',
      mensaje: `Completaste la meta de "${campanaNombre}". Tu premio ya fue entregado automáticamente.`,
      href: '/cliente/invita-y-gana',
    })
  } catch (e) {
    console.error('[invitaciones] notificarMetaAlcanzada error:', e)
  }
}
