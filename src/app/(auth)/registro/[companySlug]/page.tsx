import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { registrarRegistroIniciado } from '@/lib/referidos-attribution'
import { capacidadesEfectivas } from '@/modules/capacidades/catalogo'
import { flujoRequiereVehiculo } from '@/modules/onboarding/flujos'
import { isRegistroV2Enabled } from '@/lib/registroV2'
import { RegisterForm } from '@/components/auth/RegisterForm'
import { AsistenteRegistro, type TipoVehiculoOpcion } from '@/components/auth/AsistenteRegistro'
import { CompanyRegistroHeader } from '@/components/auth/CompanyRegistroHeader'
import { AfiliarEmpresaCard } from '@/components/cliente/AfiliarEmpresaCard'

export const dynamic = 'force-dynamic'

export default async function RegistroPage({
  params,
  searchParams,
}: {
  params: Promise<{ companySlug: string }>
  searchParams: Promise<{ ref?: string }>
}) {
  const { companySlug } = await params
  const { ref } = await searchParams

  // select explícito: el registro es la puerta de entrada de clientes y no
  // puede caerse porque el modelo Company tenga una columna más nueva que la
  // BD de producción (p. ej. un deploy cuya migración aún no se aplicó).
  const company = await prisma.company.findUnique({
    where: { slug: companySlug },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      isActive: true,
      logoUrl: true,
      bannerUrl: true,
      colorPrimario: true,
      capacidades: true,
    },
  })

  if (!company || !company.isActive) notFound()

  // Fase E6 · Embudo: landing de registro con atribución (dedup 24 h).
  if (ref) await registrarRegistroIniciado(ref)

  // Si el usuario ya inició sesión como cliente, no debe registrarse de nuevo:
  // se afilia a esta empresa con su cuenta existente (un clic). El chequeo es
  // opcional: si la verificación de sesión falla, se ofrece el registro normal.
  const user = await getUser().catch(() => null)
  if (user && user.metadata.role === 'CLIENTE') {
    const yaEsMiembro = await prisma.cliente
      .findUnique({
        where: {
          supabaseId_companyId: {
            supabaseId: user.supabaseId,
            companyId: company.id,
          },
        },
        select: { id: true },
      })
      .then((c) => !!c)
      .catch(() => false)

    return (
      <AfiliarEmpresaCard
        companySlug={company.slug}
        companyName={company.name}
        yaEsMiembro={yaEsMiembro}
      />
    )
  }

  // Onboarding v2: el flujo lo decide la CATEGORÍA del negocio (declarativo,
  // resuelto en el servidor), no un `type === 'carwash'` en el cliente.
  //
  // La EXPLÍCITA, no la efectiva. La efectiva rellena lo desconocido con
  // CAR_WASH (fail-open pensado para no apagar módulos), y aquí ese default
  // le exigía la placa del carro al cliente de un restaurante sin categoría
  // configurada — la regla de catalogo.ts es la contraria: un requisito es
  // una puerta cerrada, y ante la duda NO se exige vehículo.
  const { categoriaExplicita } = capacidadesEfectivas(company.type, company.capacidades)
  const flujoConVehiculo = flujoRequiereVehiculo(categoriaExplicita)

  // Categorías de vehículo del negocio, para las tarjetas del paso 1 del
  // vehículo. Si la empresa no configuró ninguna, el asistente omite los pasos
  // de vehículo (fail-open: el registro jamás se bloquea por configuración).
  let tiposVehiculo: TipoVehiculoOpcion[] = []
  if (isRegistroV2Enabled() && flujoConVehiculo) {
    tiposVehiculo = await conEmpresa(company.id, (tx) =>
      tx.tipoVehiculo.findMany({
        where: { companyId: company.id, activo: true },
        select: { id: true, nombre: true, descripcion: true, iconoUrl: true },
        orderBy: { orden: 'asc' },
      })
    ).catch(() => [])
  }
  const requiereVehiculo = flujoConVehiculo && tiposVehiculo.length > 0

  return (
    <>
      <CompanyRegistroHeader
        name={company.name}
        logoUrl={company.logoUrl}
        bannerUrl={company.bannerUrl}
        colorPrimario={company.colorPrimario}
        referido={!!ref}
      />
      {isRegistroV2Enabled() ? (
        <AsistenteRegistro
          modo="empresa"
          companySlug={company.slug}
          companyName={company.name}
          colorPrimario={company.colorPrimario}
          requiereVehiculo={requiereVehiculo}
          tiposVehiculo={tiposVehiculo}
        />
      ) : (
        // Salida de emergencia (NEXT_PUBLIC_REGISTRO_V2=0): formulario clásico.
        <RegisterForm
          companySlug={company.slug}
          companyName={company.name}
          isCarwash={flujoConVehiculo}
          colorPrimario={company.colorPrimario}
        />
      )}
    </>
  )
}
