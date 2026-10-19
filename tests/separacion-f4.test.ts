import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { rutaDeCampana, rutaDeCampanas, rutaDeMembresias, rutaDeOfertaLegada, rutaDeOfertaMembego, rutaDePromociones } from '../src/modules/comercio/rutas'
import { RUTA_CAMPANAS_CLIENTE, RUTA_CAMPANAS_PUBLICAS, RUTA_MEMBRESIAS_CLIENTE, RUTA_MEMBRESIAS_PUBLICAS, RUTA_OFERTAS_CLIENTE, RUTA_OFERTAS_PUBLICAS } from '../src/modules/supply-v2/core/catalogo'
import { destinoInterno, destinoParaRol } from '../src/lib/auth/destino-seguro'
import { ROLE_HOME } from '../src/types'

/**
 * SEPARACIÓN LANDING · APP — F4: ofertas Membego, membresías, campañas y regalos de empresa viven en la app.
 *
 * Las reglas de compra (beneficios, cupones, importes, idempotencia) no se tocaron y las prueban las suites de Supply.
 * Aquí se fija lo que F4 SÍ cambió: dónde vive cada pieza, que cada ruta pública tiene su par de la app, que la landing
 * ya no lee la sesión ni monta operaciones, y que los enlaces del cliente se quedan en su espacio.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('cada ruta pública de Supply tiene su par de la app, y las constantes de Supply coinciden con el mapa único', () => {
  assert.equal(RUTA_OFERTAS_PUBLICAS, '/promociones/membego')
  assert.equal(rutaDeOfertaMembego('publico', 'x'), `${RUTA_OFERTAS_PUBLICAS}/x`)
  assert.equal(rutaDeOfertaMembego('app', 'x'), `${RUTA_OFERTAS_CLIENTE}/x`)
  assert.equal(RUTA_OFERTAS_CLIENTE, '/cliente/ofertas-membego')
  assert.equal(rutaDeCampanas('publico'), RUTA_CAMPANAS_PUBLICAS)
  assert.equal(rutaDeCampanas('app'), RUTA_CAMPANAS_CLIENTE)
  assert.equal(rutaDeCampana('publico', 'VERANO'), `${RUTA_CAMPANAS_PUBLICAS}/VERANO`)
  assert.equal(rutaDeCampana('app', 'VERANO'), `${RUTA_CAMPANAS_CLIENTE}/VERANO`)
  assert.equal(rutaDeMembresias('publico'), RUTA_MEMBRESIAS_PUBLICAS)
  assert.equal(rutaDeMembresias('app'), RUTA_MEMBRESIAS_CLIENTE)
  assert.equal(rutaDePromociones('publico'), '/promociones')
  assert.equal(rutaDePromociones('app'), '/cliente/promociones')
  assert.equal(rutaDeOfertaLegada('publico', 'ABC'), '/oferta/ABC')
  assert.equal(rutaDeOfertaLegada('app', 'ABC'), '/cliente/oferta/ABC')
})

test('los pares de la app existen como páginas y no chocan con segmentos dinámicos de /cliente', () => {
  for (const ruta of ['ofertas-membego/[slug]', 'membresias-membego', 'campanas', 'campanas/[code]', 'oferta/[codigo]']) {
    assert.ok(existsSync(`src/app/(cliente)/cliente/${ruta}/page.tsx`), ruta)
  }
  // `/cliente/promociones/[id]` y `/cliente/mis-promociones/[id]` siguen siendo de las promociones de empresa.
  assert.ok(existsSync('src/app/(cliente)/cliente/promociones/[id]/page.tsx'))
})

test('los destinos nuevos son destinos de retorno válidos para un cliente y no para el equipo', () => {
  const destinos = [
    rutaDeOfertaMembego('app', 'oferta-x'),
    `${rutaDeOfertaMembego('app', 'oferta-x')}?beneficio=b1&cupon=VERANO`,
    rutaDeMembresias('app'),
    rutaDeCampanas('app'),
    rutaDeCampana('app', 'VERANO'),
    rutaDeOfertaLegada('app', 'ABC123'),
  ]
  for (const ruta of destinos) {
    assert.equal(destinoInterno(ruta), ruta, ruta)
    assert.equal(destinoParaRol(ruta, 'CLIENTE', ROLE_HOME.CLIENTE), ruta, ruta)
    for (const rol of ['ADMINISTRADOR', 'EMPLEADO', 'VENDEDOR', 'SUPERADMIN'] as const) assert.equal(destinoParaRol(ruta, rol, ROLE_HOME[rol]), ROLE_HOME[rol], `${rol}: ${ruta}`)
  }
})

test('la landing de consulta no opera, no lee la sesión y ofrece el traspaso', () => {
  const paginas = [
    'src/app/(public)/promociones/membego/[slug]/page.tsx',
    'src/app/(public)/promociones/membresias/page.tsx',
    'src/app/(public)/promociones/campanas/page.tsx',
    'src/app/(public)/promociones/campanas/[code]/page.tsx',
    'src/app/(public)/oferta/[codigo]/page.tsx',
  ]
  for (const f of paginas) {
    const c = sinComentarios(f)
    assert.doesNotMatch(c, /getUser|@\/lib\/auth\b|BotonComprar|BotonContratarMembresia|ReclamarOferta|beneficiosParaOferta|promocionesParaOferta|getOfertaParaCliente/, f)
    assert.match(c, /TraspasoALaApp|EnlaceDeTraspaso|espacio="publico"/, f)
  }
  assert.match(sinComentarios(paginas[0]), /<TraspasoALaApp[\s\S]*destino=\{destino\}/)
  assert.match(sinComentarios(paginas[0]), /rutaDeOfertaMembego\('app', o\.slug\)/)
  assert.match(sinComentarios(paginas[1]), /EnlaceDeTraspaso destino=\{rutaDeMembresias\('app'\)\}/)
  assert.match(sinComentarios(paginas[4]), /rutaDeOfertaLegada\('app', codigo\)/)
})

test('el regalo compartido no filtra su contenido a la landing: solo el traspaso; el contenido es de la app', () => {
  const publica = sinComentarios('src/app/(public)/oferta/[codigo]/page.tsx')
  assert.doesNotMatch(publica, /oferta\.titulo|oferta\.descripcion|company\.name|queries/, 'la landing no lee ni pinta el regalo')
  assert.match(leer('src/app/(public)/oferta/[codigo]/page.tsx'), /OG genérica/)
  const app = sinComentarios('src/app/(cliente)/cliente/oferta/[codigo]/page.tsx')
  assert.match(app, /requireRole\('CLIENTE'\)/)
  assert.match(app, /<ReclamarOferta codigo=\{codigo\} \/>/)
  assert.match(app, /robots: \{ index: false, follow: false \}/, 'el contenido es de la cuenta: no se indexa')
  // Reclamar refresca ambas pantallas.
  assert.match(sinComentarios('src/modules/ofertas/actions.ts'), /revalidatePath\(`\/cliente\/oferta\/\$\{codigo\}`\)/)
})

test('las operaciones solo se montan en la app: compra, contratación y reclamo', () => {
  assert.match(sinComentarios('src/app/(cliente)/cliente/ofertas-membego/[slug]/page.tsx'), /<BotonComprar[\s\S]*sesion="cliente"/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/ofertas-membego/[slug]/page.tsx'), /requireRole\('CLIENTE'\)/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/membresias-membego/page.tsx'), /<BotonContratarMembresia/)
  // La presentación compartida no importa ninguna operación.
  for (const f of ['FichaDeOfertaMembego', 'ListaDeMembresias', 'ListaDeCampanas', 'FichaDeCampana']) {
    assert.doesNotMatch(sinComentarios(`src/components/supply-v2/${f}.tsx`), /boton-comprar|boton-contratar|actions|getUser/, f)
  }
  // Un beneficio o cupón que llega por el enlace público viaja hasta la ficha de la app.
  assert.match(sinComentarios('src/app/(cliente)/cliente/ofertas-membego/[slug]/page.tsx'), /beneficioPreseleccionado=\{q\.beneficio\}/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/ofertas-membego/[slug]/page.tsx'), /cuponPreseleccionado=\{q\.cupon\}/)
  assert.match(sinComentarios('src/app/(public)/promociones/membego/[slug]/page.tsx'), /consulta\.set\('beneficio'/)
  assert.match(sinComentarios('src/app/(public)/promociones/membego/[slug]/page.tsx'), /consulta\.set\('cupon'/)
})

test('la app del cliente no apunta a las rutas públicas de Supply: usa las de la app', () => {
  const archivos: string[] = []
  const recorrer = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (/\.tsx?$/.test(p)) archivos.push(p)
    }
  }
  recorrer('src/app/(cliente)')
  recorrer('src/components/cliente')
  archivos.push('src/components/supply-v2/checkout-cliente.tsx', 'src/components/supply-v2/boton-comprar.tsx', 'src/components/supply-v2/boton-contratar-membresia.tsx')
  for (const f of archivos) {
    const c = sinComentarios(f)
    assert.doesNotMatch(c, /RUTA_(OFERTAS|CAMPANAS|MEMBRESIAS)_PUBLICAS/, f)
    assert.doesNotMatch(c, /['"`]\/promociones(\/|['"`?])/, f)
  }
  // Y los destinos concretos que cambiaron.
  assert.match(sinComentarios('src/app/(cliente)/cliente/bonos/page.tsx'), /RUTA_OFERTAS_CLIENTE/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/cupones/page.tsx'), /RUTA_OFERTAS_CLIENTE\}\/\$\{o\.slug\}\?cupon=/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/cupones/page.tsx'), /RUTA_CAMPANAS_CLIENTE/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/fidelizacion/page.tsx'), /RUTA_MEMBRESIAS_CLIENTE/)
  assert.match(sinComentarios('src/components/supply-v2/checkout-cliente.tsx'), /RUTA_OFERTAS_CLIENTE\}\/\$\{compra/)
})

test('las tarjetas de oferta Membego (Supply) enlazan a la ficha de SU espacio', () => {
  assert.match(sinComentarios('src/components/catalogo/TarjetaCatalogoPublica.tsx'), /rutaDeOfertaMembego\(espacio, item\.ofertaSlug!\)/)
  assert.doesNotMatch(sinComentarios('src/components/catalogo/TarjetaCatalogoPublica.tsx'), /RUTA_OFERTAS_MEMBEGO/)
  assert.match(sinComentarios('src/components/supply-v2/ListaDeCampanas.tsx'), /rutaDeOfertaMembego\(espacio, o\.slug\)/)
  assert.match(sinComentarios('src/components/supply-v2/FichaDeCampana.tsx'), /rutaDeOfertaMembego\(espacio, o\.slug\)/)
  // «Mis cupones» es del cliente: solo la app lo enseña.
  assert.match(sinComentarios('src/components/supply-v2/ListaDeCampanas.tsx'), /espacio === 'app' && /)
  assert.match(sinComentarios('src/components/supply-v2/FichaDeCampana.tsx'), /espacio === 'app' && /)
  // La campaña pública no conoce al cliente (no hay sesión); la de la app sí.
  assert.match(sinComentarios('src/app/(public)/promociones/campanas/page.tsx'), /campanasPublicas\(null\)/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/campanas/page.tsx'), /campanasPublicas\(user\.metadata\.dbUserId/)
})

test('las acciones de Supply refrescan también las pantallas de la app', () => {
  assert.match(sinComentarios('src/modules/supply-v2/actions-cliente.ts'), /revalidatePath\(RUTA_OFERTAS_CLIENTE, 'layout'\)/)
  assert.match(sinComentarios('src/modules/supply-v2/actions-ofertas.ts'), /revalidatePath\(RUTA_OFERTAS_CLIENTE, 'layout'\)/)
  assert.match(sinComentarios('src/modules/supply-v2/actions-campanas.ts'), /revalidatePath\(RUTA_CAMPANAS_CLIENTE, 'layout'\)/)
  assert.match(sinComentarios('src/modules/supply-v2/actions-fidelizacion.ts'), /revalidatePath\(RUTA_MEMBRESIAS_CLIENTE\)/)
})

test('los avisos de membresía llevan a una pantalla que existe', () => {
  const efectos = sinComentarios('src/modules/supply-v2/notifications/efectos.ts')
  assert.doesNotMatch(efectos, /'\/cliente\/membresias'/, '/cliente/membresias no es una página')
  assert.ok(existsSync('src/app/(cliente)/cliente/fidelizacion/page.tsx'))
})
