import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { Badge } from '@/components/ui/badge'
import { ESTADO_EXCURSION_LABEL, type EstadoExcursion } from '@/modules/excursiones/catalogo/nucleo'
import { tonoDeExcursion } from '@/modules/excursiones/catalogo/lista'
import { formatPrice } from '@/lib/format'

export interface ActividadFila {
  id: string
  nombre: string
  tipoItem: string | null
  categoria: string | null
  moneda: string
  estado: string
  /** El precio de adulto de la primera variante activa, o `null` si no tiene. */
  precioDesde: number | null
  variantes: number
  horarios: number
  /** Cuántas actividades componen el combo (si es un combo). */
  enCombo: number
}

/**
 * EL CATÁLOGO DE ACTIVIDADES, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-10, T-15).
 *
 * La actividad es el identificador de la fila (y su enlace a la edición), «Desde» va a la derecha con cifras tabulares en la
 * moneda de la actividad, y las columnas de menos prioridad se ocultan en pantallas estrechas sin dejar fuera el estado.
 */
const COLUMNAS: Columna<ActividadFila>[] = [
  {
    clave: 'nombre',
    encabezado: 'Actividad',
    celda: (e) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/excursiones/catalogo/${e.id}`} className="font-semibold text-primary hover:underline">
          {e.nombre}
        </Link>
        {e.tipoItem === 'COMBO' ? <Badge variant="info">Combo ({e.enCombo})</Badge> : null}
      </span>
    ),
  },
  { clave: 'categoria', encabezado: 'Categoría', prioridad: 2 },
  {
    clave: 'precioDesde',
    encabezado: 'Desde',
    alineacion: 'derecha',
    celda: (e) =>
      e.precioDesde != null ? (
        formatPrice(e.precioDesde, { moneda: e.moneda }, 2)
      ) : (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">Sin precio</span>
        </>
      ),
  },
  { clave: 'variantes', encabezado: 'Variantes', tipo: 'numero', prioridad: 3 },
  { clave: 'horarios', encabezado: 'Horarios', tipo: 'numero', prioridad: 3 },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (e) => <EstadoChip tono={tonoDeExcursion(e.estado)}>{ESTADO_EXCURSION_LABEL[e.estado as EstadoExcursion] ?? e.estado}</EstadoChip>,
  },
]

export function CatalogoTabla({
  filas,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: ActividadFila[]
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Actividades del catálogo, por estado y nombre"
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(e) => e.id}
      columnaIdentificadora="nombre"
      filaNavegable
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
