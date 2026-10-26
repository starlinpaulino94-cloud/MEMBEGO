import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { ESTADO_RESERVA_LABEL, type EstadoReserva } from '@/modules/excursiones/reservas/nucleo'
import { tonoDeReserva } from '@/modules/excursiones/reservas/lista'
import { formatDate, formatMoney } from '@/lib/format'

export interface ReservaFila {
  id: string
  numero: string
  cliente: string
  excursion: string
  fecha: Date | string
  hora: string | null
  pasajeros: number
  total: number
  saldo: number
  moneda: string
  vendedor: string | null
  estado: string
}

/**
 * LAS RESERVAS, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-08, T-10, T-15).
 *
 * Era una tabla escrita a mano dentro de un componente de cliente. Ahora: `caption` y `scope`, el número de la reserva como
 * identificador de la fila (y su enlace al expediente), dinero a la derecha con cifras tabulares, la fecha en `<time>`, el estado
 * como chip con su texto y las columnas de menos prioridad ocultas en pantallas estrechas SIN dejar fuera el estado.
 *
 * Sin estado ni efectos: la búsqueda, el filtro y la página los lee la pantalla de la URL.
 */
const COLUMNAS: Columna<ReservaFila>[] = [
  {
    clave: 'numero',
    encabezado: 'Número',
    celda: (r) => (
      <Link href={`/admin/excursiones/reservas/${r.id}`} className="font-mono font-semibold text-primary hover:underline">
        {r.numero}
      </Link>
    ),
  },
  { clave: 'cliente', encabezado: 'Cliente' },
  { clave: 'excursion', encabezado: 'Excursión', prioridad: 2 },
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    celda: (r) => {
      const d = r.fecha instanceof Date ? r.fecha : new Date(r.fecha)
      return (
        <span className="whitespace-nowrap">
          <time dateTime={d.toISOString()}>{formatDate(r.fecha)}</time>
          {r.hora ? ` · ${r.hora}` : ''}
        </span>
      )
    },
  },
  { clave: 'pasajeros', encabezado: 'Pax', tipo: 'numero', prioridad: 3 },
  { clave: 'total', encabezado: 'Total', alineacion: 'derecha', celda: (r) => formatMoney(r.total, { moneda: r.moneda }, 2) },
  {
    clave: 'saldo',
    encabezado: 'Saldo',
    alineacion: 'derecha',
    celda: (r) =>
      r.saldo > 0 ? (
        formatMoney(r.saldo, { moneda: r.moneda }, 2)
      ) : (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">Sin saldo</span>
        </>
      ),
  },
  { clave: 'vendedor', encabezado: 'Vendedor', prioridad: 2, celda: (r) => r.vendedor ?? 'Directa' },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (r) => <EstadoChip tono={tonoDeReserva(r.estado)}>{ESTADO_RESERVA_LABEL[r.estado as EstadoReserva] ?? r.estado}</EstadoChip>,
  },
]

export function ReservasTabla({
  filas,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: ReservaFila[]
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Reservas de excursiones, las más recientes primero"
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(r) => r.id}
      columnaIdentificadora="numero"
      filaNavegable
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
