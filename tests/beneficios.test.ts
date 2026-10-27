import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  TIPOS_BENEFICIO,
  contarBeneficios,
  estadoDeBeneficio,
  listarBeneficios,
  tipoActivo,
  tiposDisponibles,
  type FilaBeneficio,
} from '../src/modules/ofertas/beneficios'
import { TablaBeneficios } from '../src/components/admin/beneficios/TablaBeneficios'
import { ADMIN_SECTIONS, type AdminSection } from '../src/lib/auth/permissions'

/**
 * BENEFICIOS · UNA VISTA CON PESTAÑAS Y UN SOLO «CREAR» (auditoría admin · fase 5, tarea 5.4; 02 · U-06).
 *
 * El hub eran cuatro tarjetas con ocho botones. Ahora: una pestaña por tipo, una lista corta de la pestaña abierta y un único
 * «Crear beneficio». Lo que se prueba: quién ve qué pestaña, cómo se dice cada estado, que la lista y los conteos leen lo que
 * decían (con un `tx` falso que registra las consultas) y que la página no vuelve a repartir botones de crear por tipo.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const puedeTodo = () => true
const solo =
  (...secciones: AdminSection[]) =>
  (s: AdminSection) =>
    secciones.includes(s)

test('los cuatro tipos existen, cada uno con su sección, su formulario y su panel de gestión', () => {
  assert.deepEqual(
    TIPOS_BENEFICIO.map((t) => [t.key, t.seccion, t.crearHref, t.gestionarHref]),
    [
      ['publica', 'promociones', '/admin/promociones/nuevo', '/admin/promociones'],
      ['relampago', 'marketing', '/admin/marketing/nueva', '/admin/marketing'],
      ['vip', 'ofertas', '/admin/ofertas/nueva', '/admin/ofertas/vip'],
      ['catalogo', 'deals', '/admin/deals/nueva', '/admin/deals'],
    ]
  )
  for (const t of TIPOS_BENEFICIO) assert.ok(ADMIN_SECTIONS.includes(t.seccion), `${t.key}: «${t.seccion}» no es una sección del panel`)
})

test('cada persona ve solo las pestañas de las secciones que puede abrir', () => {
  assert.deepEqual(tiposDisponibles(puedeTodo, true).map((t) => t.key), ['publica', 'relampago', 'vip', 'catalogo'])
  assert.deepEqual(tiposDisponibles(solo('promociones'), true).map((t) => t.key), ['publica'])
  assert.deepEqual(tiposDisponibles(solo('marketing', 'ofertas'), true).map((t) => t.key), ['relampago', 'vip'])
  assert.deepEqual(tiposDisponibles(() => false, true), [])
})

test('la oferta sobre un producto o servicio exige ADEMÁS la capacidad del marketplace', () => {
  assert.deepEqual(tiposDisponibles(puedeTodo, false).map((t) => t.key), ['publica', 'relampago', 'vip'])
  // Con la sección pero sin el módulo encendido: no aparece. Con el módulo pero sin la sección: tampoco.
  assert.deepEqual(tiposDisponibles(solo('deals'), false), [])
  assert.deepEqual(tiposDisponibles(solo('promociones'), true).map((t) => t.key), ['publica'])
  assert.deepEqual(tiposDisponibles(solo('deals'), true).map((t) => t.key), ['catalogo'])
})

test('la pestaña abierta es la pedida si se puede abrir; si no, la primera; sin ninguna, nada', () => {
  const todos = tiposDisponibles(puedeTodo, true)
  assert.equal(tipoActivo('vip', todos), 'vip')
  assert.equal(tipoActivo(undefined, todos), 'publica')
  assert.equal(tipoActivo('inventado', todos), 'publica')
  // Pedir una pestaña que NO se puede abrir no la abre: cae a la primera permitida.
  assert.equal(tipoActivo('catalogo', tiposDisponibles(solo('marketing'), true)), 'relampago')
  assert.equal(tipoActivo('vip', []), null)
})

test('el estado se dice en texto y con un tono semántico, para cada tipo', () => {
  assert.deepEqual(estadoDeBeneficio('publica', true), { etiqueta: 'Activa', tono: 'exito' })
  assert.deepEqual(estadoDeBeneficio('publica', false), { etiqueta: 'Pausada', tono: 'aviso' })
  assert.deepEqual(estadoDeBeneficio('relampago', 'ACTIVA'), { etiqueta: 'Activa', tono: 'exito' })
  assert.deepEqual(estadoDeBeneficio('vip', 'PAUSADA'), { etiqueta: 'Pausada', tono: 'aviso' })
  assert.deepEqual(estadoDeBeneficio('catalogo', 'DRAFT'), { etiqueta: 'Borrador', tono: 'pendiente' })
  assert.deepEqual(estadoDeBeneficio('catalogo', 'BUDGET_EXHAUSTED'), { etiqueta: 'Sin presupuesto', tono: 'aviso' })
  assert.deepEqual(estadoDeBeneficio('catalogo', 'COMPLETED'), { etiqueta: 'Finalizada', tono: 'neutro' })
  assert.deepEqual(estadoDeBeneficio('vip', 'FINALIZADA'), { etiqueta: 'Finalizada', tono: 'neutro' })
  // Un estado que el sistema no conoce se muestra tal cual, sin color de alarma ni silencio.
  assert.deepEqual(estadoDeBeneficio('vip', 'RARO'), { etiqueta: 'RARO', tono: 'neutro' })
})

// ── Lectura: un `tx` falso que registra qué se consulta ──────────────────────────────────────────────────────────────

type Llamada = { modelo: string; metodo: string; args: Record<string, unknown> }

function txFalso(datos: Partial<Record<string, unknown[]>>, fallan: string[] = []) {
  const llamadas: Llamada[] = []
  const modelo = (nombre: string) => ({
    count: async (args: Record<string, unknown>) => {
      llamadas.push({ modelo: nombre, metodo: 'count', args })
      if (fallan.includes(nombre)) throw new Error('caída')
      return (datos[nombre] ?? []).length
    },
    findMany: async (args: Record<string, unknown>) => {
      llamadas.push({ modelo: nombre, metodo: 'findMany', args })
      if (fallan.includes(nombre)) throw new Error('caída')
      return datos[nombre] ?? []
    },
  })
  const tx = {
    promocion: modelo('promocion'),
    marketingCampaign: modelo('marketingCampaign'),
    ofertaPrivada: modelo('ofertaPrivada'),
    deal: modelo('deal'),
  }
  return { tx: tx as never, llamadas }
}

test('los conteos consultan SOLO los tipos que la persona puede ver, con el mismo filtro que el hub', async () => {
  const { tx, llamadas } = txFalso({ promocion: [{}, {}, {}], marketingCampaign: [{}] })
  const total = await contarBeneficios(tx, 'emp1', tiposDisponibles(solo('promociones', 'marketing'), true))
  assert.deepEqual(total, { publica: 3, relampago: 1, vip: 0, catalogo: 0 })
  assert.deepEqual(llamadas.map((l) => l.modelo).sort(), ['marketingCampaign', 'promocion'], 'no consulta lo que no se muestra')
  assert.deepEqual(llamadas.find((l) => l.modelo === 'promocion')!.args, { where: { companyId: 'emp1', archivada: false } })
  // Siempre dentro de la empresa.
  for (const l of llamadas) assert.equal((l.args.where as { companyId: string }).companyId, 'emp1')
})

test('los conteos del catálogo dejan fuera lo archivado', async () => {
  const { tx, llamadas } = txFalso({ deal: [{}] })
  await contarBeneficios(tx, 'emp1', tiposDisponibles(puedeTodo, true))
  assert.deepEqual(llamadas.find((l) => l.modelo === 'deal')!.args, { where: { companyId: 'emp1', status: { not: 'ARCHIVED' } } })
})

test('si el conteo de un tipo falla, ese tipo cae a 0 y los demás siguen', async () => {
  const { tx } = txFalso({ promocion: [{}, {}], ofertaPrivada: [{}] }, ['marketingCampaign'])
  const total = await contarBeneficios(tx, 'emp1', tiposDisponibles(puedeTodo, false))
  assert.deepEqual(total, { publica: 2, relampago: 0, vip: 1, catalogo: 0 })
})

test('la lista trae los más recientes del tipo abierto, solo de la empresa, con lo mínimo y el enlace de edición', async () => {
  const fecha = new Date('2026-11-30T12:00:00Z')
  const { tx, llamadas } = txFalso({
    promocion: [{ id: 'p1', titulo: 'Martes 2x1', activo: true, vigenciaHasta: fecha }],
    marketingCampaign: [{ id: 'm1', titulo: 'Happy Hour', estado: 'PAUSADA' }],
    ofertaPrivada: [{ id: 'v1', titulo: 'Regalo socios', estado: 'ACTIVA', vigenciaHasta: null }],
    deal: [{ id: 'd1', title: 'Corte + barba', status: 'DRAFT', endsAt: fecha }],
  })
  assert.deepEqual(await listarBeneficios(tx, 'emp1', 'publica'), [
    { id: 'p1', titulo: 'Martes 2x1', estado: { etiqueta: 'Activa', tono: 'exito' }, hasta: fecha, href: '/admin/promociones/p1/editar' },
  ])
  assert.deepEqual(await listarBeneficios(tx, 'emp1', 'relampago'), [
    { id: 'm1', titulo: 'Happy Hour', estado: { etiqueta: 'Pausada', tono: 'aviso' }, hasta: null, href: '/admin/marketing/m1/editar' },
  ])
  assert.deepEqual(await listarBeneficios(tx, 'emp1', 'vip'), [
    { id: 'v1', titulo: 'Regalo socios', estado: { etiqueta: 'Activa', tono: 'exito' }, hasta: null, href: '/admin/ofertas/v1' },
  ])
  assert.deepEqual(await listarBeneficios(tx, 'emp1', 'catalogo'), [
    { id: 'd1', titulo: 'Corte + barba', estado: { etiqueta: 'Borrador', tono: 'pendiente' }, hasta: fecha, href: '/admin/deals/d1' },
  ])
  // Una consulta por llamada, nunca más de 25 filas, de la empresa y de la más reciente a la más antigua.
  assert.equal(llamadas.filter((l) => l.metodo === 'findMany').length, 4)
  for (const l of llamadas) {
    assert.equal(l.args.take, 25)
    assert.deepEqual(l.args.orderBy, { createdAt: 'desc' })
    assert.equal((l.args.where as { companyId: string }).companyId, 'emp1')
  }
})

test('si la lista falla devuelve null (la página dice que no pudo cargar), no una lista vacía que diría «no hay nada»', async () => {
  const { tx } = txFalso({}, ['promocion'])
  const silencio = console.error
  console.error = () => {}
  try {
    assert.equal(await listarBeneficios(tx, 'emp1', 'publica'), null)
  } finally {
    console.error = silencio
  }
})

// ── Dibujo ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const FILAS: FilaBeneficio[] = [
  { id: 'p1', titulo: 'Martes 2x1', estado: { etiqueta: 'Activa', tono: 'exito' }, hasta: new Date('2026-11-30T12:00:00Z'), href: '/admin/promociones/p1/editar' },
  { id: 'p2', titulo: 'Sin fecha', estado: { etiqueta: 'Pausada', tono: 'aviso' }, hasta: null, href: '/admin/promociones/p2/editar' },
]
const PUBLICA = TIPOS_BENEFICIO[0]!
const regional = { idioma: 'es-DO', zonaHoraria: 'America/Santo_Domingo' }
const pinta = (p: Partial<Parameters<typeof TablaBeneficios>[0]> = {}) =>
  renderToStaticMarkup(h(TablaBeneficios, { tipo: PUBLICA, filas: FILAS, total: 2, regional, ...p }) as never)

test('la tabla lleva caption, el título enlaza a su edición y el estado se dice con texto', () => {
  const html = pinta()
  assert.match(html, /<caption class="sr-only">Promociones públicas, las más recientes primero<\/caption>/)
  assert.match(html, /<a[^>]*href="\/admin\/promociones\/p1\/editar"[^>]*>Martes 2x1<\/a>/)
  assert.match(html, />Activa</)
  assert.match(html, />Pausada</)
  // Sin fecha de vigencia: se dice, no se deja en blanco.
  assert.match(html, /Sin dato/)
  assert.match(html, /<time dateTime="2026-11-30T12:00:00\.000Z">/)
})

test('el pie dice cuántos hay, y «Ver todos» entra al panel de gestión del tipo', () => {
  assert.match(pinta(), /2 en total/)
  assert.match(pinta(), /href="\/admin\/promociones"[^>]*>Ver todos/)
  assert.match(pinta({ total: 60 }), /Los 2 más recientes de 60/)
  assert.doesNotMatch(pinta({ filas: [], total: 0 }), /Ver todos/)
})

test('sin beneficios de ese tipo, el vacío dice qué es y ofrece crear el del TIPO abierto', () => {
  const html = pinta({ filas: [], total: 0 })
  assert.match(html, /Todavía no hay promociones públicas/)
  assert.match(html, /Descuento o beneficio visible para todos/)
  assert.match(html, /href="\/admin\/promociones\/nuevo"[^>]*>Crear promoción pública/)
})

// ── La página ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('la página es una vista con pestañas y UN solo «Crear beneficio»; ya no reparte botones de crear por tipo', () => {
  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/ofertas/page.tsx', 'utf8'))
  assert.equal((pagina.match(/Crear beneficio/g) ?? []).length, 1, 'un único «Crear beneficio»')
  assert.match(pagina, /href="\/admin\/ofertas\/crear"/)
  assert.match(pagina, /<NavSeccion/)
  assert.doesNotMatch(pagina, /crearHref|crearLabel|Nueva promoción|Nuevo banner|Nuevo regalo VIP|Nueva oferta/, 'los botones por tipo se fueron')
  assert.ok(pagina.split('\n').length <= 120, 'la página sigue siendo corta')
  // Las pestañas y la lista salen de UNA transacción.
  assert.equal((pagina.match(/conEmpresa\(/g) ?? []).length, 1)
})

test('la página de crear ofrece los mismos tipos que las pestañas, filtrados por permiso y por capacidad', () => {
  const crear = sinComentarios(readFileSync('src/app/(admin)/admin/ofertas/crear/page.tsx', 'utf8'))
  assert.match(crear, /tiposDisponibles\(/)
  assert.match(crear, /DEALS_MARKETPLACE/)
  assert.match(crear, /href=\{t\.crearHref\}/)
  assert.doesNotMatch(crear, /\/admin\/(promociones|marketing|deals)\//, 'no cablea ninguna ruta de formulario a mano')
})

test('el menú sigue apuntando a /admin/ofertas y la ruta de crear no choca con la del detalle', () => {
  const nav = readFileSync('src/components/layout/nav-config.ts', 'utf8')
  assert.match(nav, /href: '\/admin\/ofertas'/)
  // `/admin/ofertas/[id]` es dinámica: «crear» debe ser un segmento estático propio, que gana al dinámico.
  const crear = readFileSync('src/app/(admin)/admin/ofertas/crear/page.tsx', 'utf8')
  assert.match(crear, /export default async function CrearBeneficioPage/)
})
