/**
 * GALERÍA DE LAS PRIMITIVAS DEL PANEL (docs/auditoria-admin/12, fase 4).
 *
 * Las primitivas de la fase 4 todavía no las usa ninguna pantalla (es lo que la fase pide), así que no hay dónde verlas. Este
 * script renderiza el HTML REAL de cada una —el mismo `renderToStaticMarkup` que usan las pruebas— y lo junta con el CSS REAL
 * de Tailwind compilado desde `globals.css`, en una página estática. Muestra además el efecto del ámbito `.panel-ds`
 * (apagado en la aplicación) junto al aspecto de hoy.
 *
 * USO
 *   npm run docs:galeria-panel                 # escribe en .next-qa/galeria-panel (ignorado por git)
 *   npx --yes http-server .next-qa/galeria-panel -p 4174
 *
 * Necesita internet para Inter (Google Fonts); sin ella se ve con la fuente del sistema.
 */
import { createElement as h, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { PageHeader } from '../../packages/ui/src/ui/page-header'
import { StatCard } from '../../packages/ui/src/ui/stat-card'
import { Campo } from '../../packages/ui/src/ui/campo'
import { Input } from '../../packages/ui/src/ui/input'
import { EstadoChip, TONOS_ESTADO } from '../../packages/ui/src/ui/estado-chip'
import { Tabla } from '../../packages/ui/src/ui/tabla'
import { BarraFiltros } from '../../packages/ui/src/ui/barra-filtros'
import { NavSeccion } from '../../packages/ui/src/ui/nav-seccion'
import { SelectorColor } from '../../packages/ui/src/ui/selector-color'
import { BarrasSimples } from '../../packages/ui/src/ui/barras-simples'
import { Button } from '../../packages/ui/src/ui/button'
import { estadoUi } from '../../src/lib/estados'
import { paletaDeMarca } from '../../src/lib/company-branding'

const destino = process.argv[2] ?? join('.next-qa', 'galeria-panel')

const Seccion = (titulo: string, nota: string, ...hijos: ReactNode[]) =>
  h('section', { className: 'mb-10' }, h('h2', { className: 'text-h2 mb-1' }, titulo), h('p', { className: 'text-small text-muted-foreground mb-4' }, nota), ...hijos)
const Caja = (etiqueta: string, ...hijos: ReactNode[]) =>
  h('div', { className: 'rounded-xl border border-dashed border-border p-4' }, h('p', { className: 'text-overline text-muted-foreground mb-3' }, etiqueta), ...hijos)
const ConPanel = (etiqueta: string, ...hijos: ReactNode[]) =>
  h('div', { className: 'panel-ds rounded-xl border border-dashed border-primary/40 p-4' }, h('p', { className: 'text-overline text-muted-foreground mb-3' }, etiqueta), ...hijos)

const Icono = (p: { className?: string }) =>
  h('svg', { className: p.className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, h('circle', { cx: 12, cy: 12, r: 9 }))
const enlace = ({ href, className, children, ...resto }: { href: string; className: string; children: ReactNode }) => h('a', { href, className, ...resto }, children)

interface Cliente {
  id: string
  nombre: string
  plan: string | null
  monto: number
  vence: string
  estado: { label: string; tono: ComponentProps<typeof EstadoChip>['tono'] }
}
const clientes: Cliente[] = [
  { id: 'c1', nombre: 'María del Carmen Pérez de la Rosa', plan: 'Pase anual familiar', monto: 14500, vence: '2026-11-12T12:00:00Z', estado: estadoUi('membresia', 'ACTIVA') },
  { id: 'c2', nombre: 'Luis Alberto Ramírez', plan: null, monto: 1800, vence: '2026-10-24T12:00:00Z', estado: estadoUi('membresia', 'PENDIENTE_PAGO') },
  { id: 'c3', nombre: 'Inversiones Turísticas del Atlántico, S.R.L.', plan: 'Paquete corporativo', monto: 32000, vence: '2026-10-03T12:00:00Z', estado: estadoUi('membresia', 'VENCIDA') },
]

const tabla = h(Tabla<Cliente>, {
  caption: 'Directorio de clientes',
  claveDe: (f) => f.id,
  filas: clientes,
  filaNavegable: true,
  orden: { clave: 'monto', dir: 'desc' },
  hrefOrden: (c, d) => `?orden=${c}:${d}`,
  enlace,
  formato: {
    dinero: (v) => `RD$${Number(v).toLocaleString('en-US')}`,
    fecha: (v) => new Date(v).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }),
  },
  columnas: [
    { clave: 'nombre', encabezado: 'Cliente', tipo: 'enlace', valor: (f) => ({ texto: f.nombre, href: `#${f.id}` }), ordenable: true },
    { clave: 'plan', encabezado: 'Plan', prioridad: 2 },
    { clave: 'monto', encabezado: 'Monto', tipo: 'dinero', ordenable: true },
    { clave: 'vence', encabezado: 'Vence', tipo: 'fecha', prioridad: 3 },
    { clave: 'estado', encabezado: 'Estado', tipo: 'estado', valor: (f) => ({ etiqueta: f.estado.label, tono: f.estado.tono }) },
    { clave: 'acciones', encabezado: 'Acciones', soloLector: true, celda: (f) => h(Button, { size: 'sm', variant: 'outline' }, `Ver ${f.id}`) },
  ],
  pie: 'Mostrando 1–3 de 1 204',
})

const secciones: ReactNode[] = [
  Seccion(
    'PageHeader',
    'Arriba, tal como está hoy. Debajo, con el ámbito `.panel-ds` encendido (24/32 · 600, Inter). El icono, las migas, el estado y el enlace de vuelta son props nuevas.',
    h(
      'div',
      { className: 'grid gap-6 lg:grid-cols-2' },
      Caja('hoy', h(PageHeader, { title: 'Pagos', description: 'Valida lo que tus clientes ya pagaron o pidieron.', action: h(Button, null, 'Registrar cobro') })),
      ConPanel('con .panel-ds', h(PageHeader, { title: 'Pagos', description: 'Valida lo que tus clientes ya pagaron o pidieron.', action: h(Button, null, 'Registrar cobro') }))
    ),
    h(
      'div',
      { className: 'mt-6' },
      ConPanel(
        'con .panel-ds · icono + migas + estado + volver',
        h(PageHeader, {
          title: 'María del Carmen Pérez de la Rosa',
          icon: h(Icono, null),
          breadcrumbs: h('a', { href: '#', className: 'text-primary' }, 'Clientes'),
          badge: h(EstadoChip, { tono: 'exito', children: 'Activa' }),
          back: h('a', { href: '#', className: 'text-primary' }, '‹ Clientes'),
          description: 'Vence el 12 nov 2026 · riesgo bajo',
          action: h(Button, null, 'Renovar'),
        })
      )
    )
  ),
  Seccion(
    'StatCard',
    'La clásica (por defecto) y la variante `panel`: ventana escrita, pie con tono, «Sin permiso» y una sola talla de cifra.',
    h(
      'div',
      { className: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
      h(StatCard, { label: 'Clientes', value: '1 204', sub: 'registrados', accent: 'brand', icon: Icono as never }),
      h(StatCard, { variante: 'panel', label: 'Ingresos del mes', value: 'RD$68,400', ventana: '1–20 oct 2026', pie: { texto: '▲ 18.5 % frente a 1–20 sep', tono: 'exito' } }),
      h(StatCard, { variante: 'panel', label: 'Membresías activas', value: '23', ventana: 'al cierre de hoy', pie: { texto: '+5 altas · −2 bajas este mes' }, icon: Icono as never }),
      h(StatCard, { variante: 'panel', label: 'Ingresos del mes', value: 'RD$68,400', sinPermiso: true, ventana: '1–20 oct 2026' })
    )
  ),
  Seccion(
    'EstadoChip + estadoUi',
    'Los seis tonos, y los estados reales de membresía por `estadoUi`.',
    h('div', { className: 'flex flex-wrap gap-2' }, ...TONOS_ESTADO.map((t) => h(EstadoChip, { key: t, tono: t, children: t }))),
    h(
      'div',
      { className: 'mt-3 flex flex-wrap gap-2' },
      ...['PENDIENTE', 'PENDIENTE_PAGO', 'ACTIVA', 'VENCIDA', 'RECHAZADA', 'CANCELADA'].map((e) => {
        const u = estadoUi('membresia', e)
        return h(EstadoChip, { key: e, tono: u.tono, children: u.label })
      })
    )
  ),
  Seccion(
    'Campo',
    'Con ayuda, con error (enlazado) y opcional.',
    h(
      'div',
      { className: 'grid max-w-xl gap-4' },
      h(Campo, { id: 'f1', etiqueta: 'Título', ayuda: 'Lo verá el cliente en su inicio.', children: (c) => h(Input, { name: 'titulo', defaultValue: 'Pasadía 2×1', ...c }) }),
      h(Campo, { id: 'f2', etiqueta: 'Título', error: 'Escribe un título para publicar.', children: (c) => h(Input, { name: 'titulo', ...c }) }),
      h(Campo, { id: 'f3', etiqueta: 'Descripción', opcional: true, children: (c) => h('textarea', { className: 'min-h-20 rounded-xl border border-input bg-background px-3 py-2 text-sm', ...c }) })
    )
  ),
  Seccion(
    'BarraFiltros',
    'Formulario GET con los filtros activos como chips que se quitan.',
    h(BarraFiltros, {
      enlace,
      busqueda: { nombre: 'q', valor: 'maria', etiqueta: 'Buscar', placeholder: 'Buscar por nombre o teléfono' },
      filtros: [{ nombre: 'estado', etiqueta: 'Estado', valor: 'ACTIVA', opciones: [{ valor: 'ACTIVA', etiqueta: 'Activa' }, { valor: 'VENCIDA', etiqueta: 'Vencida' }] }],
      hrefSin: (n) => `?sin=${n}`,
      hrefLimpiar: '?',
    })
  ),
  Seccion(
    'NavSeccion',
    'Pestañas de módulo con `aria-current`.',
    h(NavSeccion, {
      'aria-label': 'Secciones de Pagos',
      enlace,
      items: [
        { etiqueta: 'Por validar', href: '#a', activa: true, cuenta: 5 },
        { etiqueta: 'Movimientos', href: '#b' },
        { etiqueta: 'Conciliación', href: '#c', cuenta: 1 },
      ],
    })
  ),
  Seccion('Tabla', 'Orden por URL (monto ↓), identificador como enlace, dinero a la derecha, estado como chip, «Sin dato» donde falta. Estrecha la ventana: las columnas de prioridad 2 y 3 se ocultan y el scroll es interno.', tabla),
  Seccion(
    'Tabla vacía',
    'Vacío real y vacío por filtro.',
    h(
      'div',
      { className: 'grid gap-4 lg:grid-cols-2' },
      h(Tabla<{ id: string }>, { caption: 'Vacía', filas: [], claveDe: (f) => f.id, columnas: [{ clave: 'id', encabezado: 'Cliente' }], vacio: { titulo: 'Aún no tienes clientes', descripcion: 'Cuando alguien se registre, aparecerá aquí.', accion: h(Button, null, 'Invitar clientes') } }),
      h(Tabla<{ id: string }>, { caption: 'Sin resultados', filas: [], hayFiltros: true, claveDe: (f) => f.id, columnas: [{ clave: 'id', encabezado: 'Cliente' }], sinResultados: { titulo: 'Ningún cliente coincide', descripcion: 'Prueba con otro nombre o quita un filtro.', accion: h(Button, { variant: 'outline' }, 'Limpiar filtros') } })
    )
  ),
  Seccion('SelectorColor', 'Paleta cerrada; el color guardado dice su contraste.', h(SelectorColor, { nombre: 'color', valor: '#047857', paleta: paletaDeMarca() })),
  Seccion(
    'BarrasSimples',
    'Con eje, valor del pico y tabla alternativa; y el estado sin datos.',
    h(
      'div',
      { className: 'grid gap-6 lg:grid-cols-2' },
      h(BarrasSimples, { titulo: 'Canjes · últimos 14 días', unidad: 'canjes', valores: [8, 11, 9, 14, 12, 6, 4, 10, 13, 15, 12, 9, 11, 12], etiquetas: Array.from({ length: 14 }, (_, i) => `${7 + i}`) }),
      h(BarrasSimples, { titulo: 'Registros nuevos', unidad: 'registros', valores: [0, 0, 0], etiquetas: ['a', 'b', 'c'] })
    )
  ),
]

async function main() {
  const desde = join('src', 'app', 'globals.css')
  const css = (await postcss([tailwind()]).process(readFileSync(desde, 'utf8'), { from: desde })).css
  const cuerpo = renderToStaticMarkup(
    h('main', { className: 'mx-auto max-w-6xl p-6 text-foreground' }, h('h1', { className: 'text-h1 mb-6' }, 'Galería · primitivas del panel (fase 4)'), ...secciones) as never
  )
  mkdirSync(destino, { recursive: true })
  writeFileSync(join(destino, 'estilos.css'), css)
  writeFileSync(
    join(destino, 'index.html'),
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Galería · primitivas del panel</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="estilos.css">
<style>:root{--font-panel-inter:'Inter';--font-geist-sans:ui-sans-serif,system-ui,sans-serif;--font-display:ui-sans-serif,system-ui,sans-serif}body{background:var(--background)}</style></head><body class="antialiased">${cuerpo}</body></html>`
  )
  console.log(`Galería escrita en ${destino}\n  npx --yes http-server ${destino} -p 4174`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
