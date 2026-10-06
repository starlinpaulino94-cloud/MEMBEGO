import { CalendarDays, Gauge, KeyRound, QrCode, ScanSearch, ShieldCheck, Store, Undo2, BadgeCheck, CalendarCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { cn } from '@/lib/utils'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { MONO, Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { TablaRedenciones } from '@/components/supply-v2/redenciones/tabla-redenciones'
import { RUTA_REDENCIONES } from '@/modules/supply-v2/core/catalogo'
import { buscarRedenciones, proveedoresConRedenciones, resumenRedenciones, sucursalesConRedenciones } from '@/modules/supply-v2/redemption/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Redenciones · Supply 2.0' }

const FILAS = [10, 25, 50]
const ESTADOS = { ENTREGADA: 'Entregada', REVERSADA: 'Reversada' } as const
type Estado = keyof typeof ESTADOS

interface Filtros { q: string; proveedor: string; sucursal: string; estado: Estado | ''; desde: string; hasta: string }

function fechaDe(v: string, finDeDia = false): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  if (finDeDia) d.setUTCHours(23, 59, 59, 999)
  return d
}

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.proveedor) p.set('proveedor', f.proveedor)
  if (f.sucursal) p.set('sucursal', f.sucursal)
  if (f.estado) p.set('estado', f.estado)
  if (f.desde) p.set('desde', f.desde)
  if (f.hasta) p.set('hasta', f.hasta)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA_REDENCIONES}?${qs}` : RUTA_REDENCIONES
}

const CAMPO_FECHA = 'h-10 w-full rounded-[8px] border border-sv2-border bg-card px-2 text-[14px] leading-5 text-foreground focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15'

/**
 * MEMBEGO SUPPLY 2.0 · redenciones (§63–§64), rediseño Stitch (propuesta A,
 * dirección blanca): indicadores reales, buscador por código que abre la
 * ficha, filtros por URL en la base y el registro de entregas. La reversa
 * sigue en la ficha de cada redención.
 */
export default async function RedencionesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; proveedor?: string; sucursal?: string; estado?: string; desde?: string; hasta?: string; pagina?: string; filas?: string; noencontrado?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    proveedor: sp.proveedor ?? '',
    sucursal: sp.sucursal ?? '',
    estado: sp.estado && sp.estado in ESTADOS ? (sp.estado as Estado) : '',
    desde: fechaDe(sp.desde ?? '') ? sp.desde! : '',
    hasta: fechaDe(sp.hasta ?? '') ? sp.hasta! : '',
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const paginaPedida = Math.max(1, Math.floor(Number(sp.pagina)) || 1)
  const filtro = { q: f.q, supplierId: f.proveedor || null, branchId: f.sucursal || null, estado: f.estado || null, desde: fechaDe(f.desde), hasta: fechaDe(f.hasta, true) }

  const [resumen, proveedores, sucursales, primera] = await Promise.all([
    resumenRedenciones(),
    proveedoresConRedenciones(),
    sucursalesConRedenciones(),
    buscarRedenciones(filtro, { pagina: paginaPedida, filas }),
  ])
  const pagina = Math.min(paginaPedida, Math.max(1, Math.ceil(primera.total / filas)))
  const r = pagina === paginaPedida ? primera : await buscarRedenciones(filtro, { pagina, filas })
  const hayFiltros = Boolean(f.q || f.proveedor || f.sucursal || f.estado || f.desde || f.hasta)

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.proveedor) chips.push({ texto: `Proveedor: ${proveedores.find((p) => p.id === f.proveedor)?.nombre ?? '—'}`, quitar: href({ ...f, proveedor: '' }) })
  if (f.sucursal) chips.push({ texto: `Sucursal: ${sucursales.find((s) => s.id === f.sucursal)?.nombre ?? '—'}`, quitar: href({ ...f, sucursal: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${ESTADOS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.desde) chips.push({ texto: `Desde: ${f.desde}`, quitar: href({ ...f, desde: '' }) })
  if (f.hasta) chips.push({ texto: `Hasta: ${f.hasta}`, quitar: href({ ...f, hasta: '' }) })

  const intentos = resumen.mes + resumen.incidenciasMes
  const efectividad = intentos > 0 ? Math.round((resumen.mes / intentos) * 100) : null
  const pctQr = resumen.mes > 0 ? Math.round((resumen.porQr / resumen.mes) * 100) : null
  const valorMes = Number(resumen.valorMes)

  return (
    <MarcoSupplyV2 activa="redenciones" acciones={<AccionesCabeceraSupplyV2 destino={RUTA_REDENCIONES} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(MONO, 'rounded-full border border-sv2-border bg-sv2-primary-fixed px-2 py-0.5 font-medium uppercase tracking-wide text-sv2-primary')}>Supply 2.0 • Trazabilidad &amp; entrega física</span>
            <span className="flex items-center gap-1 text-[12px] font-semibold leading-4 text-sv2-ink-variant">
              <span aria-hidden className="size-1.5 rounded-full bg-sv2-secondary" />
              Entregas confirmadas en comercios
            </span>
          </div>
          <h2 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Redenciones de Supply</h2>
          <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
            Cada entrega física de un beneficio en el comercio del proveedor: quién, dónde, cuándo y qué. Una reversa devuelve la unidad al cliente y queda registrada.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-5" data-testid="indicadores-redenciones">
          <TarjetaIndicador etiqueta="Redenciones hoy" icono={Store} tonoIcono="primario" valor={resumen.hoy.toLocaleString('es-DO')} unidad={resumen.hoy === 1 ? 'entrega' : 'entregas'} pie="Confirmadas por comercios" testId="kpi-red-hoy" />
          <TarjetaIndicador etiqueta="Total del mes" icono={CalendarCheck} tonoIcono="exito" valor={resumen.mes.toLocaleString('es-DO')} unidad={resumen.mes === 1 ? 'canje' : 'canjes'} pie={`RD$${valorMes.toLocaleString('es-DO', { maximumFractionDigits: 2 })} valor entregado`} tonoPie={valorMes > 0 ? 'exito' : 'neutral'} testId="kpi-red-mes" />
          <TarjetaIndicador etiqueta="Tasa de efectividad" icono={BadgeCheck} tonoIcono="exito" valor={efectividad === null ? '—' : `${efectividad}%`} pie={`${resumen.incidenciasMes} ${resumen.incidenciasMes === 1 ? 'incidencia' : 'incidencias'} de escaneo este mes`} tonoPie={resumen.incidenciasMes > 0 ? 'aviso' : 'neutral'} testId="kpi-red-efectividad" />
          <TarjetaIndicador etiqueta="Reversas aplicadas" icono={Undo2} tonoIcono="aviso" valor={resumen.reversasMes.toLocaleString('es-DO')} unidad={resumen.reversasMes === 1 ? 'reversa' : 'reversas'} pie="La unidad vuelve al cliente" testId="kpi-red-reversas" />
          <TarjetaIndicador etiqueta="Canal QR" icono={QrCode} tonoIcono="primario" valor={pctQr === null ? '—' : `${pctQr}%`} pie={`${resumen.porCodigo} con código manual`} testId="kpi-red-canal" />
        </div>

        <Tarjeta className="flex flex-col gap-4 p-5 @4xl:flex-row @4xl:items-center @4xl:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-sv2-accent text-white shadow-sm">
              <ScanSearch className="size-6" />
            </span>
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold leading-5">Buscar una redención</span>
                <span className="rounded-full bg-sv2-secondary-container px-2 py-0.5 text-[12px] font-semibold leading-4 text-sv2-on-secondary-container">Por código</span>
              </div>
              <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Escribe el código de la redención (MBG-RD-…) o el de la orden (MBG-SO-…) y abre su ficha con toda la trazabilidad.</p>
              {sp.noencontrado === '1' && <p className="mt-1 text-[12px] font-semibold leading-4 text-sv2-error" role="status">No hay una redención con ese código exacto; abajo ves lo que coincide.</p>}
            </div>
          </div>
          {/* Formulario normal (no `next/form`): el destino es un route handler que redirige a la ficha. */}
          <form method="get" action={`${RUTA_REDENCIONES}/buscar`} className="flex w-full items-center gap-2 @4xl:w-auto" data-testid="buscar-codigo-redencion">
            <div className="relative flex-1 @4xl:w-72">
              <KeyRound aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sv2-outline" />
              <label htmlFor="codigo-redencion" className="sr-only">Código de la redención o de la orden</label>
              <input id="codigo-redencion" name="codigo" required placeholder="Ej. MBG-RD-2026-000001" className={cn('h-10 w-full rounded-[8px] border border-sv2-border bg-card pl-9 pr-3 font-sv2-mono text-[12px] uppercase leading-4 placeholder:normal-case placeholder:text-sv2-outline focus:border-sv2-accent focus:outline-none focus:ring-2 focus:ring-sv2-accent/15')} />
            </div>
            <button type="submit" className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[8px] bg-sv2-accent px-4 text-[14px] font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-sv2-accent-hover">
              <ShieldCheck aria-hidden className="size-4" />
              Abrir ficha
            </button>
          </form>
        </Tarjeta>

        <BarraFiltrosSupplyV2
          ruta={RUTA_REDENCIONES}
          variante="suave"
          testId="filtros-redenciones"
          busqueda={{ valor: f.q, etiqueta: 'Buscar redenciones', placeholder: 'Código, orden, cliente o producto...', testId: 'buscar-redenciones' }}
          selectores={[
            { name: 'proveedor', etiqueta: 'Proveedor', valor: f.proveedor, opciones: proveedores.map((p) => ({ valor: p.id, texto: p.nombre })) },
            { name: 'sucursal', etiqueta: 'Sucursal', todos: 'Todas', valor: f.sucursal, opciones: sucursales.map((s) => ({ valor: s.id, texto: s.nombre })) },
            { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(ESTADOS).map(([valor, texto]) => ({ valor, texto })) },
          ]}
          extraEnFila
          extra={
            <div className="flex flex-1 flex-wrap items-center gap-2 @5xl:flex-nowrap">
              <CalendarDays aria-hidden className="hidden size-4 shrink-0 text-sv2-ink-variant @xl:block" />
              <label className="sr-only" htmlFor="red-desde">Desde</label>
              <input id="red-desde" type="date" name="desde" defaultValue={f.desde} className={cn(CAMPO_FECHA, 'min-w-[130px] flex-1')} aria-label="Desde" />
              <span aria-hidden className="text-sv2-outline">→</span>
              <label className="sr-only" htmlFor="red-hasta">Hasta</label>
              <input id="red-hasta" type="date" name="hasta" defaultValue={f.hasta} className={cn(CAMPO_FECHA, 'min-w-[130px] flex-1')} aria-label="Hasta" />
            </div>
          }
          chips={chips}
        />

        {r.filas.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-5" data-testid="redenciones-vacio">
            <p className="text-[15px] font-semibold leading-5">{hayFiltros ? 'Nada con esos filtros' : 'Todavía no hay entregas'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{hayFiltros ? 'Prueba con otra búsqueda o reinicia los filtros.' : 'Cuando un proveedor confirme una entrega, aparecerá aquí.'}</p>
          </Tarjeta>
        ) : (
          <TablaRedenciones
            filas={r.filas}
            total={r.total}
            pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={r.total} sustantivo={r.total === 1 ? 'entrega registrada' : 'entregas registradas'} href={(p, n) => href({ ...f, pagina: p, filas: n })} />}
          />
        )}

        <div className="grid grid-cols-1 gap-3 @5xl:grid-cols-3">
          <Tarjeta className="flex flex-col justify-between gap-4 p-5 @5xl:col-span-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="size-5 text-sv2-primary" />
                <h3 className="text-[15px] font-bold leading-5">Cómo se reversa una entrega</h3>
              </div>
              <p className="text-[14px] leading-6 text-sv2-ink-variant">
                Si la entrega no ocurrió, se reversa desde la ficha de la redención con un motivo obligatorio. El beneficio vuelve al cliente y la unidad regresa al lote; la acción queda en la bitácora.
              </p>
              <div className="grid grid-cols-1 gap-2 pt-1 @xl:grid-cols-3">
                {[
                  { paso: 'Paso 1: Abrir la ficha', texto: 'Desde la tabla, «Ver».' },
                  { paso: 'Paso 2: Motivo', texto: 'Obligatorio y auditado.' },
                  { paso: 'Paso 3: Restitución', texto: 'El beneficio vuelve a estar disponible.' },
                ].map((p) => (
                  <div key={p.paso} className="flex flex-col gap-1 rounded-[8px] bg-sv2-well p-3">
                    <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">{p.paso}</span>
                    <span className="text-[13px] font-medium leading-[18px]">{p.texto}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className={cn(MONO, 'flex items-center gap-1.5 text-sv2-outline')}>
              <Gauge aria-hidden className="size-4" />
              Una redención solo se reversa una vez; requiere el permiso de reversa.
            </p>
          </Tarjeta>
          <Tarjeta className="flex flex-col justify-between gap-3 p-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold uppercase leading-4 tracking-wider text-sv2-outline">Puntos de canje del mes</span>
                <span className={cn(MONO, 'rounded-full bg-sv2-secondary-container px-2 py-0.5 font-bold text-sv2-on-secondary-container')}>
                  {resumen.sucursales.length} {resumen.sucursales.length === 1 ? 'sucursal' : 'sucursales'}
                </span>
              </div>
              {resumen.sucursales.length === 0 ? (
                <p className="text-[13px] leading-[18px] text-sv2-ink-variant">Sin entregas con sucursal este mes.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {resumen.sucursales.map((s) => (
                    <li key={`${s.nombre}-${s.proveedor}`} className="flex items-center justify-between gap-2 rounded-[8px] bg-sv2-well px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Store aria-hidden className="size-4 text-sv2-secondary" />
                        <span className="flex flex-col">
                          <span className="text-[13px] font-medium leading-4">{s.nombre}</span>
                          <span className={cn(MONO, 'text-sv2-outline')}>{s.proveedor} · {s.entregas} {s.entregas === 1 ? 'entrega' : 'entregas'}</span>
                        </span>
                      </span>
                      <span aria-hidden className="size-2 rounded-full bg-sv2-secondary" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-center gap-1.5 rounded-[8px] bg-sv2-well px-3 py-2 text-[13px] font-medium leading-4 text-sv2-ink-variant">
              <ScanSearch aria-hidden className="size-4" />
              {resumen.incidenciasMes} {resumen.incidenciasMes === 1 ? 'incidencia' : 'incidencias'} de escaneo este mes
            </div>
          </Tarjeta>
        </div>
      </div>
    </MarcoSupplyV2>
  )
}
