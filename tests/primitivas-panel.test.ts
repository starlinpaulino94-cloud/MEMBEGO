import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageHeader } from '../packages/ui/src/ui/page-header'
import { StatCard } from '../packages/ui/src/ui/stat-card'
import { StatusChip } from '../packages/ui/src/ui/status-chip'
import { TabsNav } from '../packages/ui/src/ui/tabs-nav'
import { Campo } from '../packages/ui/src/ui/campo'
import { EstadoChip, TONOS_ESTADO } from '../packages/ui/src/ui/estado-chip'
import { Tabla, type Columna } from '../packages/ui/src/ui/tabla'
import { BarraFiltros } from '../packages/ui/src/ui/barra-filtros'
import { NavSeccion, pestanasVisibles } from '../packages/ui/src/ui/nav-seccion'
import { SelectorColor } from '../packages/ui/src/ui/selector-color'
import { BarrasSimples } from '../packages/ui/src/ui/barras-simples'

/**
 * FASE 4 · LAS PRIMITIVAS DEL PANEL (docs/auditoria-admin/12, tareas 4.1 a 4.7).
 *
 * Dos cosas distintas en un mismo archivo, porque la fase pide las dos a la vez:
 *
 *   1. NO REGRESIÓN. `PageHeader`, `StatCard`, `StatusChip` y `TabsNav` se AMPLIARON, y la fase promete «las pantallas siguen
 *      igual». La prueba renderiza cada uno con las props de antes y exige el mismo HTML, byte a byte, que se capturó ANTES de
 *      tocarlos (`fixtures/panel-fase4-antes.json`). Si alguien cambia la salida por defecto, falla aquí y no en una captura.
 *
 *   2. CONTRATO. Cada pieza nueva se renderiza a HTML y se comprueba lo que la auditoría pidió de ella: error enlazado al
 *      campo, `caption` y `scope` en la tabla, `aria-sort`, filtros en la URL, `aria-current` en la pestaña, alternativa
 *      accesible en la gráfica.
 *
 * Se renderiza con `renderToStaticMarkup` (React a secas), que NO ve la frontera servidor/cliente de Next; eso lo vigilan
 * otras guardias. Aquí solo importa el marcado.
 */

const ANTES: Record<string, string> = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'panel-fase4-antes.json'), 'utf8'))
const html = (n: ReactNode) => renderToStaticMarkup(n as never)
const Icono = (p: { className?: string }) => h('svg', { className: p.className, 'data-icono': 'x' })

// ── 1. No regresión ─────────────────────────────────────────────────────────────────────────────────────────────────

test('PageHeader con las props de antes pinta exactamente lo mismo', () => {
  assert.equal(html(h(PageHeader, { title: 'Pagos' })), ANTES['PageHeader · mínimo'])
  assert.equal(
    html(
      h(PageHeader, {
        title: 'Pagos',
        description: 'Valida lo que tus clientes ya pagaron.',
        action: h('button', null, 'Exportar'),
        eyebrow: 'Operaciones',
        nav: h('nav', null, 'pestañas'),
        className: 'extra',
      })
    ),
    ANTES['PageHeader · completo']
  )
})

test('StatCard con las props de antes pinta exactamente lo mismo', () => {
  assert.equal(html(h(StatCard, { label: 'Clientes', value: '99' })), ANTES['StatCard · mínimo'])
  assert.equal(
    html(h(StatCard, { label: 'Ingresos', value: 'RD$68,400', sub: 'este mes', icon: Icono as never, trend: { value: 12, positive: true }, accent: 'brand', className: 'extra' })),
    ANTES['StatCard · completo']
  )
  assert.equal(
    html(h(StatCard, { label: 'Pagos', value: '5', href: '/admin/pagos', hrefLabel: 'ir a Pagos', accent: 'success', trend: { value: 3, positive: false } })),
    ANTES['StatCard · enlace']
  )
})

test('StatusChip conserva sus cinco tonos y el pulso', () => {
  const tonos = ['success', 'warning', 'danger', 'info', 'neutral'] as const
  assert.equal(tonos.map((t) => html(h(StatusChip, { tone: t, children: 'Activa' }))).join('\n'), ANTES['StatusChip · tonos'])
  assert.equal(html(h(StatusChip, { tone: 'success', pulso: true, children: 'En vivo' })), ANTES['StatusChip · pulso'])
})

test('TabsNav pinta lo mismo para quien no usa `aria-current`', () => {
  const salida = html(
    h(TabsNav, {
      'aria-label': 'Colas',
      items: [
        { label: 'Por validar', badge: 5, active: true, render: ({ className, children }) => h('a', { href: '/a', className }, children) },
        { label: 'Movimientos', badge: null, render: ({ className, children }) => h('a', { href: '/b', className }, children) },
      ],
    })
  )
  assert.equal(salida, ANTES['TabsNav'])
})

// ── 2. Ampliaciones de PageHeader y StatCard ────────────────────────────────────────────────────────────────────────

test('PageHeader: icono, migas, estado, enlace de vuelta y variante de formulario', () => {
  const s = html(
    h(PageHeader, {
      title: 'María del Carmen Pérez',
      icon: h('i', { 'data-i': '1' }),
      breadcrumbs: h('a', { href: '/clientes' }, 'Clientes'),
      badge: h('span', { 'data-b': '1' }, 'Activa'),
      back: h('a', { href: '/clientes' }, '‹ Clientes'),
      variant: 'formulario',
    })
  )
  assert.match(s, /<nav aria-label="Migas de pan"[^>]*><a href="\/clientes">Clientes<\/a><\/nav>/)
  assert.match(s, /<span aria-hidden="true" class="[^"]*">\s*<i data-i="1">/, 'el icono es decorativo: oculto a los lectores')
  assert.match(s, /<h1 [^>]*>María del Carmen Pérez<\/h1><span data-b="1">Activa<\/span>/, 'el estado va pegado al título')
  assert.match(s, /max-w-\[720px\]/, 'la variante formulario se alinea con su columna')
  assert.equal((s.match(/<h1/g) ?? []).length, 1, 'un solo h1')
})

test('StatCard variante panel: ventana escrita, pie con tono, unidad y «Sin permiso»', () => {
  const s = html(h(StatCard, { variante: 'panel', label: 'Ingresos del mes', value: 'RD$68,400', ventana: '1–20 oct 2026', pie: { texto: '▲ 18,5 % frente a 1–20 sep', tono: 'exito' } }))
  assert.match(s, /1–20 oct 2026/)
  assert.match(s, /text-success[^>]*>▲ 18,5 %/)
  assert.match(s, /text-kpi/, 'una sola talla de cifra')
  const sin = html(h(StatCard, { variante: 'panel', label: 'Ingresos del mes', value: 'RD$68,400', sinPermiso: true, ventana: '1–20 oct 2026' }))
  assert.match(sin, /Sin permiso/)
  assert.doesNotMatch(sin, /68,400/, 'sin permiso, la cifra ni siquiera se renderiza')
  assert.match(html(h(StatCard, { variante: 'panel', label: 'Tasa', value: '12', unidad: '%' })), /12<span[^>]*>%<\/span>/)
})

// ── 3. Campo ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `createElement` tipa los hijos como nodos, y el hijo de `Campo` es una función: se pasa como propiedad. */
type PropsCampo = ComponentProps<typeof Campo>
const campo = (props: Omit<PropsCampo, 'children'>, hijo: PropsCampo['children']) => h(Campo, { ...props, children: hijo })

test('Campo enlaza etiqueta, ayuda y error con el control', () => {
  const s = html(campo({ id: 'titulo', etiqueta: 'Título', ayuda: 'Lo verá el cliente.', error: 'Escribe un título.' }, (c) => h('input', { name: 'titulo', ...c })))
  assert.match(s, /<label for="titulo"[^>]*>Título<\/label>/)
  const input = s.match(/<input[^>]*>/)?.[0] ?? ''
  for (const a of ['name="titulo"', 'id="titulo"', 'aria-describedby="titulo-ayuda titulo-error"', 'aria-invalid="true"']) {
    assert.ok(input.includes(a), `al control le falta ${a}: ${input}`)
  }
  assert.match(s, /<p id="titulo-ayuda"[^>]*>Lo verá el cliente\.<\/p>/)
  assert.match(s, /<p id="titulo-error" role="alert"[^>]*>Escribe un título\.<\/p>/)
  assert.match(s, /data-invalido="true"/)
})

test('Campo sin error no marca el control como inválido, y marca lo OPCIONAL, no lo obligatorio', () => {
  const sano = html(campo({ id: 'desc', etiqueta: 'Descripción', opcional: true }, (c) => h('textarea', c)))
  assert.doesNotMatch(sano, /aria-invalid/)
  assert.doesNotMatch(sano, /aria-describedby/)
  assert.match(sano, /\(opcional\)/)
  assert.doesNotMatch(html(campo({ id: 'a', etiqueta: 'Nombre' }, (c) => h('input', c))), /opcional|\*/, 'lo obligatorio no se marca con asterisco')
})

test('Campo como grupo usa fieldset y legend', () => {
  const s = html(campo({ id: 'modalidad', etiqueta: 'Modalidad', como: 'grupo', error: 'Elige una.' }, () => h('span', null, 'opciones')))
  assert.match(s, /<fieldset[^>]*aria-describedby="modalidad-error"[^>]*>/)
  assert.match(s, /<legend[^>]*>Modalidad<\/legend>/)
})

// ── 4. EstadoChip ───────────────────────────────────────────────────────────────────────────────────────────────────

test('EstadoChip pinta los seis tonos sobre StatusChip, incluido «pendiente»', () => {
  assert.deepEqual([...TONOS_ESTADO].sort(), ['aviso', 'exito', 'info', 'neutro', 'peligro', 'pendiente'])
  for (const t of TONOS_ESTADO) {
    const s = html(h(EstadoChip, { tono: t, children: 'Estado' }))
    assert.match(s, /data-slot="status-chip"/, `${t} se apoya en StatusChip, no lo duplica`)
    assert.match(s, />Estado<\/span>$/)
  }
  const pendiente = html(h(EstadoChip, { tono: 'pendiente', children: 'En espera' }))
  assert.match(pendiente, /text-pending/)
  // `text-pending` sobre `bg-muted` da 4,42:1 en el tema claro (< AA, medido con scripts/contraste.mjs); sobre `bg-card`, 4,96:1.
  assert.match(pendiente, /bg-card/)
  assert.doesNotMatch(pendiente, /bg-muted/, 'el chip «pendiente» no puede volver a `bg-muted`: no pasa el contraste AA')
})

// ── 5. Tabla ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface FilaCliente {
  id: string
  nombre: string
  plan: string | null
  monto: number
  vence: string
  estado: { etiqueta: string; tono: 'exito' | 'aviso' }
  tel: string
}
const FILAS: FilaCliente[] = [
  { id: 'c1', nombre: 'María del Carmen Pérez de la Rosa', plan: 'Pase anual familiar', monto: 14500, vence: '2026-11-12T12:00:00.000Z', estado: { etiqueta: 'Activa', tono: 'exito' }, tel: '809' },
  { id: 'c2', nombre: 'Luis Alberto Ramírez', plan: null, monto: 1800, vence: 'no es una fecha', estado: { etiqueta: 'Vence pronto', tono: 'aviso' }, tel: '829' },
]
const COLUMNAS: Columna<FilaCliente>[] = [
  { clave: 'nombre', encabezado: 'Cliente', tipo: 'enlace', valor: (f) => ({ texto: f.nombre, href: `/clientes/${f.id}` }), ordenable: true },
  { clave: 'plan', encabezado: 'Plan', prioridad: 2 },
  { clave: 'monto', encabezado: 'Monto', tipo: 'dinero', ordenable: true },
  { clave: 'vence', encabezado: 'Vence', tipo: 'fecha', prioridad: 3 },
  { clave: 'estado', encabezado: 'Estado', tipo: 'estado' },
  { clave: 'acciones', encabezado: 'Acciones', soloLector: true, celda: (f) => h('button', null, `Ver ${f.id}`) },
]
const tabla = (extra: Record<string, unknown> = {}) =>
  html(
    h(Tabla<FilaCliente>, {
      caption: 'Directorio de clientes',
      columnas: COLUMNAS,
      filas: FILAS,
      claveDe: (f) => f.id,
      formato: { dinero: (v) => `RD$${Number(v).toLocaleString('en-US')}`, fecha: () => '12 nov 2026' },
      ...extra,
    })
  )

test('Tabla: caption, scope, th de fila, columna de acciones solo para lectores', () => {
  const s = tabla()
  assert.match(s, /<caption class="sr-only">Directorio de clientes<\/caption>/)
  assert.equal((s.match(/<th scope="col"/g) ?? []).length, COLUMNAS.length)
  assert.match(s, /<th scope="row"[^>]*><a href="\/clientes\/c1"[^>]*>María del Carmen Pérez de la Rosa<\/a><\/th>/, 'el identificador es el th de la fila y el enlace al detalle')
  assert.match(s, /<span class="sr-only">Acciones<\/span>/)
})

test('Tabla: dinero a la derecha con formato regional, fecha en <time>, estado como chip, vacío dicho', () => {
  const s = tabla()
  assert.match(s, /<td class="[^"]*text-right tabular-nums[^"]*">RD\$14,500<\/td>/)
  assert.match(s, /<time dateTime="2026-11-12T12:00:00\.000Z">12 nov 2026<\/time>/)
  assert.match(s, /data-slot="status-chip"/)
  assert.match(s, /<span class="sr-only">Sin dato<\/span>/, 'un plan nulo se dice, no se deja en blanco')
  assert.doesNotMatch(s, /<time dateTime="no es una fecha"/, 'una fecha inválida no rompe: se pinta el texto')
})

test('Tabla: prioridades de columna ocultan bajo 768 y bajo 1024', () => {
  const s = tabla()
  assert.match(s, /<th scope="col"[^>]*class="[^"]*max-md:hidden[^"]*">Plan<\/th>/)
  assert.match(s, /<th scope="col"[^>]*class="[^"]*max-lg:hidden[^"]*">Vence<\/th>/)
  assert.doesNotMatch(s, /<th scope="col"[^>]*class="[^"]*max-(?:md|lg):hidden[^"]*">Cliente<\/th>/)
})

test('Tabla: orden por URL con aria-sort y cabecera como enlace', () => {
  const s = tabla({ orden: { clave: 'monto', dir: 'asc' }, hrefOrden: (c: string, d: string) => `?orden=${c}:${d}` })
  assert.match(s, /<th scope="col" aria-sort="ascending"[^>]*><a href="\?orden=monto:desc"/, 'el siguiente clic invierte el orden')
  assert.match(s, /<a href="\?orden=nombre:asc"/, 'una columna sin ordenar empieza ascendente')
  assert.equal((s.match(/aria-sort/g) ?? []).length, 1, 'solo la columna ordenada lleva aria-sort')
})

test('Tabla: dos vacíos distintos, con su acción', () => {
  const real = tabla({ filas: [], vacio: { titulo: 'Aún no tienes clientes', accion: h('a', { href: '/nuevo' }, 'Crear cliente') } })
  assert.match(real, /Aún no tienes clientes/)
  assert.match(real, /Crear cliente/)
  const filtro = tabla({ filas: [], hayFiltros: true, sinResultados: { titulo: 'Ningún cliente coincide', accion: h('a', { href: '?' }, 'Limpiar filtros') } })
  assert.match(filtro, /Ningún cliente coincide/)
  assert.match(filtro, /Limpiar filtros/)
  assert.doesNotMatch(filtro, /Aún no tienes clientes/)
})

// ── 6. BarraFiltros ─────────────────────────────────────────────────────────────────────────────────────────────────

test('BarraFiltros: formulario GET, filtros activos como chips que se quitan, Limpiar', () => {
  const s = html(
    h(BarraFiltros, {
      busqueda: { nombre: 'q', valor: 'maria', etiqueta: 'Buscar' },
      filtros: [{ nombre: 'estado', etiqueta: 'Estado', valor: 'ACTIVA', opciones: [{ valor: 'ACTIVA', etiqueta: 'Activa' }, { valor: 'VENCIDA', etiqueta: 'Vencida' }] }],
      conservar: { cola: 'transferencias' },
      hrefSin: (n: string) => `/clientes?sin=${n}`,
      hrefLimpiar: '/clientes',
    })
  )
  const form = s.match(/<form[^>]*>/)?.[0] ?? ''
  for (const a of ['method="get"', 'action=""', 'role="search"']) assert.ok(form.includes(a), `al formulario le falta ${a}: ${form}`)
  assert.match(s, /<input type="hidden" name="cola" value="transferencias"\/>/, 'lo que no es filtro viaja')
  const enlaces = [...s.matchAll(/<a [^>]*>/g)].map((m) => m[0])
  const conTodo = (...partes: string[]) => enlaces.some((a) => partes.every((p) => a.includes(p)))
  assert.ok(conTodo('href="/clientes?sin=q"', 'aria-label="Quitar el filtro Buscar: maria"'), `chip de la búsqueda: ${enlaces.join(' ')}`)
  assert.ok(conTodo('href="/clientes?sin=estado"', 'aria-label="Quitar el filtro Estado: Activa"'), `chip del estado: ${enlaces.join(' ')}`)
  assert.match(s, /<a href="\/clientes"[^>]*>Limpiar<\/a>/)
  assert.match(s, /<option value="ACTIVA" selected="">Activa<\/option>|<option value="ACTIVA">Activa<\/option>/)
})

test('BarraFiltros sin filtros activos no muestra chips ni «Limpiar»', () => {
  const s = html(h(BarraFiltros, { filtros: [{ nombre: 'estado', etiqueta: 'Estado', valor: '', opciones: [{ valor: 'A', etiqueta: 'A' }] }], hrefSin: () => '/', hrefLimpiar: '/' }))
  assert.doesNotMatch(s, /Filtros activos/)
  assert.doesNotMatch(s, /Limpiar/)
})

// ── 7. NavSeccion ───────────────────────────────────────────────────────────────────────────────────────────────────

test('NavSeccion: aria-current en la pestaña activa y enlace puesto por quien la usa', () => {
  const s = html(
    h(NavSeccion, {
      'aria-label': 'Secciones de Pagos',
      items: [
        { etiqueta: 'Por validar', href: '/admin/pagos', activa: true, cuenta: 5 },
        { etiqueta: 'Movimientos', href: '/admin/registros' },
      ],
      enlace: ({ href, className, children, 'aria-current': actual }) => h('a', { href, className, 'aria-current': actual }, children),
    })
  )
  assert.match(s, /<a href="\/admin\/pagos"[^>]*aria-current="page"/)
  assert.match(s, /<a href="\/admin\/registros"/)
  assert.equal((s.match(/aria-current/g) ?? []).length, 1)
  assert.match(s, />5<\/span>/)
})

test('pestanasVisibles filtra por sección y deja las que no declaran ninguna', () => {
  const todas = [{ etiqueta: 'A', seccion: 'pagos' }, { etiqueta: 'B', seccion: 'reportes' }, { etiqueta: 'C' }]
  assert.deepEqual(pestanasVisibles(todas, (s) => s === 'pagos').map((p) => p.etiqueta), ['A', 'C'])
  assert.deepEqual(pestanasVisibles(todas, () => false).map((p) => p.etiqueta), ['C'])
})

// ── 8. SelectorColor ────────────────────────────────────────────────────────────────────────────────────────────────

test('SelectorColor: radios nativos con nombre, el actual marcado y el contraste dicho', () => {
  const paleta = [
    { valor: 'c1', nombre: 'Azul', tinta: 'claro' as const, razon: 4.9 },
    { valor: 'c2', nombre: 'Ámbar', tinta: 'oscuro' as const, razon: 3.2 },
  ]
  const s = html(h(SelectorColor, { nombre: 'color', valor: 'c1', paleta }))
  assert.match(s, /role="radiogroup"/)
  assert.equal((s.match(/type="radio"/g) ?? []).length, 2)
  const azul = s.match(/<input[^>]*value="c1"[^>]*>/)?.[0] ?? ''
  for (const a of ['type="radio"', 'name="color"', 'checked=""', 'aria-label="Azul"']) assert.ok(azul.includes(a), `al radio le falta ${a}: ${azul}`)
  assert.match(s, /Pasa AA/)
  assert.match(s, /4\.9:1/)
  assert.match(html(h(SelectorColor, { nombre: 'color', valor: 'c2', paleta })), /No pasa AA/)
  assert.doesNotMatch(html(h(SelectorColor, { nombre: 'color', valor: null, paleta })), /AA/, 'sin color elegido no hay nada que medir')
})

// ── 9. BarrasSimples ────────────────────────────────────────────────────────────────────────────────────────────────

test('BarrasSimples: eje con valores, pico escrito, nombre completo y tabla alternativa', () => {
  const valores = [8, 11, 9, 14, 12, 6, 4]
  const etiquetas = ['7 mié', '8 jue', '9 vie', '10 sáb', '11 dom', '12 lun', '13 mar']
  const s = html(h(BarrasSimples, { titulo: 'Canjes · últimos 7 días', unidad: 'canjes', valores, etiquetas }))
  assert.match(s, /role="img" aria-label="Canjes · últimos 7 días: 7 mié 8, 8 jue 11/)
  assert.match(s, /<figcaption class="sr-only">Canjes · últimos 7 días<\/figcaption>/)
  assert.match(s, />16<\/span><span>8<\/span><span>0<\/span>/, 'eje: tope múltiplo de 4, mitad entera, cero')
  assert.match(s, /text-caption font-medium[^>]*>14<\/span>/, 'el valor del pico va escrito sobre su barra')
  assert.equal((s.match(/<tr class="border-t/g) ?? []).length, valores.length, 'una fila de tabla por barra')
  assert.match(s, /<summary[^>]*>Ver como tabla<\/summary>/)
})

test('BarrasSimples sin datos dice que no hay datos en vez de pintar barras de altura cero', () => {
  assert.match(html(h(BarrasSimples, { titulo: 'x', unidad: 'canjes', valores: [0, 0, 0], etiquetas: ['a', 'b', 'c'] })), /Sin datos en este periodo/)
  assert.match(html(h(BarrasSimples, { titulo: 'x', unidad: 'canjes', valores: [], etiquetas: [], vacio: 'Nada todavía' })), /Nada todavía/)
  assert.doesNotMatch(html(h(BarrasSimples, { titulo: 'x', unidad: 'canjes', valores: [0, 0], etiquetas: ['a', 'b'] })), /<svg|height: ?0%/)
})

// ── 10. Independencia del paquete y tamaño ──────────────────────────────────────────────────────────────────────────

const NUEVAS = ['campo', 'estado-chip', 'tabla', 'barra-filtros', 'nav-seccion', 'selector-color', 'barras-simples']
const DIR_UI = join(import.meta.dirname, '..', 'packages', 'ui', 'src', 'ui')

test('las primitivas nuevas no dependen de la aplicación ni del framework (el paquete se entrega tal cual a cada satélite)', () => {
  for (const n of NUEVAS) {
    const src = readFileSync(join(DIR_UI, `${n}.tsx`), 'utf8')
    const imports = [...src.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const i of imports) {
      assert.ok(i === 'react' || i.startsWith('./') || i === '../cn', `${n}.tsx importa «${i}»: solo react, ../cn y hermanos de ui`)
    }
    assert.ok(!/^['"]use client['"]/m.test(src), `${n}.tsx es de servidor: sin estado ni efectos`)
  }
})

test('ninguna primitiva nueva pasa de 400 líneas (V-M1)', () => {
  for (const n of NUEVAS) {
    const lineas = readFileSync(join(DIR_UI, `${n}.tsx`), 'utf8').split('\n').length
    assert.ok(lineas <= 400, `${n}.tsx tiene ${lineas} líneas`)
  }
})

test('las primitivas nuevas no escriben colores a mano (ni hex ni clases crudas de Tailwind)', () => {
  for (const n of NUEVAS) {
    const src = readFileSync(join(DIR_UI, `${n}.tsx`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${n}.tsx tiene un hexadecimal`)
    assert.doesNotMatch(src, /\b(?:bg|text|border|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/, `${n}.tsx usa un color crudo`)
  }
  assert.ok(readdirSync(DIR_UI).includes('tabla.tsx'))
})
