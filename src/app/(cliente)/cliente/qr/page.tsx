import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { getClienteAllMemberships } from '@/modules/cliente/queries'
import { getFeaturedPromotions, getCompanyStats } from '@/modules/marketplace/cached'
import { LocationService } from '@/modules/geo/ubicaciones/service'
import { QRDisplay } from '@/components/qr/QRDisplay'
import { QrSinBeneficio, type PromoDestacada } from '@/components/cliente/qr/QrSinBeneficio'
import { nuevoTokenQr, vencimientoQr, qrVencido } from '@/modules/qr/token'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi QR' }

function textoVencimiento(v: Date | null, estado: string): string | null {
  if (!v) return null
  const dias = Math.ceil((v.getTime() - Date.now()) / 86_400_000)
  if (dias < 0) return `Venció el ${v.toLocaleDateString('es-DO')}`
  if (estado !== 'ACTIVA') return null
  if (dias === 0) return 'Vence hoy'
  return `Vence en ${dias} día${dias !== 1 ? 's' : ''}`
}

type MembershipQr = Awaited<ReturnType<typeof getClienteAllMemberships>>[number]

interface MiQrPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function MiQrPage({ searchParams }: MiQrPageProps) {
  const user = await requireRole('CLIENTE')
  const sp = await searchParams
  const rawId = sp?.id ?? (sp as Record<string, unknown>)?.membresiaId
  const pedida = (typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '').trim()

  const memberships: MembershipQr[] = await getClienteAllMemberships(
    user.supabaseId,
    user.metadata.clienteId
  ).catch(() => [])

  let elegida = pedida ? memberships.find((m) => m.id === pedida) ?? null : null

  // Si se pidió un id específico y no estaba en la lista consolidada, lo buscamos directo en BD
  if (!elegida && pedida) {
    const mDb = await sinEmpresa('cliente: buscar membresía pedida por id', (tx) =>
      tx.membership.findUnique({
        where: { id: pedida },
        include: {
          plan: true,
          company: {
            select: { id: true, name: true, slug: true, logoUrl: true, type: true, colorPrimario: true },
          },
          cliente: {
            select: { id: true, supabaseId: true, companyId: true },
          },
        },
      })
    ).catch(() => null)

    if (mDb) {
      const esPropietario =
        mDb.cliente.supabaseId === user.supabaseId ||
        mDb.cliente.id === user.metadata.clienteId ||
        (user.metadata.dbUserId && mDb.userId === user.metadata.dbUserId)
      if (esPropietario) {
        elegida = {
          id: mDb.id,
          clienteId: mDb.clienteId,
          companyId: mDb.companyId,
          company: mDb.company,
          plan: {
            id: mDb.plan.id,
            nombre: mDb.plan.nombre,
            precio: Number(mDb.plan.precio),
            esIlimitado: mDb.plan.esIlimitado,
            lavadosIncluidos: mDb.plan.lavadosIncluidos,
          },
          estado: mDb.estado,
          fechaVencimiento: mDb.fechaVencimiento,
          fechaInicio: mDb.fechaInicio,
          lavadosRestantes: mDb.lavadosRestantes,
          qrToken: null,
        }
        if (!memberships.some((m) => m.id === elegida!.id)) {
          memberships.unshift(elegida)
        }
      }
    }
  }

  // Si aún no se encuentra, verificar si el id corresponde directamente a un QrToken
  if (!elegida && pedida) {
    const qrDb = await sinEmpresa('cliente: buscar qr pedido por id o token', (tx) =>
      tx.qrToken.findFirst({
        where: { OR: [{ id: pedida }, { token: pedida }], activo: true },
        include: {
          membership: {
            include: {
              plan: true,
              company: {
                select: { id: true, name: true, slug: true, logoUrl: true, type: true, colorPrimario: true },
              },
              cliente: {
                select: { id: true, supabaseId: true, companyId: true },
              },
            },
          },
        },
      })
    ).catch(() => null)

    if (qrDb?.membership) {
      const mDb = qrDb.membership
      const esPropietario =
        mDb.cliente.supabaseId === user.supabaseId ||
        mDb.cliente.id === user.metadata.clienteId ||
        (user.metadata.dbUserId && mDb.userId === user.metadata.dbUserId)
      if (esPropietario) {
        elegida = {
          id: mDb.id,
          clienteId: mDb.clienteId,
          companyId: mDb.companyId,
          company: mDb.company,
          plan: {
            id: mDb.plan.id,
            nombre: mDb.plan.nombre,
            precio: Number(mDb.plan.precio),
            esIlimitado: mDb.plan.esIlimitado,
            lavadosIncluidos: mDb.plan.lavadosIncluidos,
          },
          estado: mDb.estado,
          fechaVencimiento: mDb.fechaVencimiento,
          fechaInicio: mDb.fechaInicio,
          lavadosRestantes: mDb.lavadosRestantes,
          qrToken: { id: qrDb.id, token: qrDb.token },
        }
        if (!memberships.some((m) => m.id === elegida!.id)) {
          memberships.unshift(elegida)
        }
      }
    }
  }

  // Fallback a membresía activa si no se pidió ninguna o no se encontró
  if (!elegida) {
    const activas = memberships.filter((m) => m.estado === 'ACTIVA')
    elegida =
      activas.find((m) => m.qrToken) ??
      activas[0] ??
      memberships[0] ??
      null
  }

  // Búsqueda y emisión del QR para la membresía seleccionada
  if (elegida) {
    let qrToken = elegida.qrToken
    if (!qrToken) {
      const qrEnDb = await sinEmpresa('cliente: buscar qr activo de membresía', (tx) =>
        tx.qrToken.findFirst({
          where: { membresiaId: elegida!.id, activo: true },
          orderBy: { createdAt: 'desc' },
          select: { id: true, token: true, expiraAt: true },
        })
      ).catch(() => null)

      if (qrEnDb && !qrVencido(qrEnDb.expiraAt)) {
        qrToken = { id: qrEnDb.id, token: qrEnDb.token }
      }
    }

    // Si la membresía está ACTIVA y no tiene ningún QR activo o vigente, emitir uno nuevo
    if (!qrToken && elegida.estado === 'ACTIVA') {
      try {
        const nuevo = await sinEmpresa('cliente: auto-emitir qr para membresía activa', (tx) =>
          tx.qrToken.create({
            data: {
              clienteId: elegida!.clienteId,
              membresiaId: elegida!.id,
              token: nuevoTokenQr(),
              expiraAt: vencimientoQr(),
            },
            select: { id: true, token: true },
          })
        )
        qrToken = nuevo
      } catch (e) {
        console.error('[cliente/qr] No se pudo auto-emitir QR para la membresía:', e)
      }
    }

    elegida.qrToken = qrToken

    const idx = memberships.findIndex((m) => m.id === elegida!.id)
    if (idx !== -1) {
      memberships[idx] = { ...memberships[idx], qrToken }
    }
  }

  const ahora = new Date()
  const usable =
    elegida &&
    elegida.estado === 'ACTIVA' &&
    elegida.qrToken &&
    (!elegida.fechaVencimiento || elegida.fechaVencimiento > ahora)
      ? elegida
      : null

  if (!usable) {
    // Si no tiene ninguna membresía en absoluto, mostramos el estado vacío para explorar beneficios
    if (memberships.length === 0) {
      const [destacadas, empresa, ubicacion] = await Promise.all([
        getFeaturedPromotions(4).catch(() => []),
        user.metadata.clienteId && user.metadata.companyId
          ? conEmpresa(user.metadata.companyId, (tx) =>
              tx.company.findUnique({
                where: { id: user.metadata.companyId! },
                select: { bienvenidaActiva: true, bienvenidaTipo: true, bienvenidaValor: true },
              })
            ).catch(() => null)
          : Promise.resolve(null),
        user.metadata.dbUserId
          ? LocationService.primaria(user.metadata.dbUserId).catch(() => null)
          : Promise.resolve(null),
      ])

      const primeras = destacadas.slice(0, 4)
      const stats = await Promise.all(
        primeras.map((p) =>
          getCompanyStats(p.company.slug)
            .then((s) => ({ id: p.id, rating: s?.averageRating ?? null, n: s?.totalRatings ?? 0 }))
            .catch(() => ({ id: p.id, rating: null as number | null, n: 0 }))
        )
      )
      const porPromo = new Map(stats.map((s) => [s.id, s]))
      const tarjetas: PromoDestacada[] = primeras.map((promo) => ({
        promo,
        valoracion: porPromo.get(promo.id)?.rating ?? null,
        resenas: porPromo.get(promo.id)?.n ?? 0,
      }))

      // El beneficio de bienvenida solo se anuncia si la empresa lo financia Y
      // esta persona todavía no tiene ninguna membresía: es de primera vez.
      const ofreceBienvenida = !!empresa?.bienvenidaActiva && memberships.length === 0
      const bienvenida = !ofreceBienvenida
        ? null
        : empresa?.bienvenidaTipo === 'MONTO' && empresa.bienvenidaValor != null
          ? `Bono de bienvenida de ${formatMoney(Number(empresa.bienvenidaValor))} con tu primera membresía registrada`
          : 'Beneficio de bienvenida con tu primera membresía registrada'

      return (
        <QrSinBeneficio
          destacadas={tarjetas}
          bienvenida={bienvenida}
          ciudad={ubicacion?.sector?.name ?? ubicacion?.city?.name ?? null}
        />
      )
    }

    // Si tiene membresías pero la seleccionada no está activa o lista
    return (
      <div className="animate-fade-up space-y-4">
        {elegida ? (
          <section className="overflow-hidden rounded-xl border border-vibe-borde bg-card p-5 text-center elevation-2">
            <p className="text-label-md text-muted-foreground">{elegida.company.name}</p>
            <h1 className="mt-0.5 break-words text-h2 text-foreground">{elegida.plan.nombre}</h1>
            <div className="mx-auto my-5 max-w-sm rounded-lg border border-dashed border-vibe-borde bg-vibe-niebla/50 p-6 text-center">
              <span className="inline-block rounded-full bg-vibe-lavanda px-3 py-1 text-xs font-semibold text-vibe-violet">
                {elegida.estado}
              </span>
              <p className="mt-3 text-sm text-muted-foreground">
                {elegida.estado === 'PENDIENTE' || elegida.estado === 'PENDIENTE_PAGO'
                  ? 'Esta membresía está pendiente de pago. Completa el pago para activar tu código QR de acceso.'
                  : elegida.estado === 'VENCIDA'
                    ? 'Esta membresía se encuentra vencida. Renueva tu plan para volver a generar tu código QR.'
                    : !elegida.plan.esIlimitado && (elegida.lavadosRestantes ?? 0) <= 0
                      ? 'No te quedan usos disponibles en este período. Renueva tu membresía para continuar.'
                      : 'El código QR no está disponible en este momento.'}
              </p>
            </div>
            <Link
              href={`/membresia/${elegida.id}`}
              className="grad-vibe-cta mt-2 flex min-h-11 items-center justify-center rounded-full px-4 text-label-lg font-bold text-white outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.98]"
            >
              {elegida.estado === 'PENDIENTE' || elegida.estado === 'PENDIENTE_PAGO'
                ? 'Completar pago y activar pase'
                : 'Ver detalle y gestionar'}
            </Link>
          </section>
        ) : null}

        {memberships.length > 1 ? (
          <section aria-labelledby="qr-pases">
            <h2 id="qr-pases" className="px-1 text-h4 text-foreground">
              Tus pases
            </h2>
            <ul className="mt-2 space-y-2">
              {memberships.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/cliente/qr?id=${m.id}`}
                    aria-current={m.id === elegida?.id ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-xl border bg-card p-4 elevation-1 outline-none transition focus-visible:ring-2 focus-visible:ring-vibe-violet',
                      m.id === elegida?.id ? 'border-vibe-violet' : 'border-vibe-borde'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-label-lg text-foreground">
                        {m.company.name} · {m.plan.nombre}
                      </span>
                      <span className="block text-label-md text-muted-foreground">{m.estado}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    )
  }

  const vencimiento = textoVencimiento(usable.fechaVencimiento, usable.estado)
  const usos = usable.plan.esIlimitado
    ? 'Ilimitado'
    : `${usable.lavadosRestantes} de ${usable.plan.lavadosIncluidos ?? '—'} usos`

  return (
    <div className="animate-fade-up space-y-4">
      <section className="overflow-hidden rounded-xl border border-vibe-borde bg-card p-5 text-center elevation-2">
        <p className="text-label-md text-muted-foreground">{usable.company.name}</p>
        <h1 className="mt-0.5 break-words text-h2 text-foreground">{usable.plan.nombre}</h1>
        <div className="mx-auto mt-4 w-fit rounded-lg border border-vibe-borde bg-card p-4">
          <QRDisplay token={usable.qrToken!.token} size={220} />
        </div>
        <p className="mt-3 text-label-lg text-foreground">{usos}</p>
        {vencimiento ? <p className="text-caption text-muted-foreground">{vencimiento}</p> : null}
        <Link
          href={`/membresia/${usable.id}`}
          className="grad-vibe-cta mt-4 flex min-h-11 items-center justify-center rounded-full px-4 text-label-lg font-bold text-white outline-none transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-vibe-violet active:scale-[0.98]"
        >
          Ver detalle y movimientos
        </Link>
      </section>

      {memberships.length > 1 ? (
        <section aria-labelledby="qr-pases">
          <h2 id="qr-pases" className="px-1 text-h4 text-foreground">
            Tus pases
          </h2>
          <ul className="mt-2 space-y-2">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/cliente/qr?id=${m.id}`}
                  aria-current={m.id === usable.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border bg-card p-4 elevation-1 outline-none transition focus-visible:ring-2 focus-visible:ring-vibe-violet',
                    m.id === usable.id ? 'border-vibe-violet' : 'border-vibe-borde'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label-lg text-foreground">
                      {m.company.name} · {m.plan.nombre}
                    </span>
                    <span className="block text-label-md text-muted-foreground">{m.estado}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
