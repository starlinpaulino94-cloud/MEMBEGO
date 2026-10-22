import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip, type TonoEstado } from '@/components/ui/estado-chip'
import { formatDateTime } from '@/lib/format'
import {
  CANAL_ATRIBUCION_LABEL,
  ETAPA_ATRIBUCION_LABEL,
  type CanalAtribucion,
  type EtapaAtribucion,
} from '@/modules/excursiones/atribucion/nucleo'

export interface ClienteCaptadoFila {
  id: string
  nombre: string
  telefono: string | null
  email?: string | null
  etapa: string
  canal: string | null
  createdAt: Date | string
}

/** Cuánto avanzó el cliente en el embudo: de «solo abrió el enlace» a «pagó». */
const TONO_ETAPA: Record<EtapaAtribucion, TonoEstado> = {
  VISITA: 'neutro',
  REGISTRO: 'info',
  RESERVA: 'pendiente',
  COMPRA: 'exito',
}

/**
 * LOS CLIENTES QUE CAPTÓ UN VENDEDOR, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-05, T-10).
 *
 * Era un componente de cliente con su propio formulario de filtros y su paginación a mano. Ahora la página pone la barra de
 * filtros y el pie, y esto solo pinta las filas. El canal dice cuál fue (antes todo lo que no era QR salía como «Enlace directo»,
 * también WhatsApp y redes); sin canal registrado se dice «Enlace directo», que es lo que el sistema asume por defecto.
 */
const COLUMNAS: Columna<ClienteCaptadoFila>[] = [
  { clave: 'nombre', encabezado: 'Cliente' },
  {
    clave: 'contacto',
    encabezado: 'Teléfono o correo',
    prioridad: 2,
    celda: (c) => (c.telefono ?? c.email ? <span className="font-mono text-small">{c.telefono ?? c.email}</span> : <span aria-hidden>—</span>),
  },
  {
    clave: 'etapa',
    encabezado: 'Etapa del embudo',
    celda: (c) => <EstadoChip tono={TONO_ETAPA[c.etapa as EtapaAtribucion] ?? 'neutro'}>{ETAPA_ATRIBUCION_LABEL[c.etapa as EtapaAtribucion] ?? c.etapa}</EstadoChip>,
  },
  {
    clave: 'canal',
    encabezado: 'Canal',
    prioridad: 3,
    celda: (c) => CANAL_ATRIBUCION_LABEL[(c.canal ?? 'ENLACE') as CanalAtribucion] ?? c.canal,
  },
  {
    clave: 'createdAt',
    encabezado: 'Fecha',
    alineacion: 'derecha',
    // Sin cortes de línea: a 390 px la tabla se desplaza dentro de su caja y una fecha partida en cinco renglones no se lee.
    celda: (c) => (
      <time dateTime={new Date(c.createdAt).toISOString()} className="whitespace-nowrap">
        {formatDateTime(new Date(c.createdAt))}
      </time>
    ),
  },
]

export function ClientesCaptadosTabla({
  filas,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: ClienteCaptadoFila[]
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Clientes captados por el vendedor, del más reciente al más antiguo"
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(c) => c.id}
      columnaIdentificadora="nombre"
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
