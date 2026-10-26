import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClientesTable, type ClienteRow } from '../src/components/admin/ClientesTable'

/**
 * EL DIRECTORIO DE CLIENTES TIENE UNA SOLA PAGINACIÓN (auditoría admin · fase 5, tarea 5.3; 06 · T-10, T-15).
 *
 * Era un `DataTable` de cliente con `pageSize={25}` sobre las 50 filas que ya paginaba el servidor: dos paginaciones apiladas.
 * Ahora es la `Tabla` de servidor. Se renderiza la pieza real y se mira lo que importa: marcado accesible, qué dice cada
 * celda, qué dice el vacío y que ya no queda ninguna paginación de cliente.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const FILAS: ClienteRow[] = [
  {
    id: 'c1',
    nombre: 'María del Carmen Pérez',
    email: 'maria@ejemplo.do',
    createdAt: new Date('2026-10-20T15:30:00Z'),
    memberships: [{ id: 'm1', estado: 'ACTIVA' as never, plan: { nombre: 'Silver' } }],
    semaforo: { estado: 'EN_RIESGO' as never, motivo: 'Lleva 12 días sin venir', diasSinVenir: 12 },
  },
  {
    id: 'c2',
    nombre: 'Luis Alberto Ramírez',
    email: 'luis@ejemplo.do',
    createdAt: new Date('2026-10-19T02:00:00Z'),
    memberships: [],
    semaforo: { estado: 'ACTIVO' as never, motivo: 'Viene con normalidad', diasSinVenir: null },
  },
  { id: 'c3', nombre: 'Sin semáforo', email: 's@ejemplo.do', createdAt: new Date('2026-10-18T12:00:00Z'), memberships: [] },
]

const pinta = (p: Partial<Parameters<typeof ClientesTable>[0]> = {}) =>
  renderToStaticMarkup(h(ClientesTable, { data: FILAS, regional: { idioma: 'es-DO', zonaHoraria: 'America/Santo_Domingo' }, ...p }) as never)

test('la tabla lleva caption, scope y el cliente como identificador de la fila, con su enlace a la ficha', () => {
  const html = pinta()
  assert.match(html, /<caption class="sr-only">Clientes, los más recientes primero<\/caption>/)
  assert.equal((html.match(/<th[^>]*scope="col"/g) ?? []).length, 5)
  assert.match(html, /<th[^>]*scope="row"[^>]*>\s*<a[^>]*href="\/admin\/clientes\/c1"[^>]*>María del Carmen Pérez<\/a>/)
  // El icono de «Acciones» ya no hace falta: el nombre lleva a la misma ficha.
  assert.doesNotMatch(html, />Acciones</)
})

test('cada celda dice lo que decía: plan y estado de la membresía, semáforo con su número, «—» donde no hay', () => {
  const html = pinta()
  assert.match(html, /Silver/)
  assert.match(html, /hace 12 d que no viene/)
  assert.match(html, /nunca ha venido/)
  // Cliente sin membresía: guion con su texto para lectores; sin semáforo: guion.
  assert.ok((html.match(/<span class="text-muted-foreground">—<\/span>/g) ?? []).length >= 3)
})

test('la hora del registro es la de la zona de la empresa (no la del servidor)', () => {
  // 15:30 UTC del 20 de octubre = 11:30 en Santo Domingo (UTC-4).
  assert.match(pinta(), /<time dateTime="2026-10-20T15:30:00\.000Z">[^<]*11:30[^<]*<\/time>/)
})

test('en una pantalla estrecha se ocultan las columnas de menos prioridad, NUNCA «Estado»', () => {
  const html = pinta()
  const cabecera = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'))
  const th = (nombre: string) => cabecera.match(new RegExp(`<th[^>]*>${nombre}</th>`))?.[0] ?? ''
  assert.doesNotMatch(th('Estado'), /max-md:hidden|max-lg:hidden/, 'Estado quedaba fuera de pantalla a 390 px (T-10)')
  assert.match(th('Membresía'), /max-md:hidden/)
  assert.match(th('Registrado'), /max-lg:hidden/)
})

test('el vacío dice la verdad: no hay clientes, ninguno coincide, o la carga falló', () => {
  assert.match(pinta({ data: [] }), /Todavía no hay clientes/)
  const filtrado = pinta({ data: [], hayFiltros: true })
  assert.match(filtrado, /Ningún cliente coincide/)
  assert.match(filtrado, /href="\/admin\/clientes"[^>]*>Limpiar filtros/)
  // Una carga que falla NO puede decir «todavía no hay clientes»: sería falso.
  const fallo = pinta({ data: [], fallo: true })
  assert.match(fallo, /No se pudieron cargar los clientes/)
  assert.doesNotMatch(fallo, /Todavía no hay clientes/)
})

test('ya no hay paginación de cliente: la tabla no pagina y la página lleva UNA sola', () => {
  // Con 60 filas, la tabla las pinta todas (la página del servidor ya trajo solo las suyas).
  const muchas = Array.from({ length: 60 }, (_, i) => ({ ...FILAS[2]!, id: `x${i}`, nombre: `Cliente ${i}` }))
  const html = pinta({ data: muchas })
  assert.equal((html.match(/<tr/g) ?? []).length, 61, 'cabecera + 60 filas, sin página interna')
  assert.doesNotMatch(html, /Página \d+ de \d+|Siguiente|Anterior/)

  const fuente = sinComentarios(readFileSync('src/components/admin/ClientesTable.tsx', 'utf8'))
  assert.doesNotMatch(fuente, /'use client'|DataTable|pageSize|@tanstack/, 'ni cliente, ni DataTable, ni tamaño de página')

  const pagina = sinComentarios(readFileSync('src/app/(admin)/admin/clientes/page.tsx', 'utf8'))
  assert.equal((pagina.match(/aria-label="Paginación"/g) ?? []).length, 1, 'una sola paginación en la página')
})

test('el pie de la tabla aloja la paginación del servidor', () => {
  const html = pinta({ pie: h('nav', { 'aria-label': 'Paginación' }, 'Página 1 de 8') as never })
  assert.match(html, /<nav aria-label="Paginación">Página 1 de 8<\/nav>/)
})
