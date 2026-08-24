import Link from 'next/link'
import { ArrowLeft, ScrollText } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import {
  listadoReglas,
  opcionesParaReglas,
} from '@/modules/excursiones/comisiones/queries'
import {
  AMBITO_REGLA_LABEL,
  TIPO_CALCULO_LABEL,
  normalizarEscalones,
  type AmbitoRegla,
  type TipoCalculo,
} from '@/modules/excursiones/comisiones/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ReglaComisionForm } from '@/components/excursiones/ReglaComisionForm'
import { ReglaEstadoBoton } from '@/components/excursiones/ReglaEstadoBoton'
import { StatusChip } from '@/components/ui/status-chip'
import { formatDate } from '@/lib/format'
import { EmptyState } from '@/components/system/EmptyState'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reglas de comisión' }

/** Cómo se lee una regla de un vistazo, sin abrir nada. */
function resumenRegla(r: {
  ambito: string
  tipoCalculo: string
  valor: number
  escalones: unknown
  excursion: string | null
  vendedor: string | null
  categoria: string | null
  tipoVendedor?: string | null
}): string {
  const alcance =
    r.vendedor && r.excursion
      ? `${r.vendedor} en ${r.excursion}`
      : r.vendedor ??
        (r.tipoVendedor ? `Tipo: ${r.tipoVendedor}` : null) ??
        r.excursion ??
        r.categoria ??
        'toda la empresa'
  if (r.tipoCalculo === 'ESCALON') {
    const escalones = normalizarEscalones(r.escalones)
    const tramos = escalones
      .map((e) => `${e.desde}${e.hasta === null ? '+' : `–${e.hasta}`} pax: ${e.pct}%`)
      .join(' · ')
    return `${alcance} — ${tramos || 'sin escalones'}`
  }
  const cifra = r.tipoCalculo === 'PORCENTAJE' ? `${r.valor}%` : r.valor
  return `${alcance} — ${cifra} (${TIPO_CALCULO_LABEL[r.tipoCalculo as TipoCalculo] ?? r.tipoCalculo})`
}

export default async function ReglasComisionPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="las reglas de comisión" />

  const [reglas, opciones] = await Promise.all([
    listadoReglas(companyId),
    opcionesParaReglas(companyId),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/admin/excursiones/comisiones"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Comisiones
      </Link>
      <div>
        <h2 className="text-h2 text-foreground">Reglas de comisión</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Gana siempre la regla más específica: un vendedor en una excursión concreta pesa más
          que ese vendedor en general, que pesa más que la excursión, que pesa más que la regla
          de toda la empresa. A igual nivel, la más reciente.
        </p>
      </div>

      <ReglaComisionForm excursiones={opciones.excursiones} vendedores={opciones.vendedores} />

      {reglas.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-h3 text-foreground">Reglas definidas</h2>
          <ul className="mt-3 divide-y divide-border">
            {reglas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                    {AMBITO_REGLA_LABEL[r.ambito as AmbitoRegla] ?? r.ambito}
                  </p>
                  <p className="text-foreground">{resumenRegla(r)}</p>
                  {r.vigenciaDesde || r.vigenciaHasta ? (
                    <p className="text-caption text-muted-foreground">
                      Vigencia: {r.vigenciaDesde ? formatDate(r.vigenciaDesde) : 'sin inicio'} →{' '}
                      {r.vigenciaHasta ? formatDate(r.vigenciaHasta) : 'sin fin'}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip tone={r.activa ? 'success' : 'neutral'}>
                    {r.activa ? 'Activa' : 'Inactiva'}
                  </StatusChip>
                  <ReglaEstadoBoton reglaId={r.id} activa={r.activa} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          icon={ScrollText}
          title="Sin reglas de comisión"
          description="Crea tu primera regla arriba. Sin reglas, no se generan comisiones para los vendedores."
        />
      )}
    </div>
  )
}
