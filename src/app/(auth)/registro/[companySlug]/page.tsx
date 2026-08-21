import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { conEmpresa } from '@/lib/tenant'
import { getUser } from '@/lib/auth'
import { registrarRegistroIniciado } from '@/lib/referidos-attribution'
import { resolverEnlace, VENDEDOR_COOKIE } from '@/modules/excursiones/atribucion/registrar'
import { capacidadesDeEmpresa } from '@/modules/capacidades/catalogo'
import { flujoRequiereVehiculo } from '@/modules/onboarding/flujos'
import { isRegistroV2Enabled } from '@/lib/registroV2'
import { RegisterForm } from '@/components/auth/RegisterForm'
import { AsistenteRegistro, type TipoVehiculoOpcion } from '@/components/auth/AsistenteRegistro'
import { CompanyRegistroHeader } from '@/components/auth/CompanyRegistroHeader'
import { AfiliarEmpresaCard } from '@/components/cliente/AfiliarEmpresaCard'
import { companyIdPorSlug, excursionesPublicas } from '@/modules/excursiones/catalogo/public-queries'
import Link from 'next/link'
import { CalendarDays, MapPin, Clock } from 'lucide-react'
import { formatMoney } from '@/lib/format'

interface ExcursionCard {
  id: string
  nombre: string
  slug: string
  portadaUrl: string | null
  categoria: string | null
  moneda: string
  duracionMin: number | null
  ubicacion: string | null
  precioDesde: number | null
}

function ExcursionesSection({
  companySlug,
  excursiones,
}: {
  companySlug: string
  excursiones: ExcursionCard[]
}) {
  if (excursiones.length === 0) return null
  return (
    <section className="mt-12" aria-labelledby="excursiones-heading">
      <h2 id="excursiones-heading" className="text-h3 font-bold text-foreground">
        Excursiones disponibles
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Explora y reserva directamente desde aquí.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {excursiones.map((exc) => (
          <Link
            key={exc.id}
            href={`/empresas/${companySlug}/excursiones/${exc.slug}`}
            className="group overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md"
          >
            <div className="relative aspect-[16/10] bg-muted">
              {exc.portadaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={exc.portadaUrl}
                  alt={exc.nombre}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <CalendarDays className="h-10 w-10 text-muted-foreground/30" />
                </div>
              )}
              {exc.categoria && (
                <span className="absolute left-3 top-3 rounded-full bg-background/80 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                  {exc.categoria}
                </span>
              )}
            </div>
            <div className="p-4">
              <h3 className="font-semibold group-hover:text-primary">{exc.nombre}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {exc.duracionMin && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {exc.duracionMin} min
                  </span>
                )}
                {exc.ubicacion && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {exc.ubicacion}
                  </span>
                )}
              </div>
              {exc.precioDesde != null && (
                <p className="mt-2 text-sm font-semibold text-primary">
                  Desde {formatMoney(exc.precioDesde, { moneda: exc.moneda })}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export const dynamic = 'force-dynamic'

export default async function RegistroPage({
  params,
  searchParams,
}: {
  params: Promise<{ companySlug: string }>
  searchParams: Promise<{ ref?: string; e?: string }>
}) {
  const { companySlug } = await params
  const { ref, e: enlaceSlugParam } = await searchParams

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
      tipoNegocioCodigo: true,
    },
  })

  if (!company || !company.isActive) notFound()

  // Fase E6 · Embudo: landing de registro con atribución (dedup 24 h).
  if (ref) await registrarRegistroIniciado(ref)

  // Leer cookie de atribución del vendedor (server-side)
  let cookieEnlaceSlug: string | null = null
  try {
    const store = await cookies()
    cookieEnlaceSlug = store.get(VENDEDOR_COOKIE)?.value?.trim().toLowerCase() ?? null
  } catch {
    /* ignore */
  }

  // Excursiones: si llegó por el enlace de un vendedor (/e/[slug]), se le
  // saluda con su nombre. Solo para mostrar: quien atribuye es la cookie.
  let vendedorQueTrae: string | null = null
  // Prioridad: URL param > cookie
  const enlaceSlug = (enlaceSlugParam ?? cookieEnlaceSlug)?.trim().toLowerCase()
  if (enlaceSlug) {
    const enlace = await resolverEnlace(enlaceSlug)
    if (enlace && enlace.companyId === company.id) vendedorQueTrae = enlace.nombreVendedor
  }

  // Cargar excursiones si vino de un vendedor (para mostrar antes/después del registro)
  let excursiones: {
    id: string
    nombre: string
    slug: string
    portadaUrl: string | null
    categoria: string | null
    moneda: string
    duracionMin: number | null
    ubicacion: string | null
    precioDesde: number | null
  }[] = []
  if (enlaceSlug) {
    const cid = await companyIdPorSlug(company.slug)
    if (cid) {
      const data = await excursionesPublicas(cid)
      excursiones = data.map((exc) => ({
        id: exc.id,
        nombre: exc.nombre,
        slug: exc.slug,
        portadaUrl: exc.portadaUrl,
        categoria: exc.categoria,
        moneda: exc.moneda,
        duracionMin: exc.duracionMin,
        ubicacion: exc.ubicacion,
        precioDesde: exc.variantes[0]?.precioAdulto ?? null,
      }))
    }
  }

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
      <>
        <AfiliarEmpresaCard
          companySlug={company.slug}
          companyName={company.name}
          yaEsMiembro={yaEsMiembro}
          enlaceSlug={enlaceSlug}
        />
        <ExcursionesSection companySlug={company.slug} excursiones={excursiones} />
      </>
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
  const { categoriaExplicita } = capacidadesDeEmpresa(company)
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
        vendedor={vendedorQueTrae}
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
      <ExcursionesSection companySlug={company.slug} excursiones={excursiones} />
    </>
  )
}
