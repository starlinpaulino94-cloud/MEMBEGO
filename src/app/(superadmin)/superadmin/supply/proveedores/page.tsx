import { ArrowLeftRight, BadgeCheck, Building2, Link2, MessageSquare, ReceiptText, TrendingUp, Truck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { MarcoSupplyV2 } from '@/components/supply-v2/marco'
import { AccionesCabeceraSupplyV2 } from '@/components/supply-v2/acciones-cabecera'
import { TarjetaIndicador } from '@/components/supply-v2/indicador'
import { BarraFiltrosSupplyV2, type ChipFiltro } from '@/components/supply-v2/filtros'
import { PaginacionSupplyV2 } from '@/components/supply-v2/paginacion'
import { TarjetaInfo } from '@/components/supply-v2/tarjeta-info'
import { Tarjeta } from '@/components/supply-v2/resumen/superficie'
import { DialogoFormulario } from '@/components/supply-v2/dialogo'
import { FormProveedor } from '@/components/supply-v2/form-proveedor'
import { TablaProveedores } from '@/components/supply-v2/proveedores/tabla-proveedores'
import { SUPPLIER_SOURCE_LABELS, SUPPLIER_STATUS_LABELS } from '@/modules/supply-v2/core/catalogo'
import { buscarProveedores, categoriasDeProveedores, resumenProveedores, type FiltroProveedores } from '@/modules/supply-v2/suppliers/queries'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proveedores · Supply' }

const RUTA = '/superadmin/supply/proveedores'
const FILAS = [10, 25, 50]

type Origen = NonNullable<FiltroProveedores['source']>
type Estado = NonNullable<FiltroProveedores['status']>
interface Filtros { q: string; origen: Origen | ''; estado: Estado | ''; categoria: string }

function href(f: Filtros & { pagina?: number; filas?: number }): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.origen) p.set('origen', f.origen)
  if (f.estado) p.set('estado', f.estado)
  if (f.categoria) p.set('categoria', f.categoria)
  if (f.filas && f.filas !== 10) p.set('filas', String(f.filas))
  if (f.pagina && f.pagina > 1) p.set('pagina', String(f.pagina))
  const qs = p.toString()
  return qs ? `${RUTA}?${qs}` : RUTA
}

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-DO')} ${n === 1 ? uno : varios}`
}

/**
 * MEMBEGO SUPPLY · Proveedores, rediseño Stitch (propuesta A): cuatro
 * indicadores, directorio filtrable por URL con RNC, categorías de sus
 * productos, total comprado y menú de acciones. El alta usa el mismo
 * formulario de siempre.
 */
export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; origen?: string; estado?: string; categoria?: string; pagina?: string; filas?: string }>
}) {
  await requireRole('SUPERADMIN')
  const sp = await searchParams
  const f: Filtros = {
    q: (sp.q ?? '').trim().slice(0, 80),
    origen: sp.origen && sp.origen in SUPPLIER_SOURCE_LABELS ? (sp.origen as Origen) : '',
    estado: sp.estado && sp.estado in SUPPLIER_STATUS_LABELS ? (sp.estado as Estado) : '',
    categoria: (sp.categoria ?? '').slice(0, 80),
  }
  const filas = FILAS.includes(Number(sp.filas)) ? Number(sp.filas) : 10
  const paginaPedida = Math.max(1, Math.floor(Number(sp.pagina)) || 1)
  const filtro: FiltroProveedores = { q: f.q, source: f.origen || null, status: f.estado || null, categoria: f.categoria || null }

  const [resumen, categorias, primera] = await Promise.all([resumenProveedores(), categoriasDeProveedores(), buscarProveedores(filtro, { pagina: paginaPedida, filas })])
  // Una página fuera de rango (p. ej. tras filtrar) cae en la última que existe.
  const pagina = Math.min(paginaPedida, Math.max(1, Math.ceil(primera.total / filas)))
  const { filas: proveedores, total } = pagina === paginaPedida ? primera : await buscarProveedores(filtro, { pagina, filas })
  const hayFiltros = Boolean(f.q || f.origen || f.estado || f.categoria)

  const chips: ChipFiltro[] = []
  if (f.q) chips.push({ texto: `Búsqueda: «${f.q}»`, quitar: href({ ...f, q: '' }) })
  if (f.origen) chips.push({ texto: `Origen: ${SUPPLIER_SOURCE_LABELS[f.origen]}`, quitar: href({ ...f, origen: '' }) })
  if (f.estado) chips.push({ texto: `Estado: ${SUPPLIER_STATUS_LABELS[f.estado]}`, quitar: href({ ...f, estado: '' }) })
  if (f.categoria) chips.push({ texto: `Categoría: ${f.categoria}`, quitar: href({ ...f, categoria: '' }) })

  /**
   * El mismo diálogo aparece en la cabecera y, sin proveedores, en el estado
   * vacío: dos botones distintos con identificadores distintos (con uno solo
   * repetido, las pruebas y los lectores de pantalla encuentran dos).
   */
  const nuevo = (testId: string) => (
    <DialogoFormulario
      etiqueta="Nuevo proveedor"
      titulo="Nuevo proveedor"
      descripcion="Una empresa que ya está en Membego o un proveedor externo."
      testId={testId}
      className="h-9 gap-1.5 rounded-[8px] bg-sv2-accent px-3 text-[13px] font-semibold leading-4 text-white shadow-sm hover:bg-sv2-accent-hover"
      icono={<span aria-hidden className="text-[18px] leading-none">+</span>}
    >
      <FormProveedor />
    </DialogoFormulario>
  )
  const pctActivos = resumen.total > 0 ? Math.round((resumen.activos / resumen.total) * 100) : 0

  return (
    <MarcoSupplyV2 activa="proveedores" contadores={{ compras: { valor: resumen.ordenesAbiertas } }} acciones={<AccionesCabeceraSupplyV2 destino={RUTA} filtro={f.q} />}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-start justify-between gap-3 @xl:flex-row @xl:items-end">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold uppercase leading-5 tracking-[0.06em]">
              <span className="font-bold text-sv2-primary">Supply</span>
              <span aria-hidden className="text-sv2-ink-variant">•</span>
              <span className="text-sv2-ink-variant">Gestión de cadena &amp; proveeduría</span>
            </div>
            <h2 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-foreground">Proveedores de Supply</h2>
            <p className="max-w-3xl text-[14px] leading-5 text-sv2-ink-variant">
              Directorio de empresas de la plataforma y proveedores externos que suministran productos, bonos y servicios.
            </p>
          </div>
          {nuevo('btn-nuevo-proveedor')}
        </div>

        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-4" data-testid="indicadores-proveedores">
          <TarjetaIndicador recuadro etiqueta="Proveedores activos" icono={BadgeCheck} tonoIcono="exito" valor={resumen.activos.toLocaleString('es-DO')} unidad={resumen.activos === 1 ? 'aliado comercial' : 'aliados comerciales'} pie={`${pctActivos}% operativos`} tonoPie={pctActivos === 100 ? 'exito' : 'neutral'} iconoPie={TrendingUp} testId="kpi-proveedores-activos" />
          <TarjetaIndicador recuadro etiqueta="Registrados en Membego" icono={Link2} tonoIcono="primario" valor={resumen.registrados.toLocaleString('es-DO')} unidad={resumen.registrados === 1 ? 'empresa integrada' : 'empresas integradas'} pie="Con cuenta en la plataforma" tonoPie="primario" testId="kpi-proveedores-registrados" />
          <TarjetaIndicador recuadro etiqueta="Proveedores externos" icono={Building2} valor={resumen.externos.toLocaleString('es-DO')} unidad={resumen.externos === 1 ? 'registrado' : 'registrados'} pie="Sin cuenta en Membego" testId="kpi-proveedores-externos" />
          <TarjetaIndicador recuadro etiqueta="Con compras abiertas" icono={Truck} tonoIcono="aviso" valor={resumen.conComprasAbiertas.toLocaleString('es-DO')} unidad={resumen.conComprasAbiertas === 1 ? 'proveedor' : 'proveedores'} pie={`${plural(resumen.ordenesAbiertas, 'orden abierta', 'órdenes abiertas')} en total`} tonoPie={resumen.ordenesAbiertas > 0 ? 'aviso' : 'neutral'} testId="kpi-proveedores-compras" />
        </div>

        <BarraFiltrosSupplyV2
          ruta={RUTA}
          variante="suave"
          testId="filtros-proveedores"
          busqueda={{ valor: f.q, etiqueta: 'Buscar proveedores', placeholder: 'Buscar por nombre, RNC/cédula, contacto, ciudad...', testId: 'buscar-proveedores' }}
          selectores={[
            { name: 'origen', etiqueta: 'Origen', valor: f.origen, opciones: Object.entries(SUPPLIER_SOURCE_LABELS).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: Object.entries(SUPPLIER_STATUS_LABELS).map(([valor, texto]) => ({ valor, texto })) },
            { name: 'categoria', etiqueta: 'Categoría', todos: 'Todas', valor: f.categoria, opciones: categorias.map((c) => ({ valor: c, texto: c })) },
          ]}
          chips={chips}
        />

        {proveedores.length === 0 ? (
          <Tarjeta className="flex flex-col items-start gap-2 p-4" data-testid="proveedores-vacio">
            <p className="text-[15px] font-semibold leading-5 text-foreground">{hayFiltros ? 'Ningún proveedor coincide con los filtros' : 'No tienes proveedores'}</p>
            <p className="text-[13px] leading-[18px] text-sv2-ink-variant">{hayFiltros ? 'Prueba con otra búsqueda o reinicia los filtros.' : 'Registra el primero: una empresa de Membego o un proveedor externo.'}</p>
            {!hayFiltros && <div className="mt-1">{nuevo('btn-nuevo-proveedor-vacio')}</div>}
          </Tarjeta>
        ) : (
          <TablaProveedores
            proveedores={proveedores}
            pie={<PaginacionSupplyV2 pagina={pagina} filas={filas} total={total} sustantivo={total === 1 ? 'proveedor registrado' : 'proveedores registrados'} href={(p, n) => href({ ...f, pagina: p, filas: n })} />}
          />
        )}

        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
          <TarjetaInfo icono={ArrowLeftRight} tono="primario" titulo="Empresas en Membego y externos">
            Una empresa de Membego se vincula a su cuenta (una sola relación por empresa); un proveedor externo se registra con sus datos de contacto.
          </TarjetaInfo>
          <TarjetaInfo icono={MessageSquare} tono="exito" titulo="WhatsApp directo">
            El número de cada proveedor abre una conversación de WhatsApp con su contacto.
          </TarjetaInfo>
          <TarjetaInfo icono={ReceiptText} tono="aviso" titulo="Facturas y pagos">
            El historial de facturas y pagos de cada proveedor está en Finanzas, filtrado por ese proveedor.
          </TarjetaInfo>
        </div>
      </div>
    </MarcoSupplyV2>
  )
}
