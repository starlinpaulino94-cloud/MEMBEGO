import Link from 'next/link'
import Form from 'next/form'
import { Button } from '@/components/ui/button'
import { paramsDeRango, type Rango } from '@/modules/reportes/rango'

/**
 * Filtro por sucursal —y, donde aplica, por empleado— de un reporte.
 *
 * Es un formulario GET a la misma página: el filtro viaja en la URL junto al
 * rango, así que se comparte, se guarda y la exportación se lleva el mismo
 * corte. El rango sobrevive en campos ocultos para que filtrar no lo pierda,
 * exactamente el mismo pacto que los filtros del detalle de membresías.
 *
 * Nació para Operación y lo comparte Finanzas (que solo pasa sucursales): el
 * desplegable de empleados solo llega aquí si quien mira tiene `ver_empleados`,
 * y la consulta además lo re-comprueba por su cuenta, porque un formulario
 * escondido nunca es una barrera.
 */
export function FiltroReporteForm({
  accion,
  rango,
  sucursales,
  sucursalId,
  empleados = null,
  empleadoId = '',
}: {
  /** Ruta del reporte al que filtra (y a la que apunta «Limpiar»). */
  accion: string
  rango: Rango
  sucursales: { id: string; nombre: string }[]
  /** La sucursal APLICADA (ya validada por la consulta), no la pedida. */
  sucursalId: string
  /** `null` = sin desplegable de personas (sin permiso, o el reporte no lo tiene). */
  empleados?: { id: string; name: string }[] | null
  empleadoId?: string
}) {
  // Nada que filtrar: un desplegable con una sola opción «Todas» es ruido.
  if (sucursales.length === 0 && (empleados?.length ?? 0) === 0) return null

  const qs = paramsDeRango(rango)
  const rangoOculto = [...new URLSearchParams(qs ? qs.slice(1) : '').entries()]
  const hayFiltro = Boolean(sucursalId || empleadoId)

  return (
    <Form
      action={accion}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
    >
      {rangoOculto.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {sucursales.length > 0 && (
        <select
          name="sucursal"
          defaultValue={sucursalId}
          aria-label="Filtrar por sucursal"
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Todas las sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      )}
      {empleados && empleados.length > 0 && (
        <select
          name="empleado"
          defaultValue={empleadoId}
          aria-label="Filtrar por empleado"
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        >
          <option value="">Todos los empleados</option>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" variant="secondary" size="sm">
        Filtrar
      </Button>
      {hayFiltro && (
        <Button asChild variant="ghost" size="sm">
          <Link href={`${accion}${qs}`}>Limpiar</Link>
        </Button>
      )}
    </Form>
  )
}
