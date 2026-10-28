import { requireRole } from '@/lib/auth/guards'
import { conEmpresa } from '@/lib/tenant'
import { ADMIN_ROLES } from '@/types'
import Form from 'next/form'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BotonExportar } from '@/components/ui/boton-exportar'
import { FacturaPrintDialog } from '@/components/facturas/FacturaPrintDialog'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { AnularTransaccionButton } from '@/components/registros/AnularTransaccionButton'
import {
  getRegistros,
  TIPO_LABEL,
  ESTADO_LABEL,
  METODO_LABEL,
  type RegistroFiltro,
} from '@/modules/registros/queries'
import { FileText, Search } from 'lucide-react'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { Tabla } from '@/components/ui/tabla'
import { EstadoChip, type TonoEstado } from '@/components/ui/estado-chip'
import { formatRD } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Registros' }

const TONO_COMPROBANTE: Record<string, TonoEstado> = {
  APPLIED: 'exito',
  CANCELLED: 'peligro',
  REVERTED: 'aviso',
  ERROR: 'peligro',
}

/**
 * Registros / Comprobantes (Control de comprobantes · Fase 3 · G7+G10).
 *
 * Vista unificada de TODAS las transacciones (ventas, usos de membresía,
 * promociones, beneficios, canjes, referidos…), con filtros por tipo, estado,
 * método y rango de fechas, resumen agregado, reimpresión de cualquier
 * comprobante, exportación a CSV e impresión del reporte.
 */
export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = user.metadata.companyId as string | undefined
  const sp = await searchParams

  const empresa = companyId
    ? await conEmpresa(companyId,
      (tx) => tx.company.findUnique({
          where: { id: companyId },
          select: { name: true, zonaHoraria: true },
        })
    )
    : null
  const timeZone = empresa?.zonaHoraria || 'America/Santo_Domingo'

  const filtro: RegistroFiltro = {
    q: sp.q,
    tipo: sp.tipo,
    estado: sp.estado,
    metodo: sp.metodo,
    desde: sp.desde,
    hasta: sp.hasta,
  }
  const hayFiltro = Boolean(sp.q || sp.tipo || sp.estado || sp.metodo || sp.desde || sp.hasta)

  // Paginación del servidor: con el total real se puede alcanzar CUALQUIER
  // comprobante para reimprimirlo, no solo los más recientes.
  const paginacion = leerPaginacion(sp)
  const { items, resumen, total } = await getRegistros(companyId, filtro, timeZone, {
    saltar: paginacion.saltar,
    tomar: paginacion.tomar,
  })

  const fmtFecha = (iso: string) =>
    new Intl.DateTimeFormat('es-DO', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))

  // Query string para el enlace de exportación (mismos filtros).
  const exportQs = new URLSearchParams(
    Object.entries(filtro).filter(([, v]) => v) as [string, string][]
  ).toString()

  const kpis = [
    { label: 'Ingresos (aplicados)', valor: formatRD(resumen.total) },
    { label: 'Operaciones con monto', valor: String(resumen.cantidad) },
    { label: 'Efectivo', valor: formatRD(resumen.porMetodo.efectivo) },
    { label: 'Transferencia', valor: formatRD(resumen.porMetodo.transferencia) },
    { label: 'Tarjeta', valor: formatRD(resumen.porMetodo.tarjeta) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registros y comprobantes"
        description="Todo lo que pasa por la empresa, en un solo lugar: ventas, usos, promociones, beneficios y canjes. Filtra, reimprime, exporta."
      />

      {/* Filtros */}
      <Form action="/admin/registros" className="grid grid-cols-1 gap-3 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder="Nº, código TX o cliente…" className="pl-9" />
        </div>
        <select
          name="tipo"
          aria-label="Tipo"
          defaultValue={sp.tipo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          name="estado"
          aria-label="Estado"
          defaultValue={sp.estado ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          name="metodo"
          aria-label="Método de pago"
          defaultValue={sp.metodo ?? ''}
          className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos los métodos</option>
          {Object.entries(METODO_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Desde</span>
          <Input type="date" name="desde" defaultValue={sp.desde ?? ''} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="whitespace-nowrap">Hasta</span>
          <Input type="date" name="hasta" defaultValue={sp.hasta ?? ''} />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" variant="secondary" className="flex-1">Aplicar</Button>
          {hayFiltro && (
            <Button asChild variant="ghost">
              <a href="/admin/registros">Limpiar</a>
            </Button>
          )}
        </div>
      </Form>

      {/* Resumen (KPIs) */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/70 bg-card p-4">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">{k.valor}</dd>
          </div>
        ))}
      </dl>

      {/* Acciones del reporte */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString('es-DO')} registro{total !== 1 ? 's' : ''}
          {hayFiltro ? ' con estos filtros' : ''}.
        </p>
        <div className="flex flex-wrap gap-2">
          <BotonExportar
            href={`/admin/registros/export${exportQs ? `?${exportQs}` : ''}`}
            variant="outline"
            size="sm"
          />
          {items.length > 0 && <BotonImprimir variant="outline" label="Imprimir reporte" />}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title={hayFiltro ? 'Sin registros para el filtro' : 'Aún no hay registros'}
          description="Cada operación (venta, uso, promoción, beneficio o canje) queda aquí con su comprobante, para siempre."
        />
      ) : (
        <Tabla
          caption="Comprobantes"
          claveDe={(r) => r.id}
          filas={items}
          columnas={[
            {
              clave: 'comprobante',
              encabezado: 'Comprobante',
              celda: (r) => (
                <>
                  <span className="block font-mono font-semibold text-foreground">{r.ticketNumero}</span>
                  <span className="block font-mono text-caption font-normal text-muted-foreground">{r.codigo}</span>
                  <span className="block text-caption font-normal text-muted-foreground">
                    {r.tipoLabel} · <time dateTime={new Date(r.fecha).toISOString()}>{fmtFecha(r.fecha)}</time>
                  </span>
                </>
              ),
            },
            {
              clave: 'cliente',
              encabezado: 'Cliente',
              celda: (r) => (
                <>
                  <span className="block whitespace-nowrap">{r.cliente ?? '—'}</span>
                  {r.empleado ? <span className="block whitespace-nowrap text-caption text-muted-foreground">Atendió {r.empleado}</span> : null}
                </>
              ),
            },
            {
              clave: 'detalle',
              encabezado: 'Detalle',
              prioridad: 3,
              celda: (r) => (
                <div className="max-w-40">
                  <p className="truncate text-foreground">{r.detalle ?? '—'}</p>
                  <p className="truncate text-caption text-muted-foreground">
                    {r.metodoCobro ? METODO_LABEL[r.metodoCobro] ?? r.metodoCobro : (r.esEntrega ? 'Sin costo' : '')}
                    {r.sucursal ? ` · ${r.sucursal}` : ''}
                  </p>
                </div>
              ),
            },
            {
              clave: 'monto',
              encabezado: 'Monto',
              alineacion: 'derecha',
              celda: (r) => <span className="font-semibold text-foreground">{r.monto == null ? '—' : formatRD(r.monto)}</span>,
            },
            { clave: 'estado', encabezado: 'Estado', celda: (r) => <EstadoChip tono={TONO_COMPROBANTE[r.estado] ?? 'neutro'}>{r.estadoLabel}</EstadoChip> },
            {
              clave: 'acciones',
              encabezado: 'Acciones',
              soloLector: true,
              celda: (r) => (
                <div className="flex flex-col items-end gap-1">
                  <FacturaPrintDialog transactionId={r.id} yaImpresa={r.impresiones > 0} />
                  {r.estado === 'APPLIED' && <AnularTransaccionButton transactionId={r.id} referencia={r.ticketNumero} />}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Paginación: los filtros activos viajan en cada enlace. Sin esto, los
          comprobantes más viejos que la primera página eran inalcanzables. */}
      {items.length > 0 && (
        <TablaPaginacion
          paginacion={paginacion}
          total={total}
          params={sp}
          etiqueta="registros"
        />
      )}

      {/* LA VERSIÓN DE PAPEL, que es distinta de la de pantalla a propósito:
          la tabla de arriba tiene nueve columnas y 860 px de ancho mínimo, y en
          A4 sale cortada. El `@media print` ya no vive aquí — lo pone
          `ReporteImprimible`, que es el único sitio del panel donde está
          escrito. Eran cinco copias del mismo truco de CSS. */}
      {items.length > 0 && (
        <ReporteImprimible
          soloPapel
          titulo={`${empresa?.name ?? 'MembeGo'} · Reporte de registros`}
          subtitulo={`${items.length} de ${total} registros${hayFiltro ? ' (con filtros aplicados)' : ''}`}
          generadoEn={fmtFecha(new Date().toISOString())}
        >
          <div className="my-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span><strong>Ingresos:</strong> {formatRD(resumen.total)}</span>
            <span><strong>Operaciones:</strong> {resumen.cantidad}</span>
            <span><strong>Efectivo:</strong> {formatRD(resumen.porMetodo.efectivo)}</span>
            <span><strong>Transferencia:</strong> {formatRD(resumen.porMetodo.transferencia)}</span>
            <span><strong>Otro:</strong> {formatRD(resumen.porMetodo.otro)}</span>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 pr-2">Fecha</th>
                <th className="py-1 pr-2">Comprobante</th>
                <th className="py-1 pr-2">Tipo</th>
                <th className="py-1 pr-2">Cliente</th>
                <th className="py-1 pr-2">Empleado</th>
                <th className="py-1 pr-2 text-right">Monto</th>
                <th className="py-1 pr-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-black/20">
                  <td className="py-0.5 pr-2 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                  <td className="py-0.5 pr-2 font-mono">{r.ticketNumero}</td>
                  <td className="py-0.5 pr-2">{r.tipoLabel}</td>
                  <td className="py-0.5 pr-2">{r.cliente ?? '—'}</td>
                  <td className="py-0.5 pr-2">{r.empleado ?? '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{r.monto == null ? '—' : formatRD(r.monto)}</td>
                  <td className="py-0.5 pr-2">{r.estadoLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReporteImprimible>
      )}
    </div>
  )
}

