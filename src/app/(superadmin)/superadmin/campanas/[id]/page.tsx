import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import {
  getCampanaGlobal,
  leerPlantilla,
  CAMPANA_TIPO_LABELS,
  CAMPANA_ESTADO_LABELS,
  type CampanaTipo,
  type CampanaEstado,
  type PlantillaPlan,
  type PlantillaPromocion,
} from '@/modules/superadmin/campanasGlobales'
import { CampanaGlobalAcciones } from '@/components/superadmin/CampanaGlobalAcciones'
import { PageHeader } from '@/components/ui/page-header'
import { formatDateTime } from '@/lib/format'
import { ArrowLeft, Check, Clock, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Campaña conjunta' }

/**
 * Detalle de una campaña conjunta: qué se va a crear, en qué empresas, y el
 * estado empresa por empresa. Desde aquí se aplica (reparte) y se archiva.
 */
export default async function CampanaGlobalDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('SUPERADMIN')
  const { id } = await params

  const campana = await getCampanaGlobal(id).catch(() => null)
  if (!campana) notFound()

  const tipo = campana.tipo as CampanaTipo
  const plantilla = leerPlantilla(tipo, campana.plantilla)
  const esCadena = campana.modo === 'CADENA'
  const pendientes = esCadena
    ? campana.pasos.filter((p) => p.aplicadaAt == null).length
    : campana.participantes.filter((p) => p.aplicadaAt == null).length

  const resumen =
    tipo === 'PLAN'
      ? (() => {
          const t = plantilla as PlantillaPlan
          return [
            ['Nombre del plan', t.nombre],
            ['Precio', `RD$${t.precio}`],
            ['Usos incluidos', t.esIlimitado ? 'Ilimitados' : String(t.lavadosIncluidos)],
            ['Duración', `${t.vigenciaDias} días`],
            ['Descripción', t.descripcion ?? '—'],
          ]
        })()
      : (() => {
          const t = plantilla as PlantillaPromocion
          return [
            ['Título', t.titulo],
            ['Descripción', t.descripcion || '—'],
            ['Descuento', t.descuento != null ? `${t.descuento}%` : '—'],
            ['Vigente hasta', t.vigenciaHasta || 'Sin fecha de fin'],
            ['Comprable', t.esComprable ? `Sí — RD$${t.precio ?? 0}` : 'No (beneficio directo)'],
            ['Usos por compra', String(t.usosPorCompra ?? 1)],
          ]
        })()

  return (
    <div className="space-y-6">
      <Link
        href="/superadmin/campanas"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Campañas conjuntas
      </Link>

      <PageHeader
        title={campana.nombre}
        description={campana.descripcion ?? `Crea ${CAMPANA_TIPO_LABELS[tipo] ?? tipo} en cada empresa participante.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase text-muted-foreground">
          {CAMPANA_ESTADO_LABELS[campana.estado as CampanaEstado] ?? campana.estado}
        </span>
        {campana.todasLasEmpresas && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold uppercase text-muted-foreground">
            Todas las empresas
          </span>
        )}
        {campana.aplicadaAt && (
          <span className="text-xs text-muted-foreground">
            Aplicada {formatDateTime(campana.aplicadaAt)}
          </span>
        )}
        {campana.creadaPor && (
          <span className="text-xs text-muted-foreground">Por {campana.creadaPor.name}</span>
        )}
      </div>

      {campana.imagenUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={campana.imagenUrl}
          alt={campana.nombre}
          className="h-40 w-full rounded-2xl object-cover"
        />
      )}

      <CampanaGlobalAcciones
        campanaId={campana.id}
        estado={campana.estado}
        pendientes={pendientes}
      />

      {esCadena && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            La cadena, paso a paso
          </h2>
          {campana.pasos.map((p, i) => (
            <div key={p.id} className="flex gap-3 rounded-2xl border border-border/70 bg-card p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {p.orden}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{p.titulo}</p>
                <p className="text-sm text-muted-foreground">{p.company.name}</p>
                {p.descripcion && (
                  <p className="mt-1 text-sm text-muted-foreground">{p.descripcion}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {i === 0
                    ? 'El cliente lo toma por su cuenta; es la puerta de entrada.'
                    : `Se entrega en cuanto el cliente usa el paso ${p.orden - 1} por primera vez.`}
                </p>
                {p.error && <p className="mt-1 text-xs text-destructive">Error: {p.error}</p>}
              </div>
              {p.imagenUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imagenUrl} alt="" className="h-14 w-14 rounded-lg object-cover" />
              )}
              <span
                className={`self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  p.aplicadaAt ? 'bg-success/15 text-success-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {p.aplicadaAt ? 'creada' : 'pendiente'}
              </span>
            </div>
          ))}
        </section>
      )}

      {!esCadena && (
      <section className="rounded-2xl border border-border/70 bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Lo que se crea en cada empresa
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {resumen.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border/40 py-1.5">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="text-right text-sm font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      )}

      <section className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Empresa</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Aplicada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {campana.participantes.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 text-foreground">
                  {p.company.name}
                  {!p.company.isActive && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      inactiva
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {p.error ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive"
                      title={p.error}
                    >
                      <TriangleAlert className="h-3.5 w-3.5" /> Error
                    </span>
                  ) : p.aplicadaAt ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-foreground">
                      <Check className="h-3.5 w-3.5" /> Creada
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> Pendiente
                    </span>
                  )}
                  {p.error && (
                    <p className="mt-0.5 max-w-64 truncate text-[11px] text-muted-foreground">
                      {p.error}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {p.aplicadaAt ? formatDateTime(p.aplicadaAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
