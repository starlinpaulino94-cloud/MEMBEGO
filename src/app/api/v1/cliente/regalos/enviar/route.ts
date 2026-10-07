import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getRegalosConfig } from '@/modules/regalos/config'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Transferir usos (paridad con la server action `enviarTransferencia` de
 * src/modules/regalos/actions.ts). La action autentica con cookies (`getUser`)
 * y no ve el Bearer token del móvil, así que aquí se valida con
 * `getApiClientUser` y se ejecuta la misma transacción (mismo patrón que
 * /api/v1/cliente/intereses).
 *
 * Body: { origen: 'COMPRA'|'MEMBRESIA', origenId, destinatarioId?,
 *          destinatarioContacto?, usos, mensaje? }
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    const { clienteId, companyId } = user.metadata
    if (!clienteId || !companyId) {
      return NextResponse.json(
        { error: 'Tu cuenta no está vinculada a una empresa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: 'Cuerpo JSON inválido.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const origen = String(body.origen ?? '')
    const origenId = String(body.origenId ?? '').trim()
    let destinatarioId: string | null = String(body.destinatarioId ?? '').trim() || null
    const contactoRaw = String(body.destinatarioContacto ?? '').trim()
    const usos = Math.trunc(Number(body.usos ?? 1))
    const mensaje = String(body.mensaje ?? '').trim().slice(0, 200) || null

    if (!['COMPRA', 'MEMBRESIA'].includes(origen)) {
      return NextResponse.json({ error: 'Origen no válido.' }, { status: 400, headers: corsHeaders(request) })
    }
    if (!origenId) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
    }
    if (!Number.isFinite(usos) || usos < 1 || usos > 20) {
      return NextResponse.json(
        { error: 'Cantidad de usos no válida.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    // R4: receptor SIN cuenta — se identifica por correo o teléfono y reclama
    // el regalo automáticamente al registrarse.
    let destinatarioContacto: string | null = null
    if (!destinatarioId) {
      if (!contactoRaw) {
        return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
      }
      if (contactoRaw.includes('@')) {
        const correo = contactoRaw.toLowerCase()
        if (!/^\S+@\S+\.\S+$/.test(correo)) {
          return NextResponse.json(
            { error: 'Escribe un correo válido.' },
            { status: 400, headers: corsHeaders(request) }
          )
        }
        destinatarioContacto = correo
      } else {
        const digits = contactoRaw.replace(/\D/g, '')
        if (digits.length < 7) {
          return NextResponse.json(
            { error: 'Escribe un teléfono válido (al menos 7 dígitos) o un correo.' },
            { status: 400, headers: corsHeaders(request) }
          )
        }
        destinatarioContacto = digits
      }

      // Si ese contacto YA es cliente del negocio, el regalo va directo a su cuenta.
      const contacto = destinatarioContacto
      const existente = contacto.includes('@')
        ? await conEmpresa(companyId, (tx) =>
            tx.cliente.findFirst({
              where: { companyId, email: { equals: contacto, mode: 'insensitive' } },
              select: { id: true },
            })
          )
        : await conEmpresa(companyId, (tx) =>
            tx.cliente.findFirst({
              where: { companyId, telefono: { contains: contacto } },
              select: { id: true },
            })
          )
      if (existente) {
        destinatarioId = existente.id
        destinatarioContacto = null
      }
    }

    if (destinatarioId === clienteId) {
      return NextResponse.json(
        { error: 'No puedes enviarte un regalo a ti mismo.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    if (destinatarioContacto) {
      const yo = await conEmpresa(companyId, (tx) =>
        tx.cliente.findUnique({
          where: { id: clienteId },
          select: { email: true, telefono: true },
        })
      )
      const misDigits = yo?.telefono?.replace(/\D/g, '') ?? ''
      if (
        yo?.email?.toLowerCase() === destinatarioContacto ||
        (misDigits.length >= 7 && misDigits === destinatarioContacto)
      ) {
        return NextResponse.json(
          { error: 'No puedes enviarte un regalo a ti mismo.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      // Los lavados del plan exigen membresía activa del receptor: imposible
      // validarla sin cuenta.
      if (origen === 'MEMBRESIA') {
        return NextResponse.json(
          {
            error:
              'Los lavados del plan solo se transfieren a alguien con cuenta y membresía activa. Envíale usos de una promoción de tu wallet, o invítalo a registrarse primero.',
          },
          { status: 400, headers: corsHeaders(request) }
        )
      }
    }

    const config = await getRegalosConfig(companyId)
    if (!config.permitirTransferencias) {
      return NextResponse.json(
        { error: 'El negocio no tiene activadas las transferencias entre usuarios.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    // Límite mensual (anti-abuso): cuenta lo enviado este mes que no fue cancelado.
    const inicioMes = new Date()
    inicioMes.setDate(1)
    inicioMes.setHours(0, 0, 0, 0)
    const enviadasMes = await conEmpresa(companyId, (tx) =>
      tx.regalo.count({
        where: {
          remitenteId: clienteId,
          tipo: 'TRANSFERENCIA_USOS',
          createdAt: { gte: inicioMes },
          estado: { not: 'CANCELADO' },
        },
      })
    )
    if (enviadasMes >= config.maxTransferenciasMes) {
      return NextResponse.json(
        { error: `Alcanzaste el límite de ${config.maxTransferenciasMes} transferencias este mes.` },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    // Destinatario con cuenta: mismo negocio, existente.
    let destinatarioNombre: string | null = null
    if (destinatarioId) {
      const destinatario = await conEmpresa(companyId, (tx) =>
        tx.cliente.findFirst({
          where: { id: destinatarioId, companyId },
          select: { id: true, nombre: true },
        })
      )
      if (!destinatario) {
        return NextResponse.json(
          { error: 'Destinatario no encontrado en este negocio.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      destinatarioNombre = destinatario.nombre
    }

    // Origen + RESERVA atómica de los usos (guard de saldo contra doble gasto).
    let promocionId: string | null = null
    let compraOrigenId: string | null = null
    let membershipOrigenId: string | null = null
    let etiqueta = ''

    if (origen === 'COMPRA') {
      const compra = await conEmpresa(companyId, (tx) =>
        tx.productoCompra.findFirst({
          where: {
            id: origenId,
            clienteId,
            companyId,
            estado: 'ACTIVA',
            promocionId: { not: null },
            // Anti-farmeo: los beneficios gratis (campaña/ruleta/bienvenida) no
            // se transfieren; solo compras con precio real.
            precioCongelado: { gt: 0 },
          },
          select: { id: true, promocionId: true, promocion: { select: { titulo: true } } },
        })
      )
      if (!compra) {
        return NextResponse.json(
          { error: 'Ese beneficio no existe o no es transferible.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      const res = await conEmpresa(companyId, (tx) =>
        tx.productoCompra.updateMany({
          where: { id: compra.id, usosRestantes: { gte: usos } },
          data: { usosRestantes: { decrement: usos } },
        })
      )
      if (res.count === 0) {
        return NextResponse.json(
          { error: 'No tienes suficientes usos disponibles.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      compraOrigenId = compra.id
      promocionId = compra.promocionId
      etiqueta = compra.promocion?.titulo ?? 'Beneficio'
    } else {
      const membresia = await conEmpresa(companyId, (tx) =>
        tx.membership.findFirst({
          where: {
            id: origenId,
            cliente: { id: clienteId },
            estado: 'ACTIVA',
            OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
          },
          select: { id: true, plan: { select: { nombre: true } } },
        })
      )
      if (!membresia) {
        return NextResponse.json(
          { error: 'No tienes una membresía activa con lavados.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      if (!destinatarioId) {
        return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
      }
      const memDest = await conEmpresa(companyId, (tx) =>
        tx.membership.findFirst({
          where: {
            cliente: { id: destinatarioId },
            estado: 'ACTIVA',
            OR: [{ fechaVencimiento: null }, { fechaVencimiento: { gt: new Date() } }],
          },
          select: { id: true },
        })
      )
      if (!memDest) {
        return NextResponse.json(
          {
            error:
              'Tu amigo necesita una membresía activa para recibir lavados del plan. Puedes transferirle usos de una promoción de tu wallet.',
          },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      const res = await conEmpresa(companyId, (tx) =>
        tx.membership.updateMany({
          where: { id: membresia.id, lavadosRestantes: { gte: usos } },
          data: { lavadosRestantes: { decrement: usos } },
        })
      )
      if (res.count === 0) {
        return NextResponse.json(
          { error: 'No tienes suficientes lavados disponibles.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      membershipOrigenId = membresia.id
      etiqueta = `Lavados del plan ${membresia.plan.nombre}`
    }

    const regalo = await conEmpresa(companyId, (tx) =>
      tx.regalo.create({
        data: {
          companyId,
          tipo: 'TRANSFERENCIA_USOS',
          remitenteId: clienteId,
          destinatarioId,
          destinatarioContacto,
          compraOrigenId,
          membershipOrigenId,
          promocionId,
          usos,
          mensaje,
          expiraAt: new Date(Date.now() + config.vigenciaHoras * 60 * 60 * 1000),
        },
        select: { id: true },
      })
    )

    // ponytail: la action web además notifica al destinatario (crearNotificacion).
    // El BFF entrega el resultado de la transacción; la notificación in-app se
    // agrega cuando la app RN la consuma.
    if (!destinatarioId) {
      return NextResponse.json(
        {
          success: true,
          detalle: `Regalo enviado a ${destinatarioContacto}. Cuéntale que se registre en MembeGo con ese ${destinatarioContacto?.includes('@') ? 'correo' : 'teléfono'} para reclamarlo antes de que expire.`,
        },
        { headers: corsHeaders(request) }
      )
    }
    return NextResponse.json(
      {
        success: true,
        detalle: `Regalo enviado a ${destinatarioNombre?.split(/\s+/)[0] ?? 'tu amigo'}. ID ${regalo.id.slice(-6)}`,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/regalos/enviar] Error enviando regalo:', error)
    return NextResponse.json(
      { error: 'Ocurrió un error inesperado. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}