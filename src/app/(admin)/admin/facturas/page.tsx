import Link from 'next/link'
import { redirect } from 'next/navigation'
import { conEmpresa } from '@/lib/tenant'
import { requireSection } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
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
import { ComprobantesTabla } from '@/components/facturas/ComprobantesTabla'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comprobantes' }

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

const FILTROS = [
  { key: '', label: 'Todo' },
  { key: 'ventas', label: 'Ventas' },
  { key: 'entregas', label: 'Gratis / canjes' },
  // Pagos con tarjeta de la pasarela (app, web, renovación): su comprobante para el cuadre.
  { key: 'tarjeta', label: 'Pagos con tarjeta' },
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
  // `requireSection` y no `requireRole(ADMIN_ROLES)`: este historial lleva los
  // montos de cada venta, y hasta que 'facturas' fue una sección no había forma
  // de quitárselo a un empleado concreto — el formulario de Permisos no tenía
  // qué ofrecer. Además `ADMIN_ROLES` incluye MARKETING y SUPERVISOR, a los que
  // la sección no se les concedió: hasta hoy solo los frenaba el proxy, y esta
  // pantalla —la que lee los montos— los habría dejado pasar.
  const user = await requireSection('facturas')
  if (!user) redirect('/admin/dashboard')
  const companyId = await requireCompanyContext(user)
  const sp = await searchParams
  const { q = '', ver = '' } = sp
  const paginacion = leerPaginacion(sp)
  const term = q.trim()
  const tipos =
    ver === 'ventas' || ver === 'tarjeta'
      ? [...TIPOS_VENTA]
      : ver === 'entregas'
        ? [...TIPOS_ENTREGA]
        : [...TIPOS_VENTA, ...TIPOS_ENTREGA]

  const where: Prisma.TransactionWhereInput = {
    ...(companyId ? { companyId } : {}),
    tipo: { in: tipos },
    ...(ver === 'tarjeta' ? { metodoCobro: 'TARJETA' as const } : {}),
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
  const [facturas, totalFacturas] = await conEmpresa(companyId,
    (tx) => Promise.all([
      tx.transaction.findMany({
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
      tx.transaction.count({ where }),
    ])
  )

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
          title={term ? `Sin comprobantes para “${term}”` : ver === 'tarjeta' ? 'Aún no hay pagos con tarjeta' : 'Aún no hay comprobantes'}
          description="Cada cobro de caja y cada canje (lavado incluido, promoción, beneficio o premio) genera su comprobante con número y código únicos, y queda aquí para siempre."
        />
      ) : (
        <ComprobantesTabla
          filas={facturas.map((f) => {
            const snap = (f.snapshot ?? {}) as { detalle?: string; empleado?: string; metodoCobroLabel?: string }
            return {
              id: f.id,
              ticketNumero: f.ticketNumero,
              codigo: f.codigo,
              tipo: f.tipo,
              cliente: f.cliente?.nombre ?? null,
              detalle: snap.detalle ?? null,
              detalleSecundario: `${snap.metodoCobroLabel ?? f.metodoCobro ?? ''}${f.sucursal ? ` · ${f.sucursal.nombre}` : ''}`,
              empleado: f.empleado?.name ?? snap.empleado ?? null,
              monto: f.monto != null ? Number(f.monto) : null,
              estado: f.estado,
              impresiones: f._count.impresiones,
              creado: f.createdAt,
              accion: <FacturaPrintDialog transactionId={f.id} yaImpresa={f._count.impresiones > 0} />,
            }
          })}
          pie={<TablaPaginacion paginacion={paginacion} total={totalFacturas} params={sp} etiqueta="comprobantes" />}
        />
      )}
    </div>
  )
}

