import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { RUTA_CARRITO_EXCURSIONES, rutaDeBuscarExcursiones, rutaDeExcursion, rutaDeExcursiones } from '../src/modules/comercio/rutas'
import { destinoInterno, destinoParaRol } from '../src/lib/auth/destino-seguro'
import { ROLE_HOME } from '../src/types'

/**
 * SEPARACIÓN LANDING · APP — F3: las excursiones se reservan en la app.
 *
 * Las reglas de reserva (precio, cupo, atribución del vendedor) no se tocaron y las prueban sus propias suites. Aquí se
 * fija lo que F3 SÍ cambió: dónde vive cada pieza, a dónde llevan los enlaces compartidos de los vendedores, y que el
 * carrito es uno solo.
 */

const leer = (f: string) => readFileSync(f, 'utf8')
const sinComentarios = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('las excursiones tienen su ruta por espacio, y el carrito de excursiones solo existe en la app', () => {
  assert.equal(rutaDeExcursiones('publico', 'tours'), '/empresas/tours/excursiones')
  assert.equal(rutaDeExcursiones('app', 'tours'), '/cliente/empresas/tours/excursiones')
  assert.equal(rutaDeExcursion('publico', 'tours', 'buceo'), '/empresas/tours/excursiones/buceo')
  assert.equal(rutaDeExcursion('app', 'tours', 'buceo'), '/cliente/empresas/tours/excursiones/buceo')
  assert.equal(rutaDeBuscarExcursiones('publico'), '/excursiones')
  assert.equal(rutaDeBuscarExcursiones('app'), '/cliente/excursiones')
  assert.equal(RUTA_CARRITO_EXCURSIONES, '/cliente/carrito/excursiones')
})

test('los destinos nuevos son destinos de retorno válidos para un cliente y no para el equipo', () => {
  for (const ruta of [rutaDeExcursiones('app', 'tours') + '?e=luis-tours', rutaDeExcursion('app', 'tours', 'buceo'), RUTA_CARRITO_EXCURSIONES]) {
    assert.equal(destinoInterno(ruta), ruta, ruta)
    assert.equal(destinoParaRol(ruta, 'CLIENTE', ROLE_HOME.CLIENTE), ruta, ruta)
    for (const rol of ['ADMINISTRADOR', 'EMPLEADO', 'VENDEDOR', 'SUPERADMIN'] as const) assert.equal(destinoParaRol(ruta, rol, ROLE_HOME[rol]), ROLE_HOME[rol], `${rol}: ${ruta}`)
  }
})

test('el enlace corto del vendedor, el registro y la afiliación terminan en la lista de la empresa DENTRO de la app', () => {
  const corto = sinComentarios('src/app/e/[slug]/route.ts')
  assert.match(corto, /rutaDeExcursiones\('app', enlace\.companySlug\)/)
  assert.doesNotMatch(corto, /`\/empresas\//, 'el destino ya no es la lista pública')
  // La atribución sigue sembrándose en cookies, no en la URL.
  assert.match(corto, /VENDEDOR_COOKIE/)
  assert.match(corto, /registrarVisita\(/)
  for (const f of ['src/components/auth/RegisterForm.tsx', 'src/components/auth/AsistenteRegistro.tsx']) {
    assert.match(sinComentarios(f), /rutaDeExcursiones\('app', companySlug\)/, f)
    assert.doesNotMatch(sinComentarios(f), /`\/empresas\/\$\{companySlug\}\/excursiones/, f)
  }
  const afiliacion = sinComentarios('src/modules/cliente/actions.ts')
  assert.match(afiliacion, /rutaDeExcursiones\('app', companySlug\)/)
  assert.doesNotMatch(afiliacion, /`\/empresas\/\$\{companySlug\}\/excursiones/)
})

test('el inicio de la app lleva a las fichas de la app, y la API móvil conserva su valor por defecto', () => {
  const lectura = sinComentarios('src/modules/home/lectura.ts')
  assert.match(lectura, /espacio: Espacio = 'publico'/, 'por defecto, el público: la API móvil no cambia de contrato')
  assert.match(lectura, /rutaDeExcursion\(espacio, e\.company\.slug, e\.slug\)/)
  assert.match(sinComentarios('src/modules/home/hero-publico.ts'), /rutaDeExcursion\(espacio, empresa\.slug, excursion\.slug\)/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/inicio/page.tsx'), /getInicioVista\(user, categoria, 'app'\)/)
  assert.doesNotMatch(sinComentarios('src/app/api/v1/cliente/inicio/route.ts'), /'app'/, 'la API de la app móvil no pasa el espacio de la web')
})

test('cada tarjeta de excursión declara el espacio que le corresponde a donde se pinta', () => {
  const archivos: string[] = []
  const recorrer = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) recorrer(p)
      else if (p.endsWith('.tsx')) archivos.push(relative('.', p))
    }
  }
  recorrer('src/app')
  recorrer('src/components')
  let usos = 0
  for (const f of archivos) {
    for (const m of leer(f).matchAll(/<ExcursionCard\b[^>]*?(?:\/>|>)/g)) {
      usos++
      const espacio = m[0].match(/espacio=(?:"(\w+)"|\{([^}]+)\})/)
      assert.ok(espacio, `${f}: <ExcursionCard> sin espacio`)
      const valor = espacio[1] ?? espacio[2]
      if (f.startsWith('src/app/(cliente)') || f.startsWith('src/components/cliente/')) assert.equal(valor, 'app', f)
      else if (f.startsWith('src/app/(public)')) assert.equal(valor, 'publico', f)
    }
  }
  assert.ok(usos >= 2)
  // Las tarjetas de la lista de empresa heredan el espacio de la lista, que lo recibe de su página.
  assert.match(leer('src/components/excursiones/ListaDeExcursionesDeEmpresa.tsx'), /espacio=\{espacio\}/)
  assert.match(sinComentarios('src/app/(public)/empresas/[companySlug]/excursiones/page.tsx'), /espacio="publico"/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/empresas/[companySlug]/excursiones/page.tsx'), /espacio="app"/)
})

test('un solo carrito visible: el cajón desapareció, el proveedor envuelve la carcasa y el contador suma ambos', () => {
  assert.equal(existsSync('src/components/excursiones/ExcursionCarritoDrawer.tsx'), false, 'el cajón lateral ya no existe')
  const contexto = sinComentarios('src/components/excursiones/ExcursionCarritoContext.tsx')
  assert.doesNotMatch(contexto, /isOpen|openCart|closeCart/, 'agregar una excursión ya no abre un cajón')
  const carcasa = sinComentarios('src/components/layout/CustomerShell.tsx')
  assert.match(carcasa, /<ExcursionCarritoWrapper>[\s\S]*<IconoCarrito \/>[\s\S]*<\/ExcursionCarritoWrapper>/, 'el proveedor envuelve el encabezado, donde está el icono')
  const icono = sinComentarios('src/components/checkout/IconoCarrito.tsx')
  assert.match(icono, /unidades \+ items\.length/)
  const pagina = sinComentarios('src/app/(cliente)/cliente/carrito/page.tsx')
  assert.match(pagina, /<CarritoDeLaApp \/>/)
  const unico = sinComentarios('src/components/checkout/CarritoDeLaApp.tsx')
  assert.match(unico, /<CarritoVista \/>/)
  assert.match(unico, /<ExcursionesEnElCarrito \/>/)
  assert.match(unico, /Tu carrito está vacío/, 'un solo estado vacío para los dos tipos')
})

test('agregar una excursión avisa con un enlace al carrito y «Reservar ahora» va a la reserva de la app', () => {
  const form = sinComentarios('src/components/excursiones/ReservaExcursionForm.tsx')
  assert.match(form, /toast\.success\('Excursión agregada al carrito\.'/)
  assert.match(form, /onClick: \(\) => router\.push\(RUTA_CARRITO\)/)
  assert.match(form, /router\.push\(isAuthenticated \? RUTA_CARRITO_EXCURSIONES/)
  assert.doesNotMatch(form, /'\/checkout'/, 'ya no se manda a la ruta vieja')
  const checkout = sinComentarios('src/components/excursiones/CheckoutExcursiones.tsx')
  assert.doesNotMatch(checkout, /'\/checkout'|"\/checkout"/)
  assert.match(checkout, /rutaDeLogin\(RUTA_CARRITO_EXCURSIONES\)/)
})

test('la landing no tiene reserva ni checkout de excursiones: solo consulta y traspaso', () => {
  assert.equal(existsSync('src/app/(public)/checkout'), false, '/checkout ya no es una página de la landing')
  assert.equal(existsSync('src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/ReservaExcursionForm.tsx'), false)
  const ficha = sinComentarios('src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx')
  assert.match(ficha, /<TraspasoALaApp/)
  assert.doesNotMatch(ficha, /getUser|ReservaExcursionForm|useExcursionCart/)
  assert.doesNotMatch(sinComentarios('src/app/(public)/layout.tsx'), /Carrito|Wrapper/)
  const nextConfig = leer('next.config.ts')
  assert.match(nextConfig, /source: '\/checkout',\s*destination: '\/cliente\/carrito\/excursiones'/)
})

test('seguir empresa es una acción de la app: el perfil compartido no la importa y la landing solo traspasa', () => {
  const perfil = sinComentarios('src/components/marketplace/CompanyProfile.tsx')
  assert.doesNotMatch(perfil, /FollowButton|modules\/social/)
  assert.match(perfil, /\{ranuraSeguir\}/)
  assert.match(sinComentarios('src/app/(public)/empresas/[companySlug]/page.tsx'), /ranuraSeguir=\{<EnlaceDeTraspaso destino=\{rutaDeEmpresa\('app', company\.slug\)\}/)
  assert.match(sinComentarios('src/app/(cliente)/cliente/empresas/[companySlug]/page.tsx'), /ranuraSeguir=\{<FollowButton/)
})

test('la ficha de excursión y la de la app salen del mismo cargador, y el formulario de reserva solo lo monta la app', () => {
  assert.match(sinComentarios('src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx'), /cargarFichaDeExcursion\(/)
  const enLaApp = sinComentarios('src/app/(cliente)/cliente/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx')
  assert.match(enLaApp, /cargarFichaDeExcursion\(/)
  assert.match(enLaApp, /<ReservaExcursionForm/)
  assert.doesNotMatch(sinComentarios('src/components/excursiones/FichaDeExcursion.tsx'), /ReservaExcursionForm|useExcursionCart|cliente-actions/, 'la presentación no opera')
})
