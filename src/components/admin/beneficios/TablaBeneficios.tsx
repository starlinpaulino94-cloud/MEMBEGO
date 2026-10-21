import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { formatDate } from '@/lib/format'
import type { FilaBeneficio, InfoTipoBeneficio } from '@/modules/ofertas/beneficios'

/**
 * La lista de UN tipo de beneficio, en la pestaña abierta (auditoría admin · fase 5, tarea 5.4). Los más recientes, con su estado
 * dicho en texto y hasta cuándo valen; el título lleva a donde se edita. «Ver todos» entra al panel de gestión del tipo, que
 * conserva sus filtros y su paginación: esta vista orienta, no los reemplaza.
 */

const COLUMNAS: Columna<FilaBeneficio>[] = [
  {
    clave: 'titulo',
    encabezado: 'Beneficio',
    celda: (f) => (
      <Link href={f.href} className="font-medium text-primary hover:underline">
        {f.titulo}
      </Link>
    ),
  },
  { clave: 'estado', encabezado: 'Estado', celda: (f) => <EstadoChip tono={f.estado.tono}>{f.estado.etiqueta}</EstadoChip> },
  { clave: 'hasta', encabezado: 'Vale hasta', tipo: 'fecha', prioridad: 2 },
]

export function TablaBeneficios({
  tipo,
  filas,
  total,
  regional,
}: {
  tipo: InfoTipoBeneficio
  filas: FilaBeneficio[]
  total: number
  regional?: { idioma?: string | null; zonaHoraria?: string | null } | null
}) {
  return (
    <Tabla
      caption={`${tipo.titulo}, las más recientes primero`}
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(f) => f.id}
      filaNavegable
      formato={{ fecha: (v) => formatDate(v, regional ?? undefined, { dateStyle: 'medium' }) }}
      vacio={{
        titulo: `Todavía no hay ${tipo.titulo.toLowerCase()}`,
        descripcion: tipo.descripcion,
        accion: (
          <Link href={tipo.crearHref} className="text-small font-medium text-primary hover:underline">
            Crear {tipo.singular.toLowerCase()}
          </Link>
        ),
      }}
      pie={
        total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {filas.length < total ? `Los ${filas.length} más recientes de ${total}` : `${total} en total`}
            </span>
            <Link href={tipo.gestionarHref} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Ver todos <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ) : undefined
      }
    />
  )
}
