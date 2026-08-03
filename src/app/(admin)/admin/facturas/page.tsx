import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Form from 'next/form'
import { ReceiptText, Search } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comprobantes' }

const fmtRD = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
const fmtFecha = (d: Date) =>
  new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)

const ESTADO_CHIP: Record<string, string> = {
  APPLIED: 'bg-success/15 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
  REVERTED: 'bg-warning/15 text-warning-foreground',
}
const ESTADO_LABEL: Record<string, string> = {
  APPLIED: 'Pagada',
  CANCELLED: 'Cancelada',
  REVERTED: 'Revertida',
}

// Tipos de comprobante que el negocio reimprime. Las VENTAS son las facturas
// de caja; el resto son ENTREGAS sin cobro (lavado incluido en la membresía,
// promoción, beneficio, premio…) que también necesitan su comprobante.
const TIPOS_VENTA = ['SALE'] as const
const TIPOS_ENTREGA = [
  'MEMBERSHIP_REDEMPTION',
  'PROMOTION_USE',
  'BENEFIT_USE',
  'REWARD_REDEMPTION',
  'COUPON_USE',
  'POINTS_SPEND',
  'REFERRAL',
] as const

const TIPO_LABEL: Record<string, string> = {
  SALE: 'Venta',
  MEMBERSHIP_REDEMPTION: 'Uso de membresía',
  PROMOTION_USE: 'Promoción',
  BENEFIT_USE: 'Beneficio',
  REWARD_REDEMPTION: 'Premio',
  COUPON_USE: 'Cupón',
  POINTS_SPEND: 'Canje de puntos',
  REFERRAL: 'Referido',
}

const FILTROS = [
  { key: '', label: 'Todo' },
  { key: 'ventas', label: 'Ventas' },
  { key: 'entregas', label: 'Gratis / canjes' },
] as const

/**
 * Historial permanente de comprobantes: facturas de caja Y entregas sin cobro
 * (lavados incluidos, promociones, beneficios, premios). Búsqueda por número,
 * código TX o cliente; vista previa y reimpresión sin generar documentos
 * nuevos. Nada se elimina — solo cambian estados.
 */
export default async function FacturasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams
  const { q = '', ver = '' } = sp
  const paginacion = leerPaginacion(sp)
  const term = q.trim()
  const tipos =
    ver === 'ventas'
      ? [...TIPOS_VENTA]
      : ver === 'entregas'
        ? [...TIPOS_ENTREGA]
        : [...TIPOS_VENTA, ...TIPOS_ENTREGA]

  const where: Prisma.TransactionWhereInput = {
    ...(companyId ? { companyId } : {}),
    tipo: { in: tipos },
    ...(term
      ? {
          OR: [
            { codigo: { contains: term.toUpperCase() } },
            { ticketNumero: { contains: term.toUpperCase() } },
            { cliente: { nombre: { contains: term, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  // Paginación real: el historial de comprobantes es permanente y crece sin
  // límite; con un tope fijo las reimpresiones viejas eran inalcanzables.
  const [facturas, totalFacturas] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        cliente: { select: { nombre: true } },
        sucursal: { select: { nombre: true } },
        empleado: { select: { name: true } },
        _count: { select: { impresiones: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: paginacion.saltar,
      take: paginacion.tomar,
    }),
    prisma.transaction.count({ where }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprobantes"
        description="Historial permanente de ventas Y entregas sin cobro (lavados incluidos, promociones, beneficios y premios): consulta, vista previa y reimpresión (58/80 mm, Carta o A4)."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Form action="/admin/facturas" className="flex max-w-lg flex-1 gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Nº, código TX o cliente…" className="pl-9" />
          </div>
          {ver && <input type="hidden" name="ver" value={ver} />}
          <Button type="submit" variant="secondary">Buscar</Button>
        </Form>

        {/* Filtro por tipo: todo / solo ventas / solo entregas sin cobro. */}
        <div className="flex gap-1 rounded-xl border border-border/70 bg-card p-1">
          {FILTROS.map((f) => {
            const activo = ver === f.key
            const params = new URLSearchParams()
            if (term) params.set('q', term)
            if (f.key) params.set('ver', f.key)
            const href = `/admin/facturas${params.toString() ? `?${params}` : ''}`
            return (
              <Link key={f.key || 'todo'} href={href}>
                <span
                  className={`inline-block rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activo
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {f.label}
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      {facturas.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-7 w-7" />}
          title={term ? `Sin comprobantes para “${term}”` : 'Aún no hay comprobantes'}
          description="Cada cobro de caja y cada canje (lavado incluido, promoción, beneficio o premio) genera su comprobante con número y código únicos, y queda aquí para siempre."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Comprobante</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Detalle</th>
                <th className="px-4 py-3 font-semibold">Empleado</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {facturas.map((f) => {
                const snap = (f.snapshot ?? {}) as { detalle?: string; empleado?: string }
                return (
                  <tr key={f.id} className="align-middle">
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-foreground">{f.ticketNumero}</p>
                      <p className="font-mono text-xs text-muted-foreground">{f.codigo}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          f.tipo === 'SALE'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-success/15 text-success'
                        }`}
                      >
                        {TIPO_LABEL[f.tipo] ?? f.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{f.cliente?.nombre ?? '—'}</td>
                    <td className="max-w-52 px-4 py-3">
                      <p className="truncate text-foreground">{snap.detalle ?? '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {f.metodoCobro ?? ''}
                        {f.sucursal ? ` · ${f.sucursal.nombre}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {f.empleado?.name ?? snap.empleado ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {f.monto != null && Number(f.monto) > 0
                        ? fmtRD(Number(f.monto))
                        : f.tipo === 'SALE'
                          ? '—'
                          : 'Gratis'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ESTADO_CHIP[f.estado] ?? 'bg-muted text-muted-foreground'}`}
                      >
                        {ESTADO_LABEL[f.estado] ?? f.estado}
                      </span>
                      {f._count.impresiones > 0 && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {f._count.impresiones} impresión{f._count.impresiones !== 1 ? 'es' : ''}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {fmtFecha(f.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <FacturaPrintDialog
                        transactionId={f.id}
                        yaImpresa={f._count.impresiones > 0}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {facturas.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={totalFacturas}
          params={sp}
          etiqueta="comprobantes"
        />
      )}
    </div>
  )
}
