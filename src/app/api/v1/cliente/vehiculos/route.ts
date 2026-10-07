import { NextResponse } from 'next/server'
import { getApiClientUser, corsHeaders, handleCorsPreflight } from '@/lib/auth/api-guard'
import { getVehiculosCliente } from '@/modules/cliente/queries'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { formSubmitLimiter } from '@/lib/rate-limit'
import { validarVehiculoNuevo } from '@/modules/registro/vehiculo-nuevo'
import { clasificarErrorPrisma } from '@/lib/prisma-errors'
import { capturarErrorInesperado } from '@/lib/sentry'

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
    const vehiculos = user.metadata.clienteId
      ? await getVehiculosCliente(user.supabaseId)
      : []
    return NextResponse.json({ vehiculos }, { headers: corsHeaders(request) })
  } catch (error) {
    console.error('[api/v1/cliente/vehiculos] Error cargando vehículos:', error)
    return NextResponse.json(
      { error: 'Error interno al cargar vehículos' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}

/**
 * Crear un vehículo desde la app RN.
 *
 * Espejo de `agregarVehiculoCliente` (modules/cliente/vehiculosActions.ts).
 * No se puede llamar a esa server action aquí: usa `getUser()`, que lee la
 * cookie de sesión, y la app RN autentica por Bearer. Mantener ambas en
 * sincronía (validación, placa global, idempotencia, primer vehículo). Si esa
 * acción extrae su cuerpo a una función no-'use server' (como ya hizo
 * `propagarDatosPersonales` en afiliacion.ts), esta ruta debe delegar en ella.
 */
export async function POST(request: Request) {
  const user = await getApiClientUser(request)
  if (!user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
  }

  try {
    if (user.metadata.role !== 'CLIENTE') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: corsHeaders(request) })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const companyId = typeof body.companyId === 'string'
      ? body.companyId.trim()
      : user.metadata.companyId
    if (!companyId) {
      return NextResponse.json(
        { error: 'Selecciona el negocio donde quieres registrar el vehículo.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const cliente = await sinEmpresa(
      'cliente: validar mi ficha antes de registrar un vehículo por negocio',
      (tx) =>
        tx.cliente.findUnique({
          where: { supabaseId_companyId: { supabaseId: user.supabaseId, companyId } },
          select: { id: true },
        })
    )
    if (!cliente) {
      return NextResponse.json(
        { error: 'No tienes una ficha de cliente en el negocio seleccionado.' },
        { status: 403, headers: corsHeaders(request) }
      )
    }
    const clienteId = cliente.id

    if (!(await formSubmitLimiter(clienteId))) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
        { status: 429, headers: corsHeaders(request) }
      )
    }

    const r = validarVehiculoNuevo({
      tipoVehiculoId: String(body.tipoVehiculoId ?? ''),
      marca: String(body.marca ?? ''),
      modelo: String(body.modelo ?? ''),
      anioRaw: String(body.anio ?? ''),
      color: String(body.color ?? ''),
      placa: String(body.placa ?? ''),
      pais: String(body.pais ?? ''),
    })
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: 400, headers: corsHeaders(request) })
    }
    const vehiculo = r.vehiculo

    // La placa es identidad global: si ya está en una cuenta de OTRA persona,
    // no se duplica. Los vehículos del propio usuario no cuentan.
    const placaAjena = await sinEmpresa(
      'cliente: detectar placa duplicada (la placa es identidad global del vehículo)',
      (tx) =>
        tx.vehiculo.findFirst({
          where: {
            pais: vehiculo.pais,
            placaNormalizada: vehiculo.placaNormalizada,
            cliente: { supabaseId: { not: user.supabaseId } },
          },
          select: { id: true },
        })
    ).catch(() => null)
    if (placaAjena) {
      return NextResponse.json(
        {
          error:
            'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
        },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    const creado = await conEmpresa(companyId, async (tx) => {
      const tipoValido = await tx.tipoVehiculo.findFirst({
        where: { id: vehiculo.tipoVehiculoId, companyId, activo: true },
        select: { id: true },
      })
      if (!tipoValido) return null

      // Mismo carro dos veces por el MISMO cliente → se reutiliza en silencio.
      const propio = await tx.vehiculo.findFirst({
        where: { clienteId, pais: vehiculo.pais, placaNormalizada: vehiculo.placaNormalizada },
        select: { id: true },
      })
      if (propio) return propio

      const esPrimero = (await tx.vehiculo.count({ where: { clienteId } })) === 0
      return tx.vehiculo.create({
        data: { clienteId, ...vehiculo, esPrincipal: esPrimero },
        select: { id: true },
      })
    })
    if (!creado) {
      return NextResponse.json(
        { error: 'La categoría de vehículo elegida ya no está disponible. Vuelve a elegirla.' },
        { status: 400, headers: corsHeaders(request) }
      )
    }

    return NextResponse.json(
      { success: true, vehiculoId: creado.id },
      { headers: corsHeaders(request) }
    )
  } catch (e) {
    if (clasificarErrorPrisma(e).codigo === 'P2002') {
      return NextResponse.json(
        {
          error:
            'Esta placa ya está registrada en otra cuenta. Si el vehículo es tuyo, escríbenos desde Ayuda para reclamarlo.',
        },
        { status: 400, headers: corsHeaders(request) }
      )
    }
    capturarErrorInesperado('api:cliente:agregarVehiculo', e)
    return NextResponse.json(
      { error: 'No se pudo guardar el vehículo. Intenta de nuevo.' },
      { status: 500, headers: corsHeaders(request) }
    )
  }
}
