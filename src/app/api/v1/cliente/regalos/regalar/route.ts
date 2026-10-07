import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { getRegalosConfig } from '@/modules/regalos/config'
import { generarCodigo } from '@/lib/codes'
import {
  registrarTransicionCompra,
  validarVentanaAdquisicion,
  estadoLimiteCliente,
  mensajeLimitePorCliente,
} from '@/modules/promociones/compra'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Regalar una promoción o membresía (paridad con las server actions
 * `regalarPromocion` y `regalarMembresia` de src/modules/regalos/actions.ts).
 * Las actions autentican con cookies (`getUser`) y no ven el Bearer del móvil,
 * así que aquí se valida con `getApiClientUser` y se ejecuta la misma
 * transacción (mismo patrón que /api/v1/cliente/intereses).
 *
 * Body: { tipo: 'PROMOCION'|'PLAN', promocionId?, planId?, destinatarioId, mensaje? }
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

    const tipo = String(body.tipo ?? 'PROMOCION')
    const destinatarioId = String(body.destinatarioId ?? '').trim()
    const mensaje = String(body.mensaje ?? '').trim().slice(0, 200) || null
    if (!destinatarioId) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
    }
    if (destinatarioId === clienteId) {
      return NextResponse.json(
        { error: 'Para ti mismo usa la compra normal.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const config = await getRegalosConfig(companyId)
    if (!config.permitirRegalos) {
      return NextResponse.json(
        { error: 'El negocio no tiene activados los regalos entre usuarios.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    if (tipo === 'PLAN') {
      return await regalarMembresia({
        companyId,
        clienteId,
        dbUserId: user.metadata.dbUserId,
        email: user.email,
        planId: String(body.planId ?? '').trim(),
        destinatarioId,
        mensaje,
        request,
      })
    }

    return await regalarPromocion({
      companyId,
      clienteId,
      dbUserId: user.metadata.dbUserId,
      promocionId: String(body.promocionId ?? '').trim(),
      destinatarioId,
      mensaje,
      request,
    })
  } catch (error) {
    console.error('[api/v1/cliente/regalos/regalar] Error regalando:', error)
    return NextResponse.json(
      { error: 'Ocurrió un error inesperado. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/** Réplica de `regalarPromocion` (actions.ts) con auth Bearer. */
async function regalarPromocion(input: {
  companyId: string
  clienteId: string
  dbUserId: string
  promocionId: string
  destinatarioId: string
  mensaje: string | null
  request: Request
}) {
  const { companyId, clienteId, dbUserId, promocionId, destinatarioId, mensaje, request } = input
  if (!promocionId) {
    return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
  }

  const [promo, destinatario] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.promocion.findFirst({ where: { id: promocionId, companyId } }),
      tx.cliente.findFirst({
        where: { id: destinatarioId, companyId },
        select: { id: true, nombre: true },
      }),
    ])
  )
  if (!promo) {
    return NextResponse.json({ error: 'Promoción no encontrada.' }, { status: 400, headers: corsHeaders(request) })
  }
  if (!destinatario) {
    return NextResponse.json(
      { error: 'Destinatario no encontrado en este negocio.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }

  const precio = Number(promo.precio ?? 0)
  if (precio <= 0) {
    return NextResponse.json(
      { error: 'Las promociones gratuitas no se regalan: tu amigo puede reclamarla directo.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }

  const ventana = validarVentanaAdquisicion(promo)
  if (!ventana.ok) {
    return NextResponse.json({ error: ventana.mensaje }, { status: 400, headers: corsHeaders(request) })
  }

  if (promo.visibilidad === 'privada') {
    const activa = await conEmpresa(companyId, (tx) =>
      tx.membership.findFirst({
        where: { clienteId: destinatario.id, companyId, estado: 'ACTIVA' },
        select: { id: true },
      })
    )
    if (!activa) {
      return NextResponse.json(
        { error: 'Esta promoción es exclusiva para miembros: tu amigo necesita membresía activa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
  }

  // El regalo cuenta contra los límites del BENEFICIARIO (él lo recibe).
  if (promo.limitePorCliente != null) {
    const limite = await estadoLimiteCliente(destinatario.id, promo.id, promo.limitePorCliente)
    if (limite.alcanzado) {
      return NextResponse.json(
        { error: mensajeLimitePorCliente(promo.limitePorCliente) },
        { status: 400, headers: corsHeaders(request) }
      )
    }
  }

  const compra = await conEmpresa(companyId, async (tx) => {
    const creada = await tx.productoCompra.create({
      data: {
        tipo: 'PROMOCION',
        estado: 'PENDIENTE_PAGO',
        companyId,
        clienteId, // el COMPRADOR gestiona el pago
        beneficiarioClienteId: destinatario.id, // la activación la entrega al amigo
        promocionId: promo.id,
        precioCongelado: promo.precio,
        usosIncluidos: promo.usosPorCompra,
        adminNota: `Regalo P2P para ${destinatario.nombre}`,
      },
    })
    await registrarTransicionCompra(tx, {
      compraId: creada.id,
      desde: null,
      hacia: 'SOLICITADA',
      motivo: `Regalo para ${destinatario.nombre}`,
      userId: dbUserId || null,
    })
    await registrarTransicionCompra(tx, {
      compraId: creada.id,
      desde: 'SOLICITADA',
      hacia: 'PENDIENTE_PAGO',
      motivo: 'Esperando el pago del regalador',
      userId: dbUserId || null,
    })
    await tx.regalo.create({
      data: {
        companyId,
        tipo: 'REGALO_COMPRA',
        remitenteId: clienteId,
        destinatarioId: destinatario.id,
        promocionId: promo.id,
        compraDestinoId: creada.id,
        usos: promo.usosPorCompra,
        mensaje,
        // El pago puede tardar: vigencia amplia (el regalo se entrega al pagar).
        expiraAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    return creada
  })

  // ponytail: la action web notifica al destinatario; el BFF entrega el
  // resultado de la transacción (la notificación in-app se agrega si la app la usa).
  return NextResponse.json(
    {
      success: true,
      compraId: compra.id,
      detalle: `Regalo creado. Completa el pago y ${destinatario.nombre.split(/\s+/)[0]} lo recibirá al confirmarse.`,
    },
    { headers: corsHeaders(request) }
  )
}

/** Réplica de `regalarMembresia` (actions.ts) con auth Bearer. */
async function regalarMembresia(input: {
  companyId: string
  clienteId: string
  dbUserId: string
  email: string
  planId: string
  destinatarioId: string
  mensaje: string | null
  request: Request
}) {
  const { companyId, clienteId, dbUserId, email, planId, destinatarioId, mensaje, request } = input
  if (!planId) {
    return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400, headers: corsHeaders(request) })
  }

  const [plan, destinatario] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.plan.findFirst({ where: { id: planId, companyId, activo: true } }),
      tx.cliente.findFirst({
        where: { id: destinatarioId, companyId },
        select: { id: true, nombre: true },
      }),
    ])
  )
  if (!plan) {
    return NextResponse.json({ error: 'Plan no encontrado.' }, { status: 400, headers: corsHeaders(request) })
  }
  if (!destinatario) {
    return NextResponse.json(
      { error: 'Destinatario no encontrado en este negocio.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }

  // Estado actual del amigo: con ACTIVA no se regala otra; con solicitud en
  // curso tampoco (no pisamos su propio proceso de pago).
  const existente = await conEmpresa(companyId, (tx) =>
    tx.membership.findFirst({
      where: { clienteId: destinatario.id, companyId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, estado: true },
    })
  )
  if (existente?.estado === 'ACTIVA') {
    return NextResponse.json(
      { error: 'Tu amigo ya tiene una membresía activa.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }
  if (existente && ['PENDIENTE', 'PENDIENTE_PAGO'].includes(existente.estado)) {
    return NextResponse.json(
      { error: 'Tu amigo ya tiene una solicitud de membresía en proceso.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }

  // Referencia única para pagar en caja (o citarla en la transferencia).
  let referencia: string | null = null
  for (let intento = 0; intento < 5 && !referencia; intento++) {
    const candidata = `ORD-${generarCodigo(6)}`
    const ocupada = await conEmpresa(companyId, (tx) =>
      tx.membership.findUnique({
        where: { referencia: candidata },
        select: { id: true },
      })
    )
    if (!ocupada) referencia = candidata
  }
  if (!referencia) {
    return NextResponse.json(
      { error: 'No se pudo generar la referencia. Intenta de nuevo.' },
      { status: 400, headers: corsHeaders(request) }
    )
  }

  const membership = await conEmpresa(companyId, (tx) =>
    tx.membership.create({
      data: {
        clienteId: destinatario.id, // la membresía ES del amigo
        companyId,
        planId: plan.id,
        estado: 'PENDIENTE',
        referencia,
        beneficiarioClienteId: destinatario.id,
        userId: dbUserId || null,
        comprobanteNota: `Regalo: la paga ${email || 'otro cliente'} (ref. ${referencia})`,
      },
      select: { id: true },
    })
  )

  await conEmpresa(companyId, (tx) =>
    tx.regalo.create({
      data: {
        companyId,
        tipo: 'REGALO_MEMBRESIA',
        remitenteId: clienteId,
        destinatarioId: destinatario.id,
        planId: plan.id,
        membershipDestinoId: membership.id,
        mensaje,
        expiraAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
  )

  // ponytail: la action web notifica a admins y al destinatario; el BFF entrega
  // el resultado de la transacción.
  return NextResponse.json(
    {
      success: true,
      referencia,
      detalle: `Regalo creado. Paga con la referencia ${referencia} y ${destinatario.nombre.split(/\s+/)[0]} recibirá su membresía.`,
    },
    { headers: corsHeaders(request) }
  )
}