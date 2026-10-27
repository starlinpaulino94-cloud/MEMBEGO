import Link from 'next/link'
import { Tabla, type Columna } from '@/components/ui/tabla'
import { StatusChip } from '@/components/ui/status-chip'
import { dineroVisita } from '@/components/visitas-membego/detalle-visita'
import { ACCESS_STATUS_LABELS } from '@/modules/supply-v2/suppliers/acceso-dominio'
import type { scorecardDeProveedoresEnTx } from '@/modules/supply-v2/suppliers/scorecard'
import { BASE_SUPPLY_V2 } from '@/modules/supply-v2/core/catalogo'

type FilaScorecard = Awaited<ReturnType<typeof scorecardDeProveedoresEnTx>>[number]

const pct = (f: number | null) => (f == null ? '—' : `${Math.round(f * 100)} %`)
const sub = (texto: string, clase = 'text-muted-foreground') => <span className={`text-caption ${clase}`}> {texto}</span>

/**
 * EL SCORECARD DE PROVEEDORES EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1; 06 · T-01, T-06, T-15).
 *
 * Doce columnas eran demasiadas para una pantalla estrecha: el proveedor, su acceso y sus canjes siempre se ven; el resto se
 * oculta por prioridad (a 390 px quedan esas tres y la tabla se desplaza dentro de su caja, no la página). Son números para
 * conversar con cada proveedor, no una calificación: no hay colores de «bueno» o «malo».
 */
export function TablaScorecard({ filas }: { filas: FilaScorecard[] }) {
  const columnas: Columna<FilaScorecard>[] = [
    {
      clave: 'proveedor',
      encabezado: 'Proveedor',
      celda: (f) => (
        <Link href={`${BASE_SUPPLY_V2}/proveedores/${f.supplierId}`} className="hover:underline">
          {f.proveedor}
        </Link>
      ),
    },
    {
      clave: 'acceso',
      encabezado: 'Acceso',
      celda: (f) => (
        <StatusChip tone={f.accessStatus === 'ACTIVE' ? 'success' : f.accessStatus === 'SUSPENDED' || f.accessStatus === 'TERMINATED' ? 'danger' : 'warning'}>
          {ACCESS_STATUS_LABELS[f.accessStatus as keyof typeof ACCESS_STATUS_LABELS] ?? f.accessStatus}
        </StatusChip>
      ),
    },
    { clave: 'canjes', encabezado: 'Canjes', tipo: 'numero', valor: (f) => f.redenciones },
    { clave: 'reversas', encabezado: 'Reversas', tipo: 'numero', prioridad: 2, valor: (f) => f.reversadas },
    { clave: 'incidencias', encabezado: 'Incidencias', tipo: 'numero', prioridad: 2, valor: (f) => f.incidencias },
    { clave: 'visitas', encabezado: 'Visitas', tipo: 'numero', prioridad: 2, valor: (f) => f.visitas },
    {
      clave: 'conExtras',
      encabezado: 'Con extras',
      alineacion: 'derecha',
      prioridad: 3,
      celda: (f) => (
        <>
          {f.visitasConExtras}
          {sub(`(${pct(f.tasaDeExtras)})`)}
        </>
      ),
    },
    { clave: 'extras', encabezado: 'Extras', alineacion: 'derecha', prioridad: 3, celda: (f) => dineroVisita(f.extrasTotal) },
    { clave: 'comision', encabezado: 'Comisión', alineacion: 'derecha', prioridad: 3, celda: (f) => dineroVisita(f.comisionTotal) },
    {
      clave: 'confirmacion',
      encabezado: 'Confirmación',
      alineacion: 'derecha',
      prioridad: 3,
      celda: (f) => (
        <>
          {f.confirmadasPorCliente}/{f.ventasAdicionales}
          {sub(`(${pct(f.tasaDeConfirmacion)})`)}
        </>
      ),
    },
    {
      clave: 'disputas',
      encabezado: 'Disputas',
      alineacion: 'derecha',
      prioridad: 2,
      celda: (f) => (
        <>
          {f.disputas}
          {f.disputasAFavorDelCliente ? sub(`(${f.disputasAFavorDelCliente} a favor del cliente)`, 'text-warning') : null}
        </>
      ),
    },
    { clave: 'minutos', encabezado: 'Min/visita', alineacion: 'derecha', prioridad: 3, celda: (f) => f.minutosPromedioDeVisita ?? '—' },
  ]
  return (
    <Tabla
      caption="Scorecard de proveedores: canjes, incidencias, visitas, compras adicionales, confirmaciones y disputas"
      columnas={columnas}
      filas={filas}
      claveDe={(f) => f.supplierId}
      columnaIdentificadora="proveedor"
      testId="scorecard"
      testIdFila="scorecard-fila"
    />
  )
}
