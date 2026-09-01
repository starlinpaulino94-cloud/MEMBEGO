'use client'

/**
 * Elegir el período y filtros multicriterio para visualizar y descargar reportes.
 * El formulario navega con GET para que el período y los filtros queden en la URL:
 * así un reporte se puede guardar en favoritos o mandar por chat, y quien lo abra
 * ve exactamente el mismo reporte.
 */

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Download, Filter, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TIPOS_VENDEDOR_SEMILLA } from '@/modules/excursiones/vendedores/nucleo'

export function ReporteDescarga({
  desde,
  hasta,
  vendedorId = 'TODOS',
  tipoVendedor = 'TODOS',
  excursionId = 'TODAS',
  canal = 'TODOS',
  estado = 'TODOS',
  etiqueta,
  vendedores = [],
  excursiones = [],
}: {
  desde: string
  hasta: string
  vendedorId?: string
  tipoVendedor?: string
  excursionId?: string
  canal?: string
  estado?: string
  etiqueta: string
  vendedores?: { id: string; nombre: string; codigo: string; tipo?: string | null }[]
  excursiones?: { id: string; nombre: string; tipoItem?: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [d, setD] = useState(desde)
  const [h, setH] = useState(hasta)
  const [vId, setVId] = useState(vendedorId)
  const [tVend, setTVend] = useState(tipoVendedor)
  const [excId, setExcId] = useState(excursionId)
  const [can, setCan] = useState(canal)
  const [est, setEst] = useState(estado)

  const selectedVendor = vendedores.find((v) => v.id === vId)
  const autoTipo = selectedVendor?.tipo ?? null

  const buildQuery = () => {
    const params = new URLSearchParams()
    if (d) params.set('desde', d)
    if (h) params.set('hasta', h)
    if (vId && vId !== 'TODOS') params.set('vendedorId', vId)
    if (tVend && tVend !== 'TODOS') params.set('tipoVendedor', tVend)
    if (excId && excId !== 'TODAS') params.set('excursionId', excId)
    if (can && can !== 'TODOS') params.set('canal', can)
    if (est && est !== 'TODOS') params.set('estado', est)
    const qs = params.toString()
    return qs ? `?${qs}` : ''
  }

  const query = buildQuery()

  const limpiarFiltros = () => {
    setD('')
    setH('')
    setVId('TODOS')
    setTVend('TODOS')
    setExcId('TODAS')
    setCan('TODOS')
    setEst('TODOS')
    router.push(pathname)
  }

  const hayFiltrosActivos =
    Boolean(d || h || vId !== 'TODOS' || tVend !== 'TODOS' || excId !== 'TODAS' || can !== 'TODOS' || est !== 'TODOS')

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h3 className="text-h3 text-foreground">Filtros del reporte</h3>
          <p className="text-caption text-muted-foreground">
            Período: <span className="font-semibold text-foreground">{etiqueta}</span>
          </p>
        </div>
        {hayFiltrosActivos && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={limpiarFiltros}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restablecer filtros
          </Button>
        )}
      </div>

      <form method="GET" className="space-y-3">
        {/* Rango de Fechas */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="rep-desde" className="text-xs">Fecha Desde</Label>
            <Input
              id="rep-desde"
              name="desde"
              type="date"
              value={d}
              onChange={(e) => setD(e.target.value)}
              className="mt-1 h-9 text-xs"
            />
          </div>
          <div>
            <Label htmlFor="rep-hasta" className="text-xs">Fecha Hasta</Label>
            <Input
              id="rep-hasta"
              name="hasta"
              type="date"
              value={h}
              onChange={(e) => setH(e.target.value)}
              className="mt-1 h-9 text-xs"
            />
          </div>
        </div>

        {/* Filtros de Vendedor y Tipo */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="rep-vendedor" className="text-xs">Vendedor</Label>
            <select
              id="rep-vendedor"
              name="vendedorId"
              value={vId}
              onChange={(e) => {
                setVId(e.target.value)
                if (e.target.value === 'TODOS') setTVend('TODOS')
              }}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground"
            >
              <option value="TODOS">Todos los vendedores</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre} ({v.codigo})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="rep-tipo-vendedor" className="text-xs">Tipo de Vendedor</Label>
            <select
              id="rep-tipo-vendedor"
              name="tipoVendedor"
              value={autoTipo && vId !== 'TODOS' ? autoTipo : tVend}
              onChange={(e) => setTVend(e.target.value)}
              disabled={vId !== 'TODOS' && Boolean(autoTipo)}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground"
            >
              <option value="TODOS">Todos los tipos (Promotores, Touroperadores, etc.)</option>
              {TIPOS_VENDEDOR_SEMILLA.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Filtros de Producto, Canal y Estado */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="rep-excursion" className="text-xs">Excursión / Combo</Label>
            <select
              id="rep-excursion"
              name="excursionId"
              value={excId}
              onChange={(e) => setExcId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground"
            >
              <option value="TODAS">Todo el catálogo</option>
              {excursiones.map((exc) => (
                <option key={exc.id} value={exc.id}>
                  {exc.tipoItem === 'COMBO' ? '📦 ' : '🎯 '} {exc.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="rep-canal" className="text-xs">Canal</Label>
            <select
              id="rep-canal"
              name="canal"
              value={can}
              onChange={(e) => setCan(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground"
            >
              <option value="TODOS">Todos los canales</option>
              <option value="ONLINE">Online / QR</option>
              <option value="RECEPCION">Recepción / Mostrador</option>
              <option value="B2B">B2B / Touroperador</option>
            </select>
          </div>

          <div>
            <Label htmlFor="rep-estado" className="text-xs">Estado de Venta</Label>
            <select
              id="rep-estado"
              name="estado"
              value={est}
              onChange={(e) => setEst(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground"
            >
              <option value="TODOS">Todas (Excepto Canceladas)</option>
              <option value="CONFIRMADA">Confirmadas</option>
              <option value="COMPLETADA">Completadas</option>
              <option value="CANCELADA">Canceladas</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <Button type="submit" size="sm" className="text-xs">
            <Filter className="mr-1.5 h-3.5 w-3.5" /> Aplicar filtros al panel
          </Button>

          <Button asChild size="sm" variant="outline" className="gap-2 text-xs">
            <a href={`/admin/excursiones/reportes/exportar${query}`}>
              <Download className="h-3.5 w-3.5" /> Descargar CSV con estos filtros
            </a>
          </Button>
        </div>
      </form>
    </section>
  )
}
