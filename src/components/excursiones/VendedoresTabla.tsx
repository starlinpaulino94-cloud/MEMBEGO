import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { EstadoChip } from '@/components/ui/estado-chip'
import { ESTADO_VENDEDOR_LABEL, type EstadoVendedor } from '@/modules/excursiones/vendedores/nucleo'
import { tonoDeVendedor } from '@/modules/excursiones/vendedores/lista'

export interface VendedorFila {
  id: string
  nombre: string
  apellido: string | null
  codigo: string
  tipo: string | null
  telefono: string | null
  estado: string
  _count: { atribuciones: number }
}

/**
 * LOS VENDEDORES, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-10, T-15).
 *
 * El vendedor es el identificador de la fila (y su enlace al perfil), el código va en monoespaciada para poder dictarlo, y tipo,
 * teléfono y captados se ocultan en pantallas estrechas sin dejar fuera el estado.
 */
const COLUMNAS: Columna<VendedorFila>[] = [
  {
    clave: 'nombre',
    encabezado: 'Vendedor',
    celda: (v) => (
      <Link href={`/admin/excursiones/vendedores/${v.id}`} className="font-semibold text-primary hover:underline">
        {`${v.nombre} ${v.apellido ?? ''}`.trim()}
      </Link>
    ),
  },
  { clave: 'codigo', encabezado: 'Código', celda: (v) => <span className="font-mono">{v.codigo}</span> },
  { clave: 'tipo', encabezado: 'Tipo', prioridad: 2 },
  { clave: 'telefono', encabezado: 'Teléfono', prioridad: 2 },
  { clave: 'captados', encabezado: 'Captados', tipo: 'numero', prioridad: 3, valor: (v) => v._count.atribuciones },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (v) => <EstadoChip tono={tonoDeVendedor(v.estado)}>{ESTADO_VENDEDOR_LABEL[v.estado as EstadoVendedor] ?? v.estado}</EstadoChip>,
  },
]

export function VendedoresTabla({
  filas,
  vacio,
  sinResultados,
  hayFiltros,
  pie,
}: {
  filas: VendedorFila[]
  vacio: { titulo: string; descripcion?: string; accion?: ReactNode }
  sinResultados: { titulo: string; descripcion?: string; accion?: ReactNode }
  hayFiltros: boolean
  pie?: ReactNode
}) {
  return (
    <Tabla
      caption="Equipo de vendedores, por estado y nombre"
      columnas={COLUMNAS}
      filas={filas}
      claveDe={(v) => v.id}
      columnaIdentificadora="nombre"
      filaNavegable
      vacio={vacio}
      sinResultados={sinResultados}
      hayFiltros={hayFiltros}
      pie={pie}
    />
  )
}
