import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HeroSlide } from '../src/modules/home/esquema'
import { leerSlidesEditor } from '../src/modules/home/editor-contrato'
import {
  FORMATO_BANNER_NUEVO,
  FORMATO_BANNER_POR_DEFECTO,
  combinarHeroes,
  formatoAdmitePie,
  formatoRequiereTexto,
  clasePanel,
} from '../src/modules/home/banner-formatos'
import { esImagenDeBannerPropia } from '../src/modules/home/imagen-banner'

/**
 * LOS FORMATOS DEL BANNER DEL INICIO (aprobado 2026-10-29).
 *
 * Lo que más importa aquí es lo que NO debe cambiar: los banners que los
 * negocios ya guardaron no traen formato y tienen que seguir viéndose igual
 * (texto encima), no pasar a «Solo imagen» y quedarse sin titular.
 */

const base = {
  empresaId: 'emp1',
  ctaTexto: 'Ver oferta',
  ctaDestino: { tipo: 'empresa', id: 'emp1' },
}

test('un banner guardado ANTES de los formatos sigue siendo texto encima, con su titular', () => {
  const guardado = { ...base, titulo: 'Cuida tu vehículo', subtitulo: 'Especialistas', imagenUrl: null }
  const r = HeroSlide.parse(guardado)
  assert.equal(r.formato, FORMATO_BANNER_POR_DEFECTO)
  assert.equal(r.formato, 'TEXTO_ENCIMA')
  assert.equal(r.mostrarPie, true)
  assert.equal(r.colorPanel, 'CELESTE')
  const [editor] = leerSlidesEditor({ slides: [guardado] })
  assert.equal(editor?.formato, 'TEXTO_ENCIMA')
})

test('un banner NUEVO del editor nace como «Solo imagen»', () => {
  assert.equal(FORMATO_BANNER_NUEVO, 'SOLO_IMAGEN')
})

test('«Solo imagen» no exige titular; los otros dos formatos sí', () => {
  assert.equal(HeroSlide.safeParse({ ...base, titulo: '', formato: 'SOLO_IMAGEN' }).success, true)
  assert.equal(HeroSlide.safeParse({ ...base, formato: 'SOLO_IMAGEN' }).success, true)
  assert.equal(HeroSlide.safeParse({ ...base, titulo: '', formato: 'TITULAR_ARRIBA' }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, titulo: '', formato: 'TEXTO_ENCIMA' }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, titulo: '   ', formato: 'TEXTO_ENCIMA' }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, titulo: 'Hola', formato: 'TITULAR_ARRIBA' }).success, true)
})

test('un formato o un color desconocidos se rechazan en vez de caer en silencio a otro', () => {
  assert.equal(HeroSlide.safeParse({ ...base, titulo: 'x', formato: 'INVENTADO' }).success, false)
  assert.equal(HeroSlide.safeParse({ ...base, titulo: 'x', colorPanel: '#ff0000' }).success, false)
})

test('el formato decide si hay texto y si hay pie bajo la tarjeta', () => {
  assert.equal(formatoRequiereTexto('SOLO_IMAGEN'), false)
  assert.equal(formatoRequiereTexto('TITULAR_ARRIBA'), true)
  assert.equal(formatoRequiereTexto('TEXTO_ENCIMA'), true)
  assert.equal(formatoAdmitePie('SOLO_IMAGEN'), true)
  assert.equal(formatoAdmitePie('TITULAR_ARRIBA'), true)
  // «Texto encima» ya lleva dentro la tarjeta del negocio y el botón: un pie los repetiría.
  assert.equal(formatoAdmitePie('TEXTO_ENCIMA'), false)
})

test('el color del panel sale de los fondos suaves del sistema (con modo oscuro), celeste por defecto', () => {
  assert.equal(clasePanel('MENTA'), 'bg-success-soft')
  assert.equal(clasePanel(undefined), 'bg-info-soft')
  assert.equal(clasePanel(null), 'bg-info-soft')
  assert.equal(HeroSlide.safeParse({ ...base, titulo: 'x', colorPanel: 'DURAZNO' }).success, false)
})

test('los banners configurados van primero, los automáticos rellenan y un destino no se repite', () => {
  const configurados = [{ href: '/a', id: 'c1' }, { href: '/b', id: 'c2' }]
  const automaticos = [{ href: '/b', id: 'p-dup' }, { href: '/x', id: 'p1' }, { href: '/y', id: 'p2' }, { href: '/z', id: 'p3' }]
  const r = combinarHeroes(configurados, automaticos, 4)
  assert.deepEqual(r.map((h) => h.id), ['c1', 'c2', 'p1', 'p2'])
  assert.deepEqual(combinarHeroes([], automaticos, 2).map((h) => h.id), ['p-dup', 'p1'])
  assert.deepEqual(combinarHeroes(configurados, [], 4).map((h) => h.id), ['c1', 'c2'])
})

const SUPA = 'https://abc.supabase.co'
const PREFIJO = `${SUPA}/storage/v1/object/public/promociones/emp1/banners/`

test('una imagen de banner subida por la empresa se acepta; la de otra empresa o fuera de la carpeta, no', () => {
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}1730000000-ab12cd.jpg`, 'emp1', SUPA), true)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}1730000000-ab12cd.jpg`, 'emp2', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${SUPA}/storage/v1/object/public/promociones/emp1/otra/x.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${SUPA}/storage/v1/object/public/logos/emp1/banners/x.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia('https://otro.example/emp1/banners/x.jpg', 'emp1', SUPA), false)
})

test('una URL con «..», subcarpetas o escapes no se cuela por el prefijo (el CDN la normalizaría a otra empresa)', () => {
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}../../emp2/banners/x.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}sub/x.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}..%2Femp2%2Fx.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}.oculto.jpg`, 'emp1', SUPA), false)
  assert.equal(esImagenDeBannerPropia(`${PREFIJO}x.jpg?v=1`, 'emp1', SUPA), false)
})

test('la subida exige sesión, sección y capacidad ANTES de escribir, y la empresa sale de la sesión', () => {
  const src = readFileSync(join(__dirname, '..', 'src/modules/home/imagen-banner-accion.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const subida = src.indexOf('.upload(')
  assert.ok(subida > 0)
  for (const guardia of ["requireSection('personalizacion')", 'resolveCompanyId(user)', "tieneCapacidad(empresa, 'HOME_BUILDER')", 'detectarTipoImagen(buffer)']) {
    const i = src.indexOf(guardia)
    assert.ok(i >= 0 && i < subida, `falta «${guardia}» antes de subir`)
  }
  assert.match(src, /upsert: false/, 'nunca se sobrescribe un objeto')
  assert.doesNotMatch(src, /formData\.get\('companyId'\)/, 'la empresa no se lee del navegador')
})
