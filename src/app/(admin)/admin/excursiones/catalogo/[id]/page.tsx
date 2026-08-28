import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { excursionDetalle, actividadesParaCombo } from '@/modules/excursiones/catalogo/queries'
import {
  ESTADO_EXCURSION_LABEL,
  TONO_EXCURSION,
  type EstadoExcursion,
} from '@/modules/excursiones/catalogo/nucleo'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'
import { ExcursionForm } from '@/components/excursiones/ExcursionForm'
import { VariantesEditor } from '@/components/excursiones/VariantesEditor'
import { EstadoExcursionBotones } from '@/components/excursiones/EstadoExcursionBotones'
import { StatusChip } from '@/components/ui/status-chip'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Excursión o Combo' }

export default async function ExcursionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId
  if (!companyId) return <SinEmpresaActiva seccion="el catálogo de excursiones" />

  const { id } = await params
  const [excursion, actividades] = await Promise.all([
    excursionDetalle(companyId, id),
    actividadesParaCombo(companyId, id),
  ])
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
          <div className="mt-1 flex items-center gap-2">
            <h2 className="text-h2 text-foreground">{excursion.nombre}</h2>
            {excursion.tipoItem === 'COMBO' ? (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Combo / Paquete
              </span>
            ) : null}
          </div>
        </div>
        <StatusChip tone={TONO_EXCURSION[excursion.estado as EstadoExcursion] ?? 'neutral'}>
          {ESTADO_EXCURSION_LABEL[excursion.estado as EstadoExcursion] ?? excursion.estado}
        </StatusChip>
      </div>

      <EstadoExcursionBotones excursionId={excursion.id} estado={excursion.estado as EstadoExcursion} />

      <VariantesEditor
        excursionId={excursion.id}
        moneda={excursion.moneda}
        horariosDisponibles={excursion.horarios.map((h) => h.horaSalida)}
        variantes={excursion.variantes.map((v) => ({
          id: v.id,
          nombre: v.nombre,
          precioAdulto: String(v.precioAdulto),
          precioNino: v.precioNino != null ? String(v.precioNino) : null,
          precioResidente: v.precioResidente != null ? String(v.precioResidente) : null,
          precioNinoResidente:
            v.precioNinoResidente != null ? String(v.precioNinoResidente) : null,
          precioTurista: v.precioTurista != null ? String(v.precioTurista) : null,
          capacidad: v.capacidad,
          activa: v.activa,
          preciosDinamicosJson: v.preciosDinamicos ? JSON.stringify(v.preciosDinamicos) : undefined,
        }))}
      />

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-4 text-h3 text-foreground">Datos generales</h2>
        <ExcursionForm
          companyId={companyId}
          actividadesDisponibles={actividades}
          excursion={{
            id: excursion.id,
            nombre: excursion.nombre,
            tipoItem: excursion.tipoItem,
            actividadesComboIds: excursion.comboItems?.map((ci) => ci.actividadId) ?? [],
            comboItems: excursion.comboItems?.map((ci) => ({
              actividadId: ci.actividadId,
              horaSalida: ci.horaSalida,
              permitirSolapamiento: ci.permitirSolapamiento,
              horarioFijo: Array.isArray(ci.horarioFijo) ? ci.horarioFijo : null,
              actividad: ci.actividad ? {
                id: ci.actividad.id,
                nombre: ci.actividad.nombre,
                tipoItem: ci.actividad.tipoItem,
                horaSalida: ci.actividad.horaSalida,
                duracionMin: ci.actividad.duracionMin,
                horarios: ci.actividad.horarios,
              } : undefined,
            })) ?? [],
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
