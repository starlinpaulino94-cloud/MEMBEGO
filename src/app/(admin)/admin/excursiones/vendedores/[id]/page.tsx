import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  vendedorDetalle,
  vendedoresParaSupervisor,
  clientesCaptados,
} from '@/modules/excursiones/vendedores/queries'
import {
  ESTADO_VENDEDOR_LABEL,
  TONO_VENDEDOR,
  urlDeEnlace,
  urlDeQr,
  type EstadoVendedor,
} from '@/modules/excursiones/vendedores/nucleo'
import {
  ETAPA_ATRIBUCION_LABEL,
  type EtapaAtribucion,
} from '@/modules/excursiones/atribucion/nucleo'
import { formatDateTime } from '@/lib/format'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { VendedorEstadoBotones } from '@/components/excursiones/VendedorEstadoBotones'
import { VendedorQrCard } from '@/components/excursiones/VendedorQrCard'
import { VendedorForm } from '@/components/excursiones/VendedorForm'
import { StatusChip } from '@/components/ui/status-chip'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendedor' }

/** El embudo del vendedor: cuántos clientes trajo su QR, etapa por etapa. */
const EMBUDO_ETAPAS = [
  { clave: 'visitas', label: 'Visitas', detalle: 'Abrieron su enlace' },
  { clave: 'registros', label: 'Registros', detalle: 'Se registraron por su QR' },
  { clave: 'reservas', label: 'Reservas', detalle: 'Reservaron una excursión' },
  { clave: 'compras', label: 'Compras', detalle: 'Completaron su pago' },
] as const

export default async function VendedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="los vendedores de excursiones" />

  const { id } = await params
  const detalle = await vendedorDetalle(companyId, id)
  if (!detalle) notFound()
  const { vendedor, embudo } = detalle

  const enlace = vendedor.enlaces[0] ?? null
  const [supervisoresTodos, captados] = await Promise.all([
    vendedoresParaSupervisor(companyId),
    clientesCaptados(companyId, vendedor.id),
  ])
  const supervisores = supervisoresTodos.filter((s) => s.id !== vendedor.id)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/vendedores"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Vendedores
          </Link>
          <h2 className="mt-1 text-h2 text-foreground">
            {vendedor.nombre} {vendedor.apellido ?? ''}
          </h2>
          <p className="font-mono text-sm text-muted-foreground">{vendedor.codigo}</p>
        </div>
        <StatusChip tone={TONO_VENDEDOR[vendedor.estado as EstadoVendedor] ?? 'neutral'}>
          {ESTADO_VENDEDOR_LABEL[vendedor.estado as EstadoVendedor] ?? vendedor.estado}
        </StatusChip>
      </div>

      <VendedorEstadoBotones vendedorId={vendedor.id} estado={vendedor.estado as EstadoVendedor} />

      {/* Embudo de captación: el control que pidió el negocio — cuántos
          clientes se registran a través del QR de este vendedor. */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-h3 text-foreground">Clientes captados por su QR</h2>
        <p className="mt-1 text-caption text-muted-foreground">
          Cada etapa cuenta atribuciones reales registradas al entrar por su enlace.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {EMBUDO_ETAPAS.map((e) => (
            <div key={e.clave} className="rounded-xl bg-muted/50 p-3 text-center">
              <dd className="text-h2 font-bold text-foreground">{embudo[e.clave]}</dd>
              <dt className="mt-0.5 text-sm font-medium text-foreground">{e.label}</dt>
              <p className="text-caption text-muted-foreground">{e.detalle}</p>
            </div>
          ))}
        </dl>
      </section>

      {enlace ? (
        <>
          {vendedor.estado !== 'ACTIVO' ? (
            <Alert>
              <AlertDescription>
                Su enlace está pausado mientras el vendedor no esté activo: quien lo escanee no
                queda atribuido. Al reactivarlo, el mismo QR vuelve a funcionar.
              </AlertDescription>
            </Alert>
          ) : null}
          <VendedorQrCard
            codigo={vendedor.codigo}
            enlaceUrl={urlDeEnlace(enlace.slug)}
            qrUrl={urlDeQr(enlace.slug)}
            nombre={vendedor.nombre}
          />
        </>
      ) : null}

      {/* El nombre detrás del número: quién entró por su enlace y cuándo. */}
      {captados.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-h3 text-foreground">Últimos clientes captados</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Teléfono</th>
                  <th className="py-2 pr-3">Etapa</th>
                  <th className="py-2">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {captados.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground">{c.nombre}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.telefono ?? '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {ETAPA_ATRIBUCION_LABEL[c.etapa as EtapaAtribucion] ?? c.etapa}
                      {c.canal === 'QR' ? ' · QR' : ''}
                    </td>
                    <td className="py-2 text-muted-foreground">{formatDateTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-h3 text-foreground">Datos del vendedor</h2>
        <VendedorForm
          vendedor={{
            id: vendedor.id,
            nombre: vendedor.nombre,
            apellido: vendedor.apellido,
            telefono: vendedor.telefono,
            whatsapp: vendedor.whatsapp,
            email: vendedor.email,
            documento: vendedor.documento,
            direccion: vendedor.direccion,
            tipo: vendedor.tipo,
            supervisorId: vendedor.supervisorId,
          }}
          supervisores={supervisores}
        />
      </section>
    </div>
  )
}
