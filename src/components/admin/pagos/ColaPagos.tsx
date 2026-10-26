import { Clock, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import type { ConteoColasPago } from '@/modules/pagos/colasConteo'
import type { DatosCola, PaginacionesColas } from '@/modules/pagos/colasLectura'
import { cortarSucursal, unirSeguimiento } from '@/modules/pagos/colasMezcla'
import { TarjetaPagoPendiente } from './TarjetaPagoPendiente'
import { TarjetaSucursalCompra, TarjetaSucursalMembresia } from './TarjetasSucursal'
import { TarjetaCambioPlan, TarjetaCompraPendiente } from './TarjetasCompraYCambio'
import { TablaSeguimiento } from './TablaSeguimiento'

/**
 * UNA COLA DE PAGOS, la que se está mirando (auditoría admin · fase 5, tarea 5.2).
 *
 * Recibe lo que `leerCola` trajo y la pinta con su título, sus tarjetas y su paginación. No consulta nada ni decide nada de
 * dinero: los recuentos vienen de `contarColasDePago` (el mismo que el aviso del Resumen) y las acciones son los botones de
 * siempre. Solo se pinta si la cola tiene trabajo; la pantalla dice aparte cuando no.
 */

interface Props {
  datos: DatosCola
  conteos: ConteoColasPago
  paginaciones: PaginacionesColas
  /** Parámetros de la URL, para que paginar una cola no mueva a las demás. */
  params: Record<string, string | undefined>
  fmtMoney: (n: number) => string
  esSuperadmin: boolean
}

function Seccion({ titulo, icono, children }: { titulo: string; icono?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-h4 text-foreground">
        {icono}
        {titulo}
      </h2>
      {children}
    </div>
  )
}

export function ColaPagos({ datos, conteos, paginaciones, params, fmtMoney, esSuperadmin }: Props) {
  const comun = { fmtMoney, esSuperadmin }

  if (datos.cola === 'sucursal' && conteos.sucursal > 0) {
    const { membresias, compras } = cortarSucursal(datos.membresias, datos.compras, datos.totalMembresias, paginaciones.suc)
    return (
      <Seccion titulo={`Pagos en sucursal por confirmar (${conteos.sucursal})`} icono={<Store className="h-4 w-4 text-primary" aria-hidden />}>
        <div className="grid gap-4 md:grid-cols-2">
          {membresias.map((m) => <TarjetaSucursalMembresia key={m.id} m={m} {...comun} />)}
          {compras.map((c) => <TarjetaSucursalCompra key={c.id} c={c} {...comun} />)}
        </div>
        <TablaPaginacion paginacion={paginaciones.suc} total={conteos.sucursal} params={params} etiqueta="pagos en sucursal" clave="suc" />
      </Seccion>
    )
  }

  if (datos.cola === 'compras' && conteos.compras > 0) {
    return (
      <Seccion titulo={`Compras de promociones (${conteos.compras})`}>
        <div className="grid gap-4 md:grid-cols-2">
          {datos.filas.map((c) => <TarjetaCompraPendiente key={c.id} c={c} {...comun} />)}
        </div>
        <TablaPaginacion paginacion={paginaciones.pr} total={conteos.compras} params={params} etiqueta="compras" clave="pr" />
      </Seccion>
    )
  }

  if (datos.cola === 'cambios' && conteos.cambios > 0) {
    return (
      <Seccion titulo={`Cambios de plan solicitados (${conteos.cambios})`}>
        <div className="grid gap-4 md:grid-cols-2">
          {datos.filas.map((c) => <TarjetaCambioPlan key={c.id} c={c} {...comun} />)}
        </div>
        <TablaPaginacion paginacion={paginaciones.cp} total={conteos.cambios} params={params} etiqueta="cambios de plan" clave="cp" />
      </Seccion>
    )
  }

  if (datos.cola === 'transferencias' && conteos.transferencias > 0) {
    return (
      <Seccion titulo={`Transferencias por validar (${conteos.transferencias})`}>
        <div className="grid gap-6 md:grid-cols-2">
          {datos.filas.map((m) => <TarjetaPagoPendiente key={m.id} m={m} {...comun} />)}
        </div>
        <TablaPaginacion paginacion={paginaciones.tr} total={conteos.transferencias} params={params} etiqueta="transferencias" clave="tr" />
      </Seccion>
    )
  }

  if (datos.cola === 'seguimiento' && conteos.seguimiento > 0) {
    return (
      <Seccion titulo={`Seguimiento · no completaron su pago (${conteos.seguimiento})`} icono={<Clock className="h-4 w-4 text-warning" aria-hidden />}>
        <TablaSeguimiento filas={unirSeguimiento(datos.membresias, datos.compras, paginaciones.seg)} fmtMoney={fmtMoney} />
        <TablaPaginacion paginacion={paginaciones.seg} total={conteos.seguimiento} params={params} etiqueta="en seguimiento" clave="seg" />
      </Seccion>
    )
  }

  return null
}
