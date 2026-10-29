import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { huellaDeSlide, quitarSlide } from '../src/modules/home/banner-huella'
import { rutaDeEdicionDePieza } from '../src/modules/home/banner-hero'
import {
  DIAS_NOVEDAD,
  MAX_CARRUSEL,
  MAX_POR_EMPRESA,
  aRgb,
  colorDeFondo,
  esNovedadVigente,
  formatoRealizable,
  ordenarNovedades,
  plantillaAutomatica,
  plantillasDisponibles,
  rgbAHex,
  textoSobre,
  type PiezaOrdenable,
} from '../src/modules/home/banner-formatos'
import { SIN_AJUSTE, armarCola, heroDePieza, plantillaDePieza, type AjusteBanner, type PiezaBanner } from '../src/modules/home/banner-hero'
import { ajustarParaFondo } from '../src/modules/home/color-dominante'

/**
 * EL CARRUSEL AUTOMÁTICO (aprobado 2026-10-29).
 *
 * Lo publicado entra solo, de lo más reciente a lo más viejo; la empresa
 * decide sobre cada pieza (fijar, ocultar, plantilla). Lo que se prueba aquí
 * es la regla —el orden, los topes, las plantillas elegidas solas, los colores—
 * y, por su código, que las acciones autorizan antes de escribir.
 */

const AHORA = new Date('2026-10-29T12:00:00Z')
const dias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000)
const enDias = (n: number) => new Date(AHORA.getTime() + n * 86_400_000)

function pieza(sobre: Partial<PiezaBanner> & { id: string }): PiezaBanner {
  return {
    clave: `${sobre.origen ?? 'CATALOGO'}:${sobre.id}`,
    origen: 'CATALOGO',
    companyId: 'emp1',
    empresa: { nombre: 'CARTOWN', slug: 'cartown', colorMarca: null, rubro: 'CAR_WASH' },
    titulo: `Pieza ${sobre.id}`,
    subtitulo: '',
    imagen: 'https://x/img.jpg',
    imagenes: ['https://x/img.jpg'],
    precio: 'RD$1,200',
    precioAntes: null,
    descuento: null,
    detalle: null,
    vence: null,
    publicadoEn: dias(1),
    href: `/p/${sobre.id}`,
    ...sobre,
  }
}

const ajustes = (o: Record<string, Partial<AjusteBanner>>) => new Map(Object.entries(o).map(([k, v]) => [k, { ...SIN_AJUSTE, ...v }]))

test('el carrusel va de lo más reciente a lo más viejo', () => {
  const piezas = [pieza({ id: 'a', publicadoEn: dias(5) }), pieza({ id: 'b', publicadoEn: dias(1) }), pieza({ id: 'c', publicadoEn: dias(3) })]
  assert.deepEqual(armarCola(piezas, new Map(), AHORA).map((e) => e.pieza.id), ['b', 'c', 'a'])
})

test('lo fijado va primero, por su orden, aunque sea viejo; lo oculto no sale', () => {
  const piezas = [
    pieza({ id: 'nueva', publicadoEn: dias(1) }),
    pieza({ id: 'vieja', publicadoEn: dias(20) }),
    pieza({ id: 'otra', publicadoEn: dias(10) }),
    pieza({ id: 'oculta', publicadoEn: dias(0) }),
  ]
  const a = ajustes({ 'CATALOGO:vieja': { fijado: true, orden: 2 }, 'CATALOGO:otra': { fijado: true, orden: 1 }, 'CATALOGO:oculta': { oculto: true } })
  assert.deepEqual(armarCola(piezas, a, AHORA).map((e) => e.pieza.id), ['otra', 'vieja', 'nueva'])
})

test('un producto deja de ser novedad a los 30 días, salvo fijado; una promoción dura lo que dure su vigencia', () => {
  const viejoProducto = pieza({ id: 'p', publicadoEn: dias(DIAS_NOVEDAD + 1) })
  const viejaPromo = pieza({ id: 'q', origen: 'PROMOCION', publicadoEn: dias(90), vence: enDias(5) })
  assert.equal(esNovedadVigente({ ...viejoProducto, fijado: false }, AHORA), false)
  assert.equal(esNovedadVigente({ ...viejoProducto, fijado: true }, AHORA), true)
  assert.equal(esNovedadVigente({ ...viejaPromo, fijado: false }, AHORA), true)
  assert.equal(esNovedadVigente({ ...viejaPromo, vence: dias(1), fijado: true }, AHORA), false, 'vencida no se mantiene ni fijada')
})

test('máximo seis tarjetas, y una empresa no acapara: tope por empresa, salvo lo que fijó', () => {
  const muchas = Array.from({ length: 10 }, (_, i) => pieza({ id: `e1-${i}`, publicadoEn: dias(i + 1) }))
  const otra = [pieza({ id: 'e2-a', companyId: 'emp2', publicadoEn: dias(8) }), pieza({ id: 'e2-b', companyId: 'emp2', publicadoEn: dias(9) })]
  const cola = armarCola([...muchas, ...otra], new Map(), AHORA)
  assert.equal(cola.filter((e) => e.pieza.companyId === 'emp1').length, MAX_POR_EMPRESA)
  assert.ok(cola.some((e) => e.pieza.companyId === 'emp2'), 'la otra empresa también aparece')
  assert.ok(cola.length <= MAX_CARRUSEL)
  const fijadas = ajustes(Object.fromEntries(muchas.slice(0, 5).map((p, i) => [p.clave, { fijado: true, orden: i }])))
  assert.equal(armarCola([...muchas, ...otra], fijadas, AHORA).filter((e) => e.pieza.companyId === 'emp1').length, 5, 'lo fijado no cuenta contra el tope')
})

test('ordenarNovedades respeta el límite y no cambia el original', () => {
  const base = Array.from({ length: 9 }, (_, i): PiezaOrdenable => ({ clave: `k${i}`, origen: 'CATALOGO', publicadoEn: dias(i), vence: null, fijado: false, oculto: false, orden: 0 }))
  const copia = [...base]
  assert.equal(ordenarNovedades(base, AHORA, 4).length, 4)
  assert.deepEqual(base, copia)
})

test('la plantilla se elige sola por reglas', () => {
  const p = (o: Parameters<typeof plantillaAutomatica>[0]) => plantillaAutomatica(o)
  assert.equal(p({ origen: 'PROMOCION', tieneImagen: true }), 'SOLO_IMAGEN', 'arte propio: no se le pone nada encima')
  assert.equal(p({ origen: 'PROMOCION', tieneImagen: false, tieneDescuento: true }), 'DESCUENTO_SELLO')
  assert.equal(p({ origen: 'PROMOCION', tieneImagen: false }), 'TITULAR_ARRIBA')
  assert.equal(p({ origen: 'PROMOCION', tieneImagen: true, horasParaVencer: 20 }), 'CUENTA_ATRAS', 'por vencer gana')
  assert.equal(p({ origen: 'PROMOCION', tieneImagen: true, horasParaVencer: 24 * 10 }), 'SOLO_IMAGEN')
  assert.equal(p({ origen: 'CATALOGO', tieneImagen: true }), 'PRECIO_GRANDE')
  assert.equal(p({ origen: 'OFERTA', tieneImagen: true }), 'ANTES_AHORA')
  assert.equal(p({ origen: 'OFERTA', tieneImagen: true, horasParaVencer: 5 }), 'CUENTA_ATRAS')
  assert.equal(p({ origen: 'PLAN', tieneImagen: false }), 'MEMBRESIA')
  // Una plantilla elegida a mano gana a la automática.
  assert.equal(plantillaDePieza(pieza({ id: 'z' }), { ...SIN_AJUSTE, plantilla: 'TEXTO_ENCIMA' }, AHORA), 'TEXTO_ENCIMA')
})

test('las plantillas que ofrece una pieza son las que caben en ella', () => {
  const sinFotos = plantillasDisponibles({ origen: 'CATALOGO', nImagenes: 0, vence: false })
  assert.ok(!sinFotos.includes('SOLO_IMAGEN') && !sinFotos.includes('COLLAGE') && !sinFotos.includes('TRES_EN_UNO') && !sinFotos.includes('CUENTA_ATRAS'))
  const tres = plantillasDisponibles({ origen: 'CATALOGO', nImagenes: 3, vence: false })
  assert.ok(tres.includes('COLLAGE') && tres.includes('TRES_EN_UNO'))
  assert.ok(plantillasDisponibles({ origen: 'PROMOCION', nImagenes: 1, vence: true }).includes('CUENTA_ATRAS'))
  assert.deepEqual(plantillasDisponibles({ origen: 'PLAN', nImagenes: 0, vence: false }), ['MEMBRESIA', 'TITULAR_ARRIBA'])
})

test('una plantilla que pide lo que falta cae a la más parecida, nunca a un hueco', () => {
  const nada = { imagen: null, nImagenes: 0, precio: false, precioAntes: false, vence: false }
  assert.equal(formatoRealizable('SOLO_IMAGEN', nada), 'TEXTO_ENCIMA')
  assert.equal(formatoRealizable('COLLAGE', { ...nada, imagen: 'x', nImagenes: 1 }), 'TITULAR_ARRIBA')
  assert.equal(formatoRealizable('TRES_EN_UNO', { ...nada, imagen: 'x', nImagenes: 2 }), 'COLLAGE')
  assert.equal(formatoRealizable('CUENTA_ATRAS', nada), 'TEXTO_ENCIMA')
  assert.equal(formatoRealizable('ANTES_AHORA', { ...nada, precio: true }), 'PRECIO_GRANDE')
  assert.equal(formatoRealizable('ANTES_AHORA', nada), 'TITULAR_ARRIBA', 'sin precio tampoco cabe «Precio grande»')
  assert.equal(formatoRealizable('PRECIO_GRANDE', { ...nada, precio: true }), 'PRECIO_GRANDE')
  assert.equal(formatoRealizable('DESCUENTO_SELLO', nada), 'TITULAR_ARRIBA')
})

test('el color de fondo: el de la foto, si no el de marca, si no el del rubro', () => {
  assert.equal(colorDeFondo({ dominante: '#112233', marca: '#445566', rubro: 'CAR_WASH' }), '#112233')
  assert.equal(colorDeFondo({ dominante: null, marca: '#445566', rubro: 'CAR_WASH' }), '#445566')
  assert.equal(colorDeFondo({ dominante: 'rojo', marca: 'azul', rubro: 'BARBERIA' }), 'hsl(20 10% 10%)', 'un valor que no es #rrggbb no se usa')
  assert.equal(colorDeFondo({}), 'hsl(201 90% 24%)')
})

test('el texto se lee: claro sobre fondos oscuros y oscuro sobre claros, también con los colores del rubro en hsl', () => {
  assert.equal(textoSobre('#0c4a6e'), 'claro')
  assert.equal(textoSobre('#fef3c7'), 'oscuro')
  assert.equal(textoSobre('#ffffff'), 'oscuro')
  assert.equal(textoSobre('#000000'), 'claro')
  for (const rubro of ['hsl(201 90% 24%)', 'hsl(20 10% 10%)', 'hsl(17 80% 34%)', 'hsl(143 61% 20%)', 'hsl(175 60% 19%)']) {
    assert.equal(textoSobre(rubro), 'claro', `${rubro} es oscuro: lleva texto claro`)
  }
  assert.equal(textoSobre('no-es-color'), 'claro')
  assert.deepEqual(aRgb('#0a141e'), [10, 20, 30])
  assert.equal(aRgb('hsl(0 0% 100%)')?.join(), '255,255,255')
  assert.equal(rgbAHex(255, 0, 300), '#ff00ff')
})

test('el color dominante se acerca a un tono con cuerpo si la foto es casi blanca o casi negra', () => {
  const [r1] = ajustarParaFondo(250, 250, 250)
  assert.ok(r1 < 250, 'un blanco se oscurece un poco')
  const [r2] = ajustarParaFondo(5, 5, 5)
  assert.ok(r2 > 5, 'un negro se aclara un poco')
  assert.deepEqual(ajustarParaFondo(100, 120, 140), [100, 120, 140])
})

test('el héroe de una pieza lleva su imagen, su color y el verbo de su rubro', () => {
  const p = pieza({ id: 'h', empresa: { nombre: 'Barbería X', slug: 'bx', colorMarca: '#112233', rubro: 'BARBERIA' } })
  const h = heroDePieza(p, 'PRECIO_GRANDE', { ...SIN_AJUSTE, colorDominante: '#445566' })
  assert.equal(h.cta, 'Agenda')
  assert.equal(h.imagen, 'https://x/img.jpg')
  assert.equal(h.colorFondo, '#445566', 'el de la foto manda sobre el de marca')
  assert.equal(h.formato, 'PRECIO_GRANDE')
  assert.deepEqual(h.origen, { tipo: 'CATALOGO', id: 'h' })
  assert.equal(heroDePieza(p, 'PRECIO_GRANDE', SIN_AJUSTE).colorFondo, '#112233')
})

// ── Por el código: autorización y conexión ───────────────────────────────────

const fuente = (ruta: string) =>
  readFileSync(join(__dirname, '..', ruta), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('las acciones de banners autorizan con la sección de cada origen y comprueban que la pieza es pública y de la empresa', () => {
  const src = fuente('src/modules/home/banners-acciones.ts')
  assert.match(src, /PROMOCION: 'promociones'/)
  assert.match(src, /CATALOGO: 'catalogo'/)
  assert.match(src, /OFERTA: 'deals'/)
  assert.match(src, /PLAN: 'planes'/)
  assert.match(src, /requireSection\(SECCION_POR_ORIGEN\[tipo\]\)/)
  assert.match(src, /p\.clave === clave && p\.companyId === companyId/, 'la pieza tiene que ser de ESA empresa')
  // Ninguna acción escribe antes de autorizar.
  for (const nombre of ['destacarPieza', 'ajustarPieza', 'moverFijada']) {
    const i = src.indexOf(`export async function ${nombre}`)
    const cuerpo = src.slice(i, src.indexOf('\nexport ', i + 10) > 0 ? src.indexOf('\nexport ', i + 10) : undefined)
    assert.ok(cuerpo.indexOf('await contexto(origen)') >= 0 && cuerpo.indexOf('await contexto(origen)') < cuerpo.indexOf('sinEmpresa('), `${nombre}: autoriza antes de escribir`)
  }
  assert.match(src, /revalidateTag\(MARKETPLACE_TAG, 'max'\)/, 'lo que se ajusta invalida la caché del inicio')
})

test('el color dominante solo se baja de nuestro propio almacenamiento', () => {
  const src = fuente('src/modules/home/color-dominante.ts')
  assert.match(src, /if \(!url\.startsWith\(prefijoPermitido\)\) return null/)
  const auto = fuente('src/modules/home/novedades-auto.ts')
  assert.match(auto, /storage\/v1\/object\/public\//)
  assert.match(auto, /MAX_COLORES_POR_PASADA/)
})

test('el inicio usa la cola automática y conserva el respaldo; los banners a medida van primero', () => {
  const src = fuente('src/modules/home/lectura.ts')
  assert.match(src, /getHeroesAutomaticos\(espacio\)/)
  assert.match(src, /heroesAuto\.length > 0 \? \[\] : await heroesPorDefecto/)
  assert.match(src, /combinarHeroes\(heroesPublicados, \[\.\.\.heroesAuto, \.\.\.heroesPromos\], MAX_CARRUSEL\)/)
})

test('al publicar algo se pregunta si se destaca: promoción, producto o servicio y oferta', () => {
  assert.match(fuente('src/components/admin/PromocionForm.tsx'), /<DestacarEnInicio\s+origen="PROMOCION"/)
  assert.match(fuente('src/components/catalogo/EstadoItemBotones.tsx'), /a === 'ACTIVE'\) setDestacar\(true\)/)
  assert.match(fuente('src/components/deals/OfertaAcciones.tsx'), /<DestacarEnInicio origen="OFERTA"/)
  assert.match(fuente('src/modules/admin/promocionActions.ts'), /return \{ success: true, promocionId: legacy\.id \}/)
})

test('la pestaña Carrusel existe en el Editor de inicio', () => {
  assert.match(fuente('src/components/layout/nav-config.ts'), /href: '\/admin\/personalizacion\/carrusel', label: 'Carrusel'/)
})

// ── Banners a medida: quitar uno desde la lista ──────────────────────────────

const slide = (titulo: string, id = 'p1') => ({ titulo, imagenUrl: null, ctaTexto: 'Ver', ctaDestino: { tipo: 'promocion', id } })

test('quitar un banner a medida: quita solo el que la huella señala', () => {
  const slides = [slide('A', 'p1'), slide('B', 'p2'), slide('C', 'p3')]
  const r = quitarSlide(slides, 1, huellaDeSlide(slides[1]!))
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.quedan.map((s) => s.titulo), ['A', 'C'])
})

test('quitar un banner a medida: si la posición ya apunta a otro, no quita nada', () => {
  const slides = [slide('A', 'p1'), slide('B', 'p2')]
  const r = quitarSlide(slides, 0, huellaDeSlide(slides[1]!))
  assert.equal(r.ok, false)
  assert.equal(quitarSlide(slides, 7, 'x').ok, false)
})

test('quitar un banner a medida: nunca deja el hero vacío', () => {
  const slides = [slide('A')]
  const r = quitarSlide(slides, 0, huellaDeSlide(slides[0]!))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /al menos un banner/)
})

test('la huella distingue destino, titular, botón e imagen', () => {
  const base = slide('A')
  const huellas = new Set([
    huellaDeSlide(base),
    huellaDeSlide({ ...base, titulo: 'B' }),
    huellaDeSlide({ ...base, ctaTexto: 'Otro' }),
    huellaDeSlide({ ...base, imagenUrl: 'https://x/y.png' }),
    huellaDeSlide({ ...base, ctaDestino: { tipo: 'plan', id: 'p1' } }),
  ])
  assert.equal(huellas.size, 5)
})

test('cada pieza automática se edita donde se creó', () => {
  assert.equal(rutaDeEdicionDePieza('PROMOCION', 'a1'), '/admin/promociones/a1/editar')
  assert.equal(rutaDeEdicionDePieza('CATALOGO', 'a1'), '/admin/catalogo/a1')
  assert.equal(rutaDeEdicionDePieza('OFERTA', 'a1'), '/admin/ofertas/a1')
  assert.equal(rutaDeEdicionDePieza('PLAN', 'a1'), '/admin/planes/a1/editar')
})
