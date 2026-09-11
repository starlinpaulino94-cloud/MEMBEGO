import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { empresaDelPanel } from '@/modules/admin/queries'
import { conEmpresa } from '@/lib/tenant'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Comprobante de ajuste de lavados' }

/**
 * COMPROBANTE DE UN AJUSTE DE LAVADOS.
 *
 * No es un documento que se genere aparte: es el asiento de auditoría, leído.
 * Por eso el número del comprobante ES el id del asiento — el papel y el
 * registro no pueden discrepar porque son la misma fila.
 *
 * Se imprime en A4 con `ReporteImprimible`, no en papel térmico: esto no lo
 * lee el cliente en el mostrador, lo archiva quien lleva la contabilidad.
 */

interface PayloadAjuste {
  tipo?: string
  delta?: number
  antes?: number
  despues?: number
  motivo?: string
  cliente?: string
  clienteId?: string
  plan?: string
}

export default async function ComprobanteAjustePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = empresaDelPanel(user)
  if (!companyId) return <SinEmpresaActiva seccion="los comprobantes de ajuste" />

  const { id } = await params

  // `companyId` va en el WHERE, no solo en el contexto: un id de otra empresa
  // no debe devolver nada aunque se escriba a mano en la barra de direcciones.
  const asiento = await conEmpresa(companyId, (tx) =>
    tx.auditLog.findFirst({
      where: { id, companyId, entidadTipo: 'Membership', accion: 'NOTA_INTERNA' },
      select: {
        id: true,
        createdAt: true,
        entidadId: true,
        payload: true,
        user: { select: { name: true, email: true } },
        company: { select: { name: true } },
      },
    })
  ).catch(() => null)

  const datos = (asiento?.payload ?? {}) as PayloadAjuste

  if (!asiento || datos.tipo !== 'AJUSTE_LAVADOS') {
    return (
      <EmptyState
        title="Comprobante no encontrado"
        description="Puede que el enlace sea de otra empresa o que el ajuste se haya registrado de otra forma."
      />
    )
  }

  const delta = Number(datos.delta ?? 0)
  const signo = delta > 0 ? '+' : '−'
  const firmante = asiento.user?.name ?? asiento.user?.email ?? 'Proceso automático'

  const filas: { etiqueta: string; valor: string }[] = [
    { etiqueta: 'Cliente', valor: datos.cliente ?? '—' },
    { etiqueta: 'Plan', valor: datos.plan ?? '—' },
    { etiqueta: 'Lavados antes', valor: String(datos.antes ?? '—') },
    { etiqueta: 'Ajuste aplicado', valor: `${signo}${Math.abs(delta)}` },
    { etiqueta: 'Lavados después', valor: String(datos.despues ?? '—') },
    { etiqueta: 'Autorizado por', valor: firmante },
    { etiqueta: 'Fecha y hora', valor: formatDateTime(asiento.createdAt) },
    { etiqueta: 'N.º de comprobante', valor: asiento.id },
  ]

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="print:hidden">
        <Link href="/admin/membresias">
          <ArrowLeft className="h-4 w-4" /> Volver a membresías
        </Link>
      </Button>

      <ReporteImprimible
        titulo="Comprobante de ajuste de lavados"
        subtitulo={asiento.company?.name ?? undefined}
        generadoEn={formatDateTime(asiento.createdAt)}
        controles={<BotonImprimir />}
        pie="Este comprobante corresponde a un asiento de auditoría. Su número no se reutiliza."
      >
        <dl className="divide-y divide-border">
          {filas.map((f) => (
            <div key={f.etiqueta} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-small text-muted-foreground">{f.etiqueta}</dt>
              <dd className="text-right text-small font-medium text-foreground tabular-nums">
                {f.valor}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 rounded-xl border border-border p-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Motivo del ajuste
          </p>
          <p className="mt-1.5 text-small text-foreground">{datos.motivo ?? '—'}</p>
        </div>
      </ReporteImprimible>
    </div>
  )
}
