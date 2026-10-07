import { NextResponse } from 'next/server'
import { z } from 'zod'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'
import { flujoRequiereVehiculo } from '@/modules/onboarding/flujos'
import { isRegistroV2Enabled } from '@/lib/registroV2'
import { buscarMarcas, COLORES_FRECUENTES } from '@/modules/onboarding/marcas'
import { OPCIONES_COMO_CONOCISTE } from '@/modules/adquisicion/shared'
import { handleMobileCorsPreflight, mobileCorsHeaders } from '@/lib/auth/mobile-cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleMobileCorsPreflight(request)
}

const querySchema = z.object({ companySlug: z.string().trim().optional() })

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({ companySlug: searchParams.get('companySlug') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400, headers: mobileCorsHeaders(request) })

  if (!parsed.data.companySlug) {
    return NextResponse.json({
      companyName: 'MembeGo',
      colorPrimario: null,
      requiresVehicle: false,
      vehicleTypes: [],
      brandSuggestions: buscarMarcas(''),
      frequentColors: COLORES_FRECUENTES,
      canalOptions: OPCIONES_COMO_CONOCISTE,
    }, { headers: mobileCorsHeaders(request) })
  }

  const company = await sinEmpresa('registro móvil: buscar empresa pública por slug', (tx) =>
    tx.company.findUnique({
      where: { slug: parsed.data.companySlug ?? '' },
      select: { id: true, name: true, type: true, colorPrimario: true, capacidades: true, tipoNegocioCodigo: true },
    })
  ).catch(() => null)
  if (!company) return NextResponse.json({ error: 'Empresa no encontrada.' }, { status: 404, headers: mobileCorsHeaders(request) })

  const requiresVehicle = isRegistroV2Enabled() && flujoRequiereVehiculo(
    capacidadesDeEmpresa(company).categoriaExplicita,
  )
  const types = requiresVehicle
    ? await conEmpresa(company.id, (tx) =>
        tx.tipoVehiculo.findMany({
          where: { companyId: company.id, activo: true },
          select: { id: true, nombre: true, descripcion: true, iconoUrl: true },
          orderBy: { orden: 'asc' },
        })
      ).catch(() => [])
    : []

  return NextResponse.json({
    companyName: company.name,
    colorPrimario: company.colorPrimario,
    requiresVehicle: requiresVehicle && types.length > 0,
    vehicleTypes: types,
    brandSuggestions: buscarMarcas(''),
    frequentColors: COLORES_FRECUENTES,
    canalOptions: OPCIONES_COMO_CONOCISTE,
  }, { headers: mobileCorsHeaders(request) })
}
