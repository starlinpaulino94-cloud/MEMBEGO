import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, Crown, ArrowRight, Sparkles } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatMoney, formatDate } from '@/lib/format'
import { excursionesPublicas, companyIdPorSlug } from '@/modules/excursiones/catalogo/public-queries'
import { getCompanyPublic } from '@/modules/marketplace/cached'

interface BienvenidaRefPageProps {
  params: Promise<{ companySlug: string }>
}

export default async function BienvenidaRefPage({ params }: BienvenidaRefPageProps) {
  const { companySlug } = await params

  const user = await getUser()
  if (!user) redirect('/login')

  const company = await getCompanyPublic(companySlug)
  if (!company) redirect('/cliente/explorar')

  // Verificar que el usuario esté afiliado a esta empresa
  const cliente = await prisma.cliente.findFirst({
    where: { supabaseId: user.supabaseId, companyId: company.id },
    select: { id: true },
  })
  if (!cliente) redirect('/cliente/explorar')

  // Cargar membresías activas y excursiones disponibles en paralelo
  const [membresias, excursionesData] = await Promise.all([
    prisma.membership.findMany({
      where: {
        clienteId: cliente.id,
        companyId: company.id,
        estado: 'ACTIVA',
        fechaVencimiento: { gte: new Date() },
      },
      include: { plan: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    companyIdPorSlug(companySlug).then((cid) =>
      cid ? excursionesPublicas(cid) : Promise.resolve([])
    ),
  ])

  const excursiones = excursionesData.map((exc: (typeof excursionesData)[number]) => ({
    nombre: exc.nombre,
    slug: exc.slug,
    portadaUrl: exc.portadaUrl,
    categoria: exc.categoria,
    moneda: exc.moneda,
    duracionMin: exc.duracionMin,
    precioDesde: exc.variantes[0]?.precioAdulto ?? null,
  }))

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <div className="mx-auto max-w-2xl px-4 py-12">
        {/* Header de bienvenida */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-foreground">
            ¡Bienvenido a {company.name}!
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Tu cuenta está lista. Aquí tienes lo que puedes hacer ahora.
          </p>
        </div>

        {/* Membresías activas */}
        {membresias.length > 0 && (
          <div className="mt-10 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b bg-muted/30 p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <Crown className="h-5 w-5 text-primary" />
                Tus membresías activas
              </h2>
            </div>
            <div className="divide-y">
              {membresias.map((m: (typeof membresias)[number]) => (
                <div key={m.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{m.plan.nombre}</p>
                    <p className="text-sm text-muted-foreground">
                      Vence: {m.fechaVencimiento ? formatDate(m.fechaVencimiento, { moneda: 'DOP' }) : 'Sin fecha'}
                    </p>
                  </div>
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                    Activa
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Excursiones disponibles */}
        {excursiones.length > 0 && (
          <div className="mt-8 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b bg-muted/30 p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <CalendarDays className="h-5 w-5 text-primary" />
                Excursiones disponibles
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reserva directamente desde aquí.
              </p>
            </div>
            <div className="divide-y">
              {excursiones.map((exc: (typeof excursiones)[number]) => (
                <Link
                  key={exc.slug}
                  href={`/empresas/${companySlug}/excursiones/${exc.slug}`}
                  className="flex items-center gap-4 p-4 transition hover:bg-muted/30"
                >
                  {exc.portadaUrl ? (
                    <img
                      src={exc.portadaUrl}
                      alt={exc.nombre}
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
                      <CalendarDays className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{exc.nombre}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {exc.categoria && <span>{exc.categoria}</span>}
                      {exc.duracionMin && <span>{exc.duracionMin} min</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    {exc.precioDesde != null && (
                      <p className="text-sm font-semibold text-primary">
                        {formatMoney(exc.precioDesde, { moneda: exc.moneda })}
                      </p>
                    )}
                    <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Sin membresías ni excursiones */}
        {membresias.length === 0 && excursiones.length === 0 && (
          <div className="mt-10 rounded-xl border bg-card p-8 text-center shadow-sm">
            <p className="text-muted-foreground">
              Explora las opciones de {company.name} desde tu perfil.
            </p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/cliente/empresas/${companySlug}`}
            className="flex-1 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Ver perfil de {company.name}
          </Link>
          <Link
            href="/cliente/explorar"
            className="flex-1 rounded-lg border bg-card py-3 text-center text-sm font-semibold transition hover:bg-muted"
          >
            Explorar más negocios
          </Link>
        </div>
      </div>
    </div>
  )
}
