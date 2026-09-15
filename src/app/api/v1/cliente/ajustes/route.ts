import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getClientePerfil } from '@/modules/cliente/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { ensureCodigoCorto } from '@/lib/referidos'
import { propagarDatosPersonales } from '@/modules/cliente/afiliacion'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request)
}

export async function GET(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    if (!user.metadata.clienteId) {
      return NextResponse.json(
        { cliente: null, prefs: null, ubicacion: null, idMembego: null },
        { headers: corsHeaders(request) }
      )
    }

    const cliente = await getClientePerfil(user.metadata.clienteId)
    if (!cliente) {
      return NextResponse.json(
        { cliente: null, prefs: null, ubicacion: null, idMembego: null },
        { headers: corsHeaders(request) }
      )
    }

    const [prefs, ubicacion, idMembego] = await Promise.all([
      getRegionalPrefs(user.metadata.companyId),
      user.metadata.dbUserId
        ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
        : Promise.resolve(null),
      ensureCodigoCorto(cliente.id).catch(() => null),
    ])

    return NextResponse.json(
      {
        cliente,
        prefs,
        ubicacion: { zona: ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null },
        idMembego,
      },
      { headers: corsHeaders(request) }
    )
  } catch (error) {
    console.error('[api/v1/cliente/ajustes] Error cargando ajustes:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar ajustes' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * Guardar el perfil desde la app RN.
 *
 * Reutiliza `propagarDatosPersonales`, que es justo la parte que la server
 * action `actualizarPerfil` delega para poder ejecutarse fuera de una sesión
 * de cookie (ver el comentario en modules/cliente/afiliacion.ts). Por eso este
 * POST SÍ funciona con Bearer, a diferencia de las acciones 'use server'.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    if (user.metadata.role !== 'CLIENTE' || !user.metadata.clienteId || !user.metadata.companyId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const nombre = String(body.nombre ?? '').trim()
    const telefono = String(body.telefono ?? '').trim() || null
    const avatarUrl = String(body.avatarUrl ?? '').trim() || null
    const fechaRaw = String(body.fechaNacimiento ?? '').trim()
    const ciudad = String(body.ciudad ?? '').trim() || null
    const genero = String(body.genero ?? '').trim() || null
    // Misma semántica que los checkbox del formulario web: ausente = false.
    const notifPromos = Boolean(body.notifPromos)
    const notifRecordatorios = Boolean(body.notifRecordatorios)

    if (!nombre) {
      return NextResponse.json(
        { error: 'El nombre no puede estar vacío.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    let fechaNacimiento: Date | null = null
    if (fechaRaw) {
      const d = new Date(fechaRaw)
      if (Number.isNaN(d.getTime()) || d > new Date()) {
        return NextResponse.json(
          { error: 'Fecha de nacimiento inválida.' },
          { status: 400, headers: corsHeaders(request) }
        )
      }
      fechaNacimiento = d
    }

    const escritas = await propagarDatosPersonales(user.supabaseId, {
      nombre,
      telefono,
      fechaNacimiento,
      ciudad,
      genero,
      notifPromos,
      notifRecordatorios,
      ...(avatarUrl !== null ? { avatarUrl } : {}),
    })
    if (escritas === 0) {
      return NextResponse.json(
        { error: 'No se pudo guardar. Intenta de nuevo.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    return NextResponse.json({ success: true }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/ajustes] Error guardando ajustes:', error)
    return NextResponse.json(
      { error: 'Ocurrió un error. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
