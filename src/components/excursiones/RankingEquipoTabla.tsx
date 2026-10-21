import Link from 'next/link'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { formatMoney } from '@/lib/format'

export interface FilaRanking {
  id: string
  nombre: string
  codigo: string
  captados: number
  ventas: number
  pasajeros: number
  ingresos: number
  moneda: string
}

/**
 * EL EQUIPO EN EL PERÍODO, EN LA `Tabla` DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * El vendedor es el identificador de la fila (con su código en monoespaciada), los conteos van a la derecha con cifras tabulares y
 * los ingresos dicen su moneda en el encabezado de la página que los llama (cada fila lleva la suya).
 */
export function RankingEquipoTabla({ filas, monedaDefecto }: { filas: FilaRanking[]; monedaDefecto: string }) {
  const columnas: Columna<FilaRanking>[] = [
    {
      clave: 'vendedor',
      encabezado: 'Vendedor',
      celda: (v) => (
        <>
          <Link href={`/admin/excursiones/vendedores/${v.id}`} className="font-medium text-primary hover:underline">
            {v.nombre}
          </Link>
          <span className="ml-1.5 font-mono text-caption text-muted-foreground">{v.codigo}</span>
        </>
      ),
    },
    { clave: 'captados', encabezado: 'Captados', tipo: 'numero' },
    { clave: 'ventas', encabezado: 'Ventas', tipo: 'numero' },
    { clave: 'pasajeros', encabezado: 'Pasajeros', tipo: 'numero', prioridad: 2 },
    {
      clave: 'ingresos',
      encabezado: `Ingresos (${monedaDefecto})`,
      alineacion: 'derecha',
      celda: (v) => formatMoney(v.ingresos, { moneda: v.moneda }, 2),
    },
  ]
  return (
    <Tabla
      caption="Equipo de vendedores en este período, por ingresos"
      columnas={columnas}
      filas={filas}
      claveDe={(v) => v.id}
      columnaIdentificadora="vendedor"
      filaNavegable
    />
  )
}
