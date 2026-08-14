'use server'

import { revalidatePath } from 'next/cache'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { requireSection } from '@/lib/auth/guards'
import { resolveCompanyId } from '@/lib/auth/company-context'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { generarCodigo } from '@/lib/codes'
import { inicioPeriodo } from '@/modules/ofertas/periodo'
import { ofertaVigente } from '@/modules/ofertas/queries'
import { registrarEntregaBeneficio } from '@/modules/transacciones/entrega'
import { nuevoTokenQr, vencimientoQr } from '@/modules/qr/token'

/**
 * Ofertas VIP · acciones. La elegibilidad SIEMPRE se decide por cuenta
 * (lista de invitados), nunca por poseer el link.
 */

export interface OfertaActionState {
  error?: string
  success?: boolean
  mensaje?: string
  /** id de la oferta creada (para redirigir al detalle). */
  ofertaId?: string
  /** id de la transacción de entrega (para imprimir el comprobante). */
  transactionId?: string
}

/**
 * Notifica "tienes un regalo" (mejor esfuerzo). El enlace lleva a SU regalo
 * DENTRO de la app (regla de producto: ninguna oferta saca al cliente de su
 * sesión) — por eso se notifica por invitación, no por lista de clientes.
 */
async function notificarInvitados(
  invitaciones: { clienteId: string; invitadoId: string }[],
  titulo: string
) {
  if (invitaciones.length === 0) return
  await sinEmpresa('ofertas: notificaciones y users son globales (no tienen empresa)', async (tx) => {
    const clientes = await tx.cliente.findMany({
      where: { id: { in: invitaciones.map((i) => i.clienteId) } },
      select: { id: true, supabaseId: true },
    })
    const users = await tx.user.findMany({
      where: { supabaseId: { in: clientes.map((c) => c.supabaseId) } },
      select: { id: true, supabaseId: true },
    })
    const userPorSupabase = new Map(users.map((u) => [u.supabaseId, u.id]))
    const supabasePorCliente = new Map(clientes.map((c) => [c.id, c.supabaseId]))
    const data = invitaciones.flatMap((i) => {
      const userId = userPorSupabase.get(supabasePorCliente.get(i.clienteId) ?? '')
      if (!userId) return []
      return [
        {
          userId,
          tipo: 'PROMOCION_NUEVA' as const,
          titulo: '🎁 Tienes un regalo',
          mensaje: `"${titulo}" ya está en tus beneficios, listo para usar con tu QR.`,
          href: `/cliente/mis-promociones/regalo/${i.invitadoId}`,
        },
      ]
    })
    await tx.notificacion
      .createMany({ data })
      .catch((e) => console.error('[ofertas] notificar:', e))
  })
}

/** ADMIN · Crear oferta privada con su lista inicial de invitados. */
export async function crearOfertaPrivada(
  _prev: OfertaActionState,
  formData: FormData
): Promise<OfertaActionState> {
  try {
    const user = await requireSection('ofertas')
    if (!user) return { error: 'No autorizado.' }
    const companyId = await resolveCompanyId(user, formData)
    if (!companyId) return { error: 'Empresa requerida.' }

    const titulo = String(formData.get('titulo') ?? '').trim().slice(0, 120)
    const descripcion = String(formData.get('descripcion') ?? '').trim().slice(0, 500) || null
    const usosPorPeriodo = Math.min(500, Math.max(1, Number(formData.get('usosPorPeriodo')) || 1))
    const periodoRaw = String(formData.get('periodo') ?? 'MENSUAL')
    const periodo = ['SEMANAL', 'MENSUAL', 'TOTAL'].includes(periodoRaw)
      ? (periodoRaw as 'SEMANAL' | 'MENSUAL' | 'TOTAL')
      : 'MENSUAL'
    const vigenciaRaw = String(formData.get('vigenciaHasta') ?? '').trim()
    const vigenciaHasta = vigenciaRaw ? new Date(`${vigenciaRaw}T23:59:59`) : null
    const clienteIds = [...new Set(formData.getAll('clienteIds').map(String).filter(Boolean))]

    if (titulo.length < 3) return { error: 'Escribe el título del regalo.' }
    if (vigenciaHasta && Number.isNaN(vigenciaHasta.getTime())) {
      return { error: 'La fecha de vigencia no es válida.' }
    }
    if (clienteIds.length === 0) return { error: 'Selecciona al menos un cliente.' }

    // Todos los invitados deben ser clientes de ESTA empresa.
    const validos = await conEmpresa(companyId, (tx) =>
      tx.cliente.findMany({
        where: { id: { in: clienteIds }, companyId },
        select: { id: true },
      })
    )
    if (validos.length !== clienteIds.length) {
      return { error: 'Hay clientes seleccionados que no pertenecen a la empresa.' }
    }

    // EL REGALO NACE ENTREGADO (decisión de producto, 14-08-2026): entra
    // directo a los beneficios del invitado —reclamadaAt puesto— y con su QR
    // listo, el mismo proceso de canje que cualquier compra. Nada de mandarlo
    // a reclamar a una página.
    const ahora = new Date()
    const oferta = await conEmpresa(companyId, async (tx) => {
      const creada = await tx.ofertaPrivada.create({
        data: {
          companyId,
          codigo: generarCodigo(10),
          titulo,
          descripcion,
          usosPorPeriodo,
          periodo,
          vigenciaHasta,
          creadaPorId: user.metadata.dbUserId ?? null,
          invitados: {
            createMany: {
              data: clienteIds.map((clienteId) => ({ clienteId, reclamadaAt: ahora })),
            },
          },
        },
        select: { id: true, codigo: true, invitados: { select: { id: true, clienteId: true } } },
      })
      await tx.qrToken.createMany({
        data: creada.invitados.map((i) => ({
          clienteId: i.clienteId,
          ofertaInvitadoId: i.id,
          token: nuevoTokenQr(),
          expiraAt: vencimientoQr(),
        })),
      })
      return creada
    })

    await notificarInvitados(
      oferta.invitados.map((i) => ({ clienteId: i.clienteId, invitadoId: i.id })),
      titulo
    )

    revalidatePath('/admin/ofertas/vip')
    return {
      success: true,
      ofertaId: oferta.id,
      mensaje: 'Regalo creado: ya está en los beneficios de cada cliente, con su QR listo.',
    }
  } catch (e) {
    console.error('[ofertas] crear:', e)
    return { error: 'No se pudo crear la oferta.' }
  }
}

/** ADMIN · Pausar / reactivar / finalizar. */
export async function cambiarEstadoOferta(
  _prev: OfertaActionState,
  formData: FormData
): Promise<OfertaActionState> {
  try {
    const user = await requireSection('ofertas')
    if (!user) return { error: 'No autorizado.' }

    const ofertaId = String(formData.get('ofertaId') ?? '')
    const estado = String(formData.get('estado') ?? '')
    if (!['ACTIVA', 'PAUSADA', 'FINALIZADA'].includes(estado)) {
      return { error: 'Estado no válido.' }
    }
    const oferta = await sinEmpresa('ofertas: buscar oferta por id (empresa se valida contra el usuario)', (tx) =>
      tx.ofertaPrivada.findUnique({ where: { id: ofertaId } })
    )
    if (!oferta) return { error: 'Oferta no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && oferta.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    await conEmpresa(oferta.companyId, (tx) =>
      tx.ofertaPrivada.update({
        where: { id: oferta.id },
        data: { estado: estado as 'ACTIVA' | 'PAUSADA' | 'FINALIZADA' },
      })
    )
    revalidatePath('/admin/ofertas/vip')
    revalidatePath(`/admin/ofertas/${oferta.id}`)
    return { success: true }
  } catch (e) {
    console.error('[ofertas] estado:', e)
    return { error: 'No se pudo actualizar la oferta.' }
  }
}

/** ADMIN · Agregar o quitar un invitado. */
export async function gestionarInvitado(
  _prev: OfertaActionState,
  formData: FormData
): Promise<OfertaActionState> {
  try {
    const user = await requireSection('ofertas')
    if (!user) return { error: 'No autorizado.' }

    const ofertaId = String(formData.get('ofertaId') ?? '')
    const clienteId = String(formData.get('clienteId') ?? '')
    const accion = String(formData.get('accion') ?? '')

    const oferta = await sinEmpresa('ofertas: buscar oferta por id (empresa se valida contra el usuario)', (tx) =>
      tx.ofertaPrivada.findUnique({ where: { id: ofertaId } })
    )
    if (!oferta) return { error: 'Oferta no encontrada.' }
    if (user.metadata.role !== 'SUPERADMIN' && oferta.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }

    if (accion === 'agregar') {
      const cliente = await conEmpresa(oferta.companyId, (tx) =>
        tx.cliente.findFirst({
          where: { id: clienteId, companyId: oferta.companyId },
          select: { id: true },
        })
      )
      if (!cliente) return { error: 'Cliente no válido.' }
      // Mismo trato que al crear la oferta: el regalo nace ENTREGADO (con su
      // QR listo). Si la invitación ya existía sin reclamar, se completa.
      const invitado = await conEmpresa(oferta.companyId, async (tx) => {
        const inv = await tx.ofertaInvitado.upsert({
          where: { ofertaId_clienteId: { ofertaId, clienteId } },
          create: { ofertaId, clienteId, reclamadaAt: new Date() },
          update: {},
          select: { id: true, reclamadaAt: true },
        })
        if (!inv.reclamadaAt) {
          await tx.ofertaInvitado.update({
            where: { id: inv.id },
            data: { reclamadaAt: new Date() },
          })
        }
        const qrActivo = await tx.qrToken.findFirst({
          where: { ofertaInvitadoId: inv.id, activo: true },
          select: { id: true },
        })
        if (!qrActivo) {
          await tx.qrToken.create({
            data: {
              clienteId,
              ofertaInvitadoId: inv.id,
              token: nuevoTokenQr(),
              expiraAt: vencimientoQr(),
            },
          })
        }
        return inv
      })
      await notificarInvitados([{ clienteId, invitadoId: invitado.id }], oferta.titulo)
    } else if (accion === 'quitar') {
      // Al quitarlo pierde el acceso (el historial de usos se va con la
      // invitación: cascade). Para conservar historial, mejor FINALIZAR.
      await conEmpresa(oferta.companyId, (tx) =>
        tx.ofertaInvitado.deleteMany({ where: { ofertaId, clienteId } })
      )
    } else {
      return { error: 'Acción no válida.' }
    }

    revalidatePath(`/admin/ofertas/${ofertaId}`)
    return { success: true }
  } catch (e) {
    console.error('[ofertas] invitado:', e)
    return { error: 'No se pudo actualizar la lista.' }
  }
}

/** ADMIN · Registrar un uso (canje) contra el cupo del período. */
export async function registrarUsoOferta(
  _prev: OfertaActionState,
  formData: FormData
): Promise<OfertaActionState> {
  try {
    const user = await requireSection('ofertas')
    if (!user) return { error: 'No autorizado.' }

    const invitadoId = String(formData.get('invitadoId') ?? '')
    const invitado = await sinEmpresa('ofertas: buscar invitación por id (empresa se valida contra el usuario)', (tx) =>
      tx.ofertaInvitado.findUnique({
        where: { id: invitadoId },
        include: {
          oferta: { include: { company: { select: { zonaHoraria: true } } } },
          cliente: { select: { nombre: true } },
        },
      })
    )
    if (!invitado) return { error: 'Invitación no encontrada.' }
    const { oferta } = invitado
    if (user.metadata.role !== 'SUPERADMIN' && oferta.companyId !== user.metadata.companyId) {
      return { error: 'No autorizado.' }
    }
    if (!ofertaVigente(oferta)) return { error: 'La oferta no está vigente.' }
    if (!invitado.reclamadaAt) {
      return { error: `${invitado.cliente.nombre} aún no ha reclamado el regalo.` }
    }

    // Cupo del período dentro de una transacción (evita el doble canje).
    const resultado = await conEmpresa(oferta.companyId, async (tx) => {
      const usados = await tx.ofertaUso.count({
        where: {
          invitadoId,
          createdAt: { gte: inicioPeriodo(oferta.periodo, oferta.company.zonaHoraria) },
        },
      })
      if (usados >= oferta.usosPorPeriodo) {
        return { error: `Cupo del período agotado (${usados}/${oferta.usosPorPeriodo}).` }
      }
      await tx.ofertaUso.create({
        data: {
          invitadoId,
          companyId: oferta.companyId,
          registradoPorId: user.metadata.dbUserId ?? null,
        },
      })
      return { restantes: oferta.usosPorPeriodo - usados - 1 }
    })
    if ('error' in resultado) return { error: resultado.error }

    // Registro oficial + comprobante de entrega (Control de comprobantes ·
    // Fase 1). No bloquea el uso si la facturación falla: el regalo ya se
    // entregó (registrarEntregaBeneficio nunca lanza).
    const tx = await registrarEntregaBeneficio({
      tipo: 'BENEFIT_USE',
      companyId: oferta.companyId,
      clienteId: invitado.clienteId,
      clienteNombre: invitado.cliente.nombre,
      empleadoId: user.metadata.dbUserId ?? null,
      beneficio: oferta.titulo,
      detalle: `Regalo VIP: ${oferta.titulo}`,
      restantes: resultado.restantes,
    })

    revalidatePath(`/admin/ofertas/${oferta.id}`)
    return {
      success: true,
      mensaje: `Uso registrado a ${invitado.cliente.nombre}. Le quedan ${resultado.restantes} en el período.`,
      transactionId: tx?.id,
    }
  } catch (e) {
    console.error('[ofertas] uso:', e)
    return { error: 'No se pudo registrar el uso.' }
  }
}

/** CLIENTE · Reclamar el regalo (solo si está en la lista). */
export async function reclamarOferta(
  _prev: OfertaActionState,
  formData: FormData
): Promise<OfertaActionState> {
  try {
    const user = await getUser()
    if (!user || user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId) {
      return { error: 'Inicia sesión con tu cuenta de cliente.' }
    }
    // A const: los closures de conEmpresa pierden el estrechamiento del guard.
    const clienteId = user.metadata.clienteId
    if (!(await formSubmitLimiter(`oferta:${clienteId}`))) {
      return { error: 'Demasiados intentos. Espera un momento.' }
    }

    const codigo = String(formData.get('codigo') ?? '').trim()
    const oferta = await sinEmpresa('ofertas: buscar oferta por código único global', (tx) =>
      tx.ofertaPrivada.findUnique({ where: { codigo } })
    )
    if (!oferta) return { error: 'Esta oferta ya no existe.' }
    if (!ofertaVigente(oferta)) return { error: 'Esta oferta ya no está disponible.' }

    // La barrera real: SOLO invitados. Poseer el link no da acceso.
    const actualizado = await conEmpresa(oferta.companyId, (tx) =>
      tx.ofertaInvitado.updateMany({
        where: {
          ofertaId: oferta.id,
          clienteId,
          reclamadaAt: null,
        },
        data: { reclamadaAt: new Date() },
      })
    )
    if (actualizado.count === 0) {
      const existe = await conEmpresa(oferta.companyId, (tx) =>
        tx.ofertaInvitado.findUnique({
          where: {
            ofertaId_clienteId: { ofertaId: oferta.id, clienteId },
          },
          select: { reclamadaAt: true },
        })
      )
      if (existe?.reclamadaAt) return { success: true, mensaje: 'Ya habías reclamado este regalo.' }
      return { error: 'Tu cuenta no aplica para esta promoción.' }
    }

    revalidatePath(`/oferta/${codigo}`)
    revalidatePath('/cliente/mis-promociones')
    return { success: true, mensaje: '¡Regalo reclamado! Preséntalo en el local para usarlo.' }
  } catch (e) {
    console.error('[ofertas] reclamar:', e)
    return { error: 'No se pudo reclamar. Intenta de nuevo.' }
  }
}
