import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getOfertaDetalleAdmin, ofertaVigente } from '@/modules/ofertas/queries'
import { PERIODO_LABEL } from '@/modules/ofertas/periodo'
import { absoluteUrl } from '@/lib/site'
import {
  AgregarInvitadoForm,
  CopiarLinkOferta,
  EstadoOfertaButtons,
  QuitarInvitadoButton,
  RegistrarUsoButton,
} from '@/components/ofertas/OfertaAdminActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Regalo VIP' }

export default async function OfertaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const { id } = await params
  const companyId = companyFilter(user) ?? user.metadata.companyId ?? null
  if (!companyId) notFound()

  const company = await conEmpresaOTodas(
    companyId,
    'ofertas · [id]: sin empresa activa es el superadmin, que cruza empresas a propósito',
    (tx) => tx.company.findUnique({
      where: { id: companyId },
      select: { zonaHoraria: true },
    })
  )
  const detalle = await getOfertaDetalleAdmin(
    companyId,
    id,
    company?.zonaHoraria ?? 'America/Santo_Domingo'
  )
  if (!detalle) notFound()
  const { oferta, invitados } = detalle
  const vigente = ofertaVigente(oferta)

  // Candidatos para agregar: clientes de la empresa que aún no están invitados.
  const yaInvitados = new Set(invitados.map((i) => i.cliente.id))
  const candidatos = (
    await conEmpresaOTodas(
      companyId,
      'ofertas · [id]: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.cliente.findMany({
        where: { companyId },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
        take: 500,
      })
    )
  ).filter((c) => !yaInvitados.has(c.id))

  const reclamaron = invitados.filter((i) => i.reclamadaAt).length

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/admin/ofertas/vip"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Regalos VIP
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{oferta.titulo}</h1>
          <p className="text-muted-foreground">
            {oferta.usosPorPeriodo} usos {PERIODO_LABEL[oferta.periodo]}
            {oferta.vigenciaHasta
              ? ` · válido hasta ${new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(oferta.vigenciaHasta)}`
              : ''}
            {!vigente && ' · NO vigente'}
          </p>
          {oferta.descripcion && (
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{oferta.descripcion}</p>
          )}
        </div>
        <EstadoOfertaButtons ofertaId={oferta.id} estado={oferta.estado} />
      </div>

      {/* Link privado para compartir */}
      <div>
        <p className="mb-1.5 text-sm font-semibold text-foreground">
          Link privado del regalo
        </p>
        <CopiarLinkOferta url={absoluteUrl(`/oferta/${oferta.codigo}`)} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Compártelo solo con tu lista: aunque el link circule, únicamente las
          cuentas invitadas pueden reclamarlo.
        </p>
      </div>

      {/* Resumen */}
      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: 'Invitados', valor: invitados.length },
          { label: 'Reclamaron', valor: reclamaron },
          {
            label: 'Usos totales',
            valor: invitados.reduce((acc, i) => acc + i.usosTotales, 0),
          },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-foreground">{s.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Invitados */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Lista de invitados</h2>
          <AgregarInvitadoForm ofertaId={oferta.id} candidatos={candidatos} />
        </div>

        {invitados.map((i) => {
          const agotado = i.usosPeriodo >= oferta.usosPorPeriodo
          return (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/admin/clientes/${i.cliente.id}`}
                  className="font-semibold text-foreground hover:underline"
                >
                  {i.cliente.nombre}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {i.reclamadaAt ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Reclamado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Sin reclamar
                    </span>
                  )}
                  <span>
                    · {i.usosPeriodo}/{oferta.usosPorPeriodo} usos del período · {i.usosTotales}{' '}
                    en total
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <RegistrarUsoButton
                  invitadoId={i.id}
                  disabled={!vigente || !i.reclamadaAt || agotado}
                />
                <QuitarInvitadoButton ofertaId={oferta.id} clienteId={i.cliente.id} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
