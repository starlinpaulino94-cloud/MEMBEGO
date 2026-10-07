import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registrarCliente, registrarCuentaGeneral } from '@/modules/registro/actions'
import { handleMobileCorsPreflight, mobileCorsHeaders } from '@/lib/auth/mobile-cors'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  return handleMobileCorsPreflight(request)
}

const registroMovilSchema = z.object({
  nombre: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(6),
  telefono: z.string().trim().min(7),
  terminos: z.literal(true),
  marketingConsent: z.boolean().optional().default(false),
  companySlug: z.string().trim().optional().default(''),
  refCode: z.string().trim().optional().default(''),
  campanaId: z.string().trim().optional().default(''),
  glCode: z.string().trim().optional().default(''),
  enlaceSlug: z.string().trim().optional().default(''),
  vendedorCode: z.string().trim().optional().default(''),
  canalDeclarado: z.string().trim().optional().default(''),
  tipoVehiculoId: z.string().trim().optional().default(''),
  marca: z.string().trim().optional().default(''),
  modelo: z.string().trim().optional().default(''),
  anio: z.string().trim().optional().default(''),
  color: z.string().trim().optional().default(''),
  placa: z.string().trim().optional().default(''),
  pais: z.string().trim().optional().default(''),
  flujoV2: z.string().trim().optional().default(''),
  geoCountryId: z.string().trim().optional().default(''),
  geoRegionId: z.string().trim().optional().default(''),
  geoRegionName: z.string().trim().optional().default(''),
  geoCityId: z.string().trim().optional().default(''),
  geoCityName: z.string().trim().optional().default(''),
  geoSectorId: z.string().trim().optional().default(''),
  geoSectorName: z.string().trim().optional().default(''),
  geoLat: z.string().trim().optional().default(''),
  geoLng: z.string().trim().optional().default(''),
  geoSource: z.string().trim().optional().default(''),
  geoConsentHome: z.string().trim().optional().default(''),
  geoConsentMarketing: z.string().trim().optional().default(''),
  seguirEmpresa: z.boolean().optional().default(true),
  mobileReturnTo: z.string().trim().optional().default(''),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400, headers: mobileCorsHeaders(request) })
  }

  const parsed = registroMovilSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Revisa tus datos y acepta los términos.' }, { status: 400, headers: mobileCorsHeaders(request) })
  }

  const values = parsed.data
  const formData = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') formData.set(key, value)
  }
  formData.set('terminos', 'on')
  formData.set('marketingConsent', values.marketingConsent ? 'on' : 'off')
  formData.set('seguirEmpresa', values.seguirEmpresa ? 'on' : 'off')
  formData.set('source', 'mobile')

  const result = values.companySlug
    ? await registrarCliente({}, formData)
    : await registrarCuentaGeneral({}, formData)

  if (result.error) {
    const status = result.error.startsWith('Demasiados registros') ? 429 : 400
    return NextResponse.json({ error: result.error }, { status, headers: mobileCorsHeaders(request) })
  }

  return NextResponse.json({
    success: result.success === true,
    pendingVerification: result.pendingVerification === true,
  }, { headers: mobileCorsHeaders(request) })
}
