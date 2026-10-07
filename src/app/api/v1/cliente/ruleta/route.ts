import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { conEmpresa } from '@/lib/tenant'
import { COSTO_RULETA } from '@/lib/gamificacion'
import { getGamificacion } from '@/modules/engagement/gamificacion'
import { getRuletaPremiosActivos, getUltimasJugadas } from '@/modules/engagement/ruleta'
import { getEngagementConfig } from '@/modules/engagement/config'
import { normalizeEngagementConfig } from '@/lib/engagementConfig'
import { otorgarBeneficioDirecto } from '@/modules/growth/rewards'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

/**
 * BFF · Ruleta de premios (paridad con /cliente/ruleta). GET devuelve el estado
 * (saldo, premios, últimos giros, gamificación y color del motor); POST gira.
 */
export async function GET(request: Request) {
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

    const [game, premios, jugadas, engagement] = await Promise.all([
      getGamificacion(clienteId, companyId),
      getRuletaPremiosActivos(companyId),
      getUltimasJugadas(clienteId, companyId, 8),
      getEngagementConfig(companyId)
        .then((cfg) => normalizeEngagementConfig(cfg, null))
        .catch(() => normalizeEngagementConfig(null, null)),
    ])

    return NextResponse.json(
      {
        saldo: game?.saldo ?? 0,
        costo: COSTO_RULETA,
        premios,
        jugadas,
        gamificacion: game,
        color: engagement.color,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/ruleta] Error cargando ruleta:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar la ruleta' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * BFF · Girar la ruleta (paridad con la server action `girarRuleta` de
 * src/modules/gamificacion/ruletaActions.ts). La action autentica con cookies
 * (`getUser`) y no ve el Bearer del móvil, así que aquí se valida con
 * `getApiClientUser` y se ejecuta la misma transacción. La selección del premio
 * es ponderada en el SERVIDOR: el cliente nunca decide el premio.
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
        { ok: false, error: 'Tu cuenta no está vinculada a una empresa.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const game = await getGamificacion(clienteId, companyId)
    if (!game) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo calcular tu saldo.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    if (game.saldo < COSTO_RULETA) {
      return NextResponse.json(
        { ok: false, error: `Necesitas ${COSTO_RULETA} puntos para girar.` },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const premios = await conEmpresa(companyId, (tx) =>
      tx.ruletaPremio.findMany({
        where: { companyId, activo: true },
        select: { id: true, nombre: true, tipo: true, promocionId: true, probabilidad: true },
      })
    )
    if (premios.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No hay premios disponibles.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    // Selección ponderada en el SERVIDOR: el cliente nunca decide el premio.
    const total = premios.reduce((s, p) => s + Math.max(0, p.probabilidad), 0)
    if (total <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Configuración de premios inválida.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    let r = Math.random() * total
    let elegido = premios[premios.length - 1]
    for (const p of premios) {
      r -= Math.max(0, p.probabilidad)
      if (r <= 0) {
        elegido = p
        break
      }
    }

    // Entrega del premio (si aplica) para guardar el compraId en la jugada.
    let productoCompraId: string | null = null
    let gano = false
    if (elegido.tipo === 'PROMOCION' && elegido.promocionId) {
      productoCompraId = await otorgarBeneficioDirecto({
        companyId,
        clienteId,
        promocionId: elegido.promocionId,
        motivo: `Ruleta: ${elegido.nombre}`,
      })
      gano = productoCompraId !== null
    }

    try {
      await conEmpresa(companyId, (tx) =>
        tx.ruletaJugada.create({
          data: {
            companyId,
            clienteId,
            costoPuntos: COSTO_RULETA,
            premioId: elegido.id,
            premioNombre: elegido.nombre,
            gano,
            productoCompraId,
          },
        })
      )
    } catch (e) {
      console.error('[api/v1/cliente/ruleta] girar:', e)
      return NextResponse.json(
        { ok: false, error: 'No se pudo completar el giro.' },
        { status: 500, headers: corsHeaders(request) }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        gano,
        premioId: elegido.id,
        premioNombre: elegido.nombre,
        enWallet: gano,
        saldoRestante: game.saldo - COSTO_RULETA,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/ruleta] Error girando:', error)
    return NextResponse.json(
      { ok: false, error: 'No se pudo completar el giro.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}