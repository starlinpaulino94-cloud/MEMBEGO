import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { excursionDetalle } from '@/modules/excursiones/catalogo/queries'
import {
  ESTADO_EXCURSION_LABEL,
  TONO_EXCURSION,
  type EstadoExcursion,
} from '@/modules/excursiones/catalogo/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ExcursionForm } from '@/components/excursiones/ExcursionForm'
import { VariantesEditor } from '@/components/excursiones/VariantesEditor'
import { HorariosEditor } from '@/components/excursiones/HorariosEditor'
import { EstadoExcursionBotones } from '@/components/excursiones/EstadoExcursionBotones'
import { StatusChip } from '@/components/ui/status-chip'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Excursión' }

export default async function ExcursionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de excursiones" />

  const { id } = await params
  const excursion = await excursionDetalle(companyId, id)
  if (!excursion) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/excursiones/catalogo"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Catálogo
          </Link>
          <h2 className="mt-1 text-h2 text-foreground">{excursion.nombre}</h2>
        </div>
        <StatusChip tone={TONO_EXCURSION[excursion.estado as EstadoExcursion] ?? 'neutral'}>
          {ESTADO_EXCURSION_LABEL[excursion.estado as EstadoExcursion] ?? excursion.estado}
        </StatusChip>
      </div>

      <EstadoExcursionBotones excursionId={excursion.id} estado={excursion.estado as EstadoExcursion} />

      <VariantesEditor
        excursionId={excursion.id}
        moneda={excursion.moneda}
        variantes={excursion.variantes.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          precioAdulto: String(v.precioAdulto),
          precioNino: v.precioNino != null ? String(v.precioNino) : null,
          precioResidente: v.precioResidente != null ? String(v.precioResidente) : null,
          precioTurista: v.precioTurista != null ? String(v.precioTurista) : null,
          capacidad: v.capacidad,
          activa: v.activa,
        }))}
      />

      <HorariosEditor
        excursionId={excursion.id}
        horarios={excursion.horarios.map((h) => ({
          id: h.id,
          diasSemana: h.diasSemana,
          horaSalida: h.horaSalida,
          cupo: h.cupo,
        }))}
      />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-h3 text-foreground">Datos generales</h2>
        <ExcursionForm
          companyId={companyId}
          excursion={{
            id: excursion.id,
            nombre: excursion.nombre,
            descripcion: excursion.descripcion,
            portadaUrl: excursion.portadaUrl,
            // `galeria` es JSON en el esquema: se normaliza aquí, en el
            // borde, para que el formulario reciba el string[] que declara.
            galeria: Array.isArray(excursion.galeria)
              ? (excursion.galeria as string[])
              : null,
            duracionMin: excursion.duracionMin,
            ubicacion: excursion.ubicacion,
            categoria: excursion.categoria,
            moneda: excursion.moneda,
            impuestoPct: excursion.impuestoPct != null ? String(excursion.impuestoPct) : null,
            capacidad: excursion.capacidad,
            puntoSalida: excursion.puntoSalida,
            horaSalida: excursion.horaSalida,
            horaRegreso: excursion.horaRegreso,
            incluye: excursion.incluye,
            noIncluye: excursion.noIncluye,
            politicas: excursion.politicas,
            horarios: excursion.horarios.map((h) => ({
              id: h.id,
              horaSalida: h.horaSalida,
              diasSemana: h.diasSemana,
              cupo: h.cupo,
            })),
          }}
        />
      </section>
    </div>
  )
}
