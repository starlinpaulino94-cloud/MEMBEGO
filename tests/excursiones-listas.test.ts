import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LARGO_MAXIMO_BUSQUEDA, condicionDeVer, leerBusqueda, leerVer, opcionesDeVer, tonoDeChip } from '../src/modules/excursiones/lista-comun'
import {
  OPCIONES_VER_CATALOGO,
  condicionDeEstadoCatalogo,
  leerFiltrosCatalogo,
  tonoDeExcursion,
} from '../src/modules/excursiones/catalogo/lista'
import {
  OPCIONES_VER_VENDEDORES,
  condicionDeEstadoVendedores,
  leerFiltrosVendedores,
  tonoDeVendedor,
} from '../src/modules/excursiones/vendedores/lista'
import { ESTADOS_EXCURSION, ESTADO_EXCURSION_LABEL } from '../src/modules/excursiones/catalogo/nucleo'
import { ESTADOS_VENDEDOR, ESTADO_VENDEDOR_LABEL } from '../src/modules/excursiones/vendedores/nucleo'
import { CatalogoTabla, type ActividadFila } from '../src/components/excursiones/CatalogoTabla'
import { VendedoresTabla, type VendedorFila } from '../src/components/excursiones/VendedoresTabla'
import { TONOS_ESTADO } from '../packages/ui/src/ui/estado-chip'

/**
 * CATÁLOGO Y VENDEDORES, COMO LISTADOS DE SERVIDOR (auditoría admin · fase 7, tarea 7.1; 06 · T-04, T-05).
 *
 * Eran listas de cliente con la búsqueda y el botón de archivadas/inactivos en estado local: lo que se veía no se podía compartir ni
 * sobrevivía a recargar, y no había página. Aquí: la mecánica común de leer la URL, lo que decide cada lista y el marcado de las dos
 * tablas. La consulta contra la base se verificó en el entorno de QA.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── La mecánica común ────────────────────────────────────────────────────────

test('la búsqueda se recorta y se acota; un parámetro repetido cuenta una vez; sin parámetro es vacía', () => {
  assert.equal(leerBusqueda(undefined), '')
  assert.equal(leerBusqueda('  saona  '), 'saona')
  assert.equal(leerBusqueda('x'.repeat(1000)).length, LARGO_MAXIMO_BUSQUEDA)
  assert.equal(leerBusqueda(['uno', 'dos']), 'uno')
})

test('«ver»: el valor por defecto, «todas» o un estado de ESA lista; cualquier otra cosa es el valor por defecto', () => {
  const E = ['A', 'B'] as const
  assert.equal(leerVer(undefined, E, 'abiertas'), 'abiertas')
  assert.equal(leerVer('todas', E, 'abiertas'), 'todas')
  assert.equal(leerVer('B', E, 'abiertas'), 'B')
  for (const basura of ['', 'C', 'b', 'abiertas', "x'; --"]) assert.equal(leerVer(basura, E, 'abiertas'), 'abiertas', basura)
})

test('la condición de estado: por defecto esconde lo terminado; «todas» no filtra; un estado filtra por él', () => {
  assert.deepEqual(condicionDeVer('abiertas', 'abiertas', ['X', 'Y']), { estado: { notIn: ['X', 'Y'] } })
  assert.deepEqual(condicionDeVer('todas', 'abiertas', ['X']), {})
  assert.deepEqual(condicionDeVer<string, 'abiertas'>('Z', 'abiertas', ['X']), { estado: 'Z' })
})

test('el selector tiene «todas» primero y cada estado con su texto', () => {
  assert.deepEqual(opcionesDeVer(['A', 'B'] as const, { A: 'Uno', B: 'Dos' }, 'Todas'), [
    { valor: 'todas', etiqueta: 'Todas' },
    { valor: 'A', etiqueta: 'Uno' },
    { valor: 'B', etiqueta: 'Dos' },
  ])
})

test('el tono del chip: cada tono viejo tiene el suyo del sistema de diseño y lo desconocido es neutro', () => {
  assert.equal(tonoDeChip('success'), 'exito')
  assert.equal(tonoDeChip('warning'), 'aviso')
  assert.equal(tonoDeChip('danger'), 'peligro')
  assert.equal(tonoDeChip('info'), 'info')
  assert.equal(tonoDeChip('neutral'), 'neutro')
  assert.equal(tonoDeChip(undefined), 'neutro')
})

// ── Catálogo ─────────────────────────────────────────────────────────────────

test('catálogo: por defecto «activas» (todo menos lo archivado); cada estado y «todas» se entienden', () => {
  assert.deepEqual(leerFiltrosCatalogo({}), { q: '', ver: 'activas' })
  assert.equal(leerFiltrosCatalogo({ ver: 'todas' }).ver, 'todas')
  for (const e of ESTADOS_EXCURSION) assert.equal(leerFiltrosCatalogo({ ver: e }).ver, e)
  assert.equal(leerFiltrosCatalogo({ ver: 'borradas' }).ver, 'activas')
  assert.deepEqual(condicionDeEstadoCatalogo('activas'), { estado: { notIn: ['ARCHIVADA'] } })
  assert.deepEqual(condicionDeEstadoCatalogo('todas'), {})
  assert.deepEqual(condicionDeEstadoCatalogo('PAUSADA'), { estado: 'PAUSADA' })
  assert.deepEqual(OPCIONES_VER_CATALOGO.map((o) => o.valor), ['todas', ...ESTADOS_EXCURSION])
  for (const e of ESTADOS_EXCURSION) assert.ok((TONOS_ESTADO as readonly string[]).includes(tonoDeExcursion(e)), e)
  assert.equal(tonoDeExcursion('ACTIVA'), 'exito')
  assert.equal(tonoDeExcursion('AGOTADA'), 'peligro')
  assert.equal(ESTADO_EXCURSION_LABEL.ARCHIVADA, 'Archivada')
})

const ACTIVIDAD: ActividadFila = {
  id: 'a1', nombre: 'Isla Saona', tipoItem: 'COMBO', categoria: 'Playa', moneda: 'USD', estado: 'ACTIVA', precioDesde: 85, variantes: 3, horarios: 2, enCombo: 4,
}
const VACIO = { titulo: 'Todavía no hay nada' }
const SIN = { titulo: 'Nada coincide' }

test('catálogo · tabla: la actividad es el identificador con su enlace y su insignia de combo; «Desde» a la derecha; sin precio se dice', () => {
  const html = renderToStaticMarkup(h(CatalogoTabla, { filas: [ACTIVIDAD, { ...ACTIVIDAD, id: 'a2', nombre: 'Buggies', tipoItem: 'ACTIVIDAD', precioDesde: null }], vacio: VACIO, sinResultados: SIN, hayFiltros: false }) as never)
  assert.match(html, /<caption class="sr-only">Actividades del catálogo, por estado y nombre<\/caption>/)
  assert.equal((html.match(/<th[^>]*scope="col"/g) ?? []).length, 6)
  assert.match(html, /<th[^>]*scope="row"[^>]*>[\s\S]*?<a[^>]*href="\/admin\/excursiones\/catalogo\/a1"[^>]*>Isla Saona<\/a>/)
  assert.match(html, /Combo \(4\)/)
  assert.doesNotMatch(html.slice(html.indexOf('Buggies')), /Combo \(/, 'una actividad suelta no lleva la insignia')
  assert.match(html, /<td[^>]*text-right[^>]*>[^<]*85[^<]*<\/td>/)
  assert.match(html, /<span class="sr-only">Sin precio<\/span>/)
  const cabecera = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
  assert.match(cabecera.match(/<th[^>]*>Categoría<\/th>/)?.[0] ?? '', /max-md:hidden/)
  assert.doesNotMatch(cabecera.match(/<th[^>]*>Estado<\/th>/)?.[0] ?? '', /max-md:hidden|max-lg:hidden/)
})

// ── Vendedores ───────────────────────────────────────────────────────────────

test('vendedores: por defecto «activos» (suspendidos SÍ se ven, inactivos no); cada estado y «todas» se entienden', () => {
  assert.deepEqual(leerFiltrosVendedores({}), { q: '', ver: 'activos' })
  assert.equal(leerFiltrosVendedores({ ver: 'todas' }).ver, 'todas')
  for (const e of ESTADOS_VENDEDOR) assert.equal(leerFiltrosVendedores({ ver: e }).ver, e)
  assert.equal(leerFiltrosVendedores({ ver: 'archivados' }).ver, 'activos')
  assert.deepEqual(condicionDeEstadoVendedores('activos'), { estado: { notIn: ['INACTIVO'] } })
  assert.deepEqual(condicionDeEstadoVendedores('todas'), {})
  assert.deepEqual(OPCIONES_VER_VENDEDORES.map((o) => o.valor), ['todas', ...ESTADOS_VENDEDOR])
  for (const e of ESTADOS_VENDEDOR) assert.ok((TONOS_ESTADO as readonly string[]).includes(tonoDeVendedor(e)), e)
  assert.equal(tonoDeVendedor('SUSPENDIDO'), 'aviso')
  assert.equal(tonoDeVendedor('INACTIVO'), 'neutro')
  assert.equal(ESTADO_VENDEDOR_LABEL.SUSPENDIDO, 'Suspendido')
})

const VENDEDOR: VendedorFila = { id: 'v1', nombre: 'Ana', apellido: 'Gómez', codigo: 'ANA-01', tipo: 'Agencia', telefono: null, estado: 'ACTIVO', _count: { atribuciones: 12 } }

test('vendedores · tabla: nombre completo como identificador, código monoespaciado, captados numéricos y «—» donde no hay dato', () => {
  const html = renderToStaticMarkup(h(VendedoresTabla, { filas: [VENDEDOR], vacio: VACIO, sinResultados: SIN, hayFiltros: false }) as never)
  assert.match(html, /<caption class="sr-only">Equipo de vendedores, por estado y nombre<\/caption>/)
  assert.equal((html.match(/<th[^>]*scope="col"/g) ?? []).length, 6)
  assert.match(html, /<th[^>]*scope="row"[^>]*>[\s\S]*?<a[^>]*href="\/admin\/excursiones\/vendedores\/v1"[^>]*>Ana Gómez<\/a>/)
  assert.match(html, /<span class="font-mono">ANA-01<\/span>/)
  assert.match(html, /<td[^>]*text-right tabular-nums[^>]*>12<\/td>/)
  assert.match(html, /<span class="sr-only">Sin dato<\/span>/, 'el teléfono vacío se dice')
  const sinApellido = renderToStaticMarkup(h(VendedoresTabla, { filas: [{ ...VENDEDOR, apellido: null }], vacio: VACIO, sinResultados: SIN, hayFiltros: false }) as never)
  assert.match(sinApellido, />Ana<\/a>/, 'sin apellido no queda un espacio colgando')
})

test('el vacío dice la verdad en ambas tablas: no hay nada, o el filtro no encontró nada', () => {
  for (const Tabla of [CatalogoTabla, VendedoresTabla] as const) {
    const real = renderToStaticMarkup(h(Tabla as never, { filas: [], vacio: { titulo: 'Todavía no hay nada' }, sinResultados: { titulo: 'Nada coincide' }, hayFiltros: false }) as never)
    assert.match(real, /Todavía no hay nada/)
    const filtrado = renderToStaticMarkup(h(Tabla as never, { filas: [], vacio: { titulo: 'Todavía no hay nada' }, sinResultados: { titulo: 'Nada coincide' }, hayFiltros: true }) as never)
    assert.match(filtrado, /Nada coincide/)
    assert.doesNotMatch(filtrado, /Todavía no hay nada/)
  }
})

// ── Las consultas y las pantallas ────────────────────────────────────────────

test('las dos consultas paginan en la base, cuentan el total y filtran por empresa', () => {
  for (const [ruta, funcion, siguiente] of [
    ['src/modules/excursiones/catalogo/queries.ts', 'listarExcursiones', 'excursionDetalle'],
    ['src/modules/excursiones/vendedores/queries.ts', 'listarVendedores', 'vendedorDetalle'],
  ] as const) {
    const src = sinComentarios(readFileSync(ruta, 'utf8'))
    const cuerpo = src.slice(src.indexOf(`export async function ${funcion}`), src.indexOf(`export async function ${siguiente}`))
    assert.match(cuerpo, /skip: paginacion\.saltar/, funcion)
    assert.match(cuerpo, /take: paginacion\.tomar/, funcion)
    assert.match(cuerpo, /\.count\(\{ where \}\)/, `${funcion}: el total real`)
    assert.match(cuerpo, /mode: 'insensitive'/, funcion)
    assert.match(cuerpo, /companyId,\s*\n?\s*\.\.\.condicionDeEstado/, `${funcion}: siempre dentro de la empresa`)
  }
})

test('las pantallas usan BarraFiltros, su tabla de servidor y TablaPaginacion; los componentes de cliente y ListaToolbar ya no existen', () => {
  for (const muerto of ['CatalogoLista', 'VendedoresLista', 'ReservasLista', 'ListaToolbar']) {
    assert.ok(!existsSync(`src/components/excursiones/${muerto}.tsx`), `${muerto} sigue existiendo`)
  }
  for (const [ruta, tabla, etiqueta] of [
    ['src/app/(admin)/admin/excursiones/catalogo/page.tsx', '<CatalogoTabla', 'actividades'],
    ['src/app/(admin)/admin/excursiones/vendedores/page.tsx', '<VendedoresTabla', 'vendedores'],
  ] as const) {
    const pagina = sinComentarios(readFileSync(ruta, 'utf8'))
    assert.match(pagina, /<BarraFiltros/, ruta)
    assert.ok(pagina.includes(tabla), ruta)
    assert.match(pagina, new RegExp(`<TablaPaginacion paginacion=\\{paginacion\\} total=\\{total\\} params=\\{sp\\} etiqueta="${etiqueta}"`), ruta)
    assert.doesNotMatch(pagina, /use client|useState|ListaToolbar/, ruta)
  }
  for (const tabla of ['CatalogoTabla', 'VendedoresTabla']) {
    assert.doesNotMatch(sinComentarios(readFileSync(`src/components/excursiones/${tabla}.tsx`, 'utf8')), /'use client'|useState|<table/, tabla)
  }
})
