import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HeroSlide } from '../src/modules/home/esquema'
import { leerSlidesEditor } from '../src/modules/home/editor-contrato'
import { MAX_ITEMS_BANNER, limpiarTituloDeColeccion, parsearIdsDeColeccion } from '../src/modules/home/coleccion'
import { rutaDeColeccion } from '../src/modules/comercio/rutas'

/**
 * UN BANNER ENGANCHADO A PRODUCTOS Y SERVICIOS (aprobado 2026-10-29).
 *
 * Al tocarlo se abre una colección: los ítems que el negocio marcó, y debajo
 * lo de empresas relacionadas. Aquí se prueba el contrato: el esquema, la ruta
 * y lo que la página acepta de la URL. La parte con base (qué ítems son
 * públicos, qué empresas son «relacionadas») está en `catalog/publico.ts` y se
 * comprueba por su código al final.
 */

const base = {
  titulo: 'Lo mejor del mes',
  empresaId: 'emp1',
  ctaTexto: 'Ver todo',
}

test('un banner con destino «Productos y servicios» exige al menos un ítem y el destino es el primero', () => {
  const ok = HeroSlide.safeParse({ ...base, ctaDestino: { tipo: 'catalogo', id: 'item-a' }, itemIds: ['item-a', 'item-b'] })
  assert.equal(ok.success, true)
  assert.deepEqual(ok.data?.itemIds, ['item-a', 'item-b'])
  assert.equal(HeroSlide.safeParse({ ...base, ctaDestino: { tipo: 'catalogo', id: 'item-a' }, itemIds: [] }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, ctaDestino: { tipo: 'catalogo', id: 'item-a' } }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, ctaDestino: { tipo: 'catalogo', id: 'otro' }, itemIds: ['item-a'] }).success, false)
  // Con tope: más de MAX_ITEMS_BANNER no entra.
  const muchos = Array.from({ length: MAX_ITEMS_BANNER + 1 }, (_, k) => `item-${k}`)
  assert.equal(HeroSlide.safeParse({ ...base, ctaDestino: { tipo: 'catalogo', id: muchos[0] }, itemIds: muchos }).success, false)
})

test('los destinos de siempre no necesitan ítems y los guardados sin «itemIds» siguen valiendo', () => {
  const r = HeroSlide.parse({ ...base, ctaDestino: { tipo: 'empresa', id: 'emp1' } })
  assert.deepEqual(r.itemIds, [])
  const [editor] = leerSlidesEditor({ slides: [{ ...base, imagenUrl: null, ctaDestino: { tipo: 'plan', id: 'plan-a' } }] })
  assert.deepEqual(editor?.itemIds, [])
  const [conItems] = leerSlidesEditor({ slides: [{ ...base, imagenUrl: null, ctaDestino: { tipo: 'catalogo', id: 'a1' }, itemIds: ['a1', 'b2'] }] })
  assert.equal(conItems?.ctaTipo, 'catalogo')
  assert.deepEqual(conItems?.itemIds, ['a1', 'b2'])
})

test('la ruta de la colección lleva los ids y el título, en la app y en la landing', () => {
  assert.equal(rutaDeColeccion('app', 'cartown', ['a1', 'b2']), '/cliente/empresas/cartown/coleccion?i=a1%2Cb2')
  assert.equal(
    rutaDeColeccion('publico', 'cartown', ['a1'], 'Tu primer lavado, gratis'),
    '/empresas/cartown/coleccion?i=a1&t=Tu+primer+lavado%2C+gratis'
  )
})

test('la página solo acepta ids limpios de la URL: sin repetidos, sin basura y con tope', () => {
  assert.deepEqual(parsearIdsDeColeccion('clx1abcdef0001, clx1abcdef0002,clx1abcdef0001'), ['clx1abcdef0001', 'clx1abcdef0002'])
  assert.deepEqual(parsearIdsDeColeccion(['clx1abcdef0001', 'clx1abcdef0003']), ['clx1abcdef0001', 'clx1abcdef0003'])
  assert.deepEqual(parsearIdsDeColeccion('../x,<script>,clx1abcdef0001'), ['clx1abcdef0001'])
  assert.deepEqual(parsearIdsDeColeccion(undefined), [])
  assert.deepEqual(parsearIdsDeColeccion(''), [])
  const muchos = Array.from({ length: 30 }, (_, k) => `clx1abcdef${String(k).padStart(4, '0')}`).join(',')
  assert.equal(parsearIdsDeColeccion(muchos).length, MAX_ITEMS_BANNER)
})

test('el título de la URL se recorta y se limpia; vacío es null', () => {
  assert.equal(limpiarTituloDeColeccion('  Lo mejor\n del mes  '), 'Lo mejor del mes')
  assert.equal(limpiarTituloDeColeccion(''), null)
  assert.equal(limpiarTituloDeColeccion(undefined), null)
  assert.equal(limpiarTituloDeColeccion('x'.repeat(200))?.length, 80)
})

const fuente = (ruta: string) =>
  readFileSync(join(__dirname, '..', ruta), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('los ítems de la colección se filtran por empresa Y por visibilidad pública, y salen en el orden pedido', () => {
  const src = fuente('src/modules/catalog/publico.ts')
  const fn = src.slice(src.indexOf('export async function itemsPublicosPorIds'), src.indexOf('export async function catalogoDeEmpresasRelacionadas'))
  assert.match(fn, /id: \{ in: limpios \}, companyId, company: EMPRESA_VISIBLE, \.\.\.itemVisible\(/)
  assert.match(fn, /empresaPublicaCatalogo\(companyId\)/)
  assert.match(fn, /limpios\s*\.map\(\(id\) => porId\.get\(id\)\)/, 'el orden lo pone la colección, no la base')
})

test('«relacionadas» = misma categoría de negocio, sin la propia empresa; cae a la ciudad y luego a todo', () => {
  const src = fuente('src/modules/catalog/publico.ts')
  const fn = src.slice(src.indexOf('export async function catalogoDeEmpresasRelacionadas'), src.indexOf('export interface FiltrosDescubrimiento'))
  assert.match(fn, /companyId: \{ not: companyId \}/)
  assert.match(fn, /categories: \{ some: \{ categoryId: \{ in: categorias \} \} \}/)
  assert.match(fn, /ciudad: empresa\.ciudad/)
  assert.match(fn, /empresaPublicaCatalogo\(id\)/)
})

test('al guardar, cada ítem de la colección debe ser de la empresa y estar activo', () => {
  const src = fuente('src/modules/home/acciones.ts')
  assert.match(src, /destino\.tipo === 'catalogo'/)
  assert.match(src, /id: \{ in: \[\.\.\.itemIds\] \}, companyId, status: 'ACTIVE'/)
  assert.match(src, /validarDestino\(companyId, s\.ctaDestino, s\.itemIds\)/)
})
