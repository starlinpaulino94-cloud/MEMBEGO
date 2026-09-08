/**
 * Contrato retail del cliente (F1 · Stitch S01–S04).
 *
 * 4 destinos fijos (Inicio · Cuenta · Mi QR · Menú), carcasa propia del
 * cliente, Inter y azules comerciales en ámbito .retail. AppShell quedó para
 * el personal, sin dock inferior.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DESTINOS_CLIENTE,
  esDestinoActivo,
} from '../src/components/layout/destinos-cliente'

const RAIZ = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(RAIZ, r), 'utf8')

test('la navegación del cliente son exactamente 4 destinos, en su orden', () => {
  assert.deepEqual(
    DESTINOS_CLIENTE.map((d) => d.href),
    ['/cliente/inicio', '/cliente/perfil', '/cliente/qr', '/cliente/menu']
  )
  assert.deepEqual(
    DESTINOS_CLIENTE.map((d) => d.label),
    ['Inicio', 'Cuenta', 'Mi QR', 'Menú']
  )
})

test('una ruta que cuelga de un destino lo marca activo; una parecida no', () => {
  const cuenta = DESTINOS_CLIENTE[1]
  const qr = DESTINOS_CLIENTE[2]
  assert.ok(cuenta && qr)
  assert.equal(esDestinoActivo('/cliente/perfil', cuenta), true)
  assert.equal(esDestinoActivo('/cliente/pagos/abc', cuenta), true, 'Pagos vive bajo Cuenta.')
  assert.equal(esDestinoActivo('/mis-membresias', qr), true, 'La wallet vive bajo Mi QR.')
  // `/cliente/perfilado` NO es `/cliente/perfil`: el prefijo se compara por
  // segmento, no por texto, o media app se marcaría activa a la vez.
  assert.equal(esDestinoActivo('/cliente/perfilado', cuenta), false)
  assert.equal(esDestinoActivo('/cliente/inicio', cuenta), false)
})

test('dock y pestañas leen la misma lista, y el dock no vuelve a ser variable', () => {
  const dock = leer('src/components/layout/BottomNav.tsx')
  const tabs = leer('src/components/layout/TabsEscritorio.tsx')
  assert.match(dock, /DESTINOS_CLIENTE/)
  assert.match(tabs, /DESTINOS_CLIENTE/)
  assert.doesNotMatch(dock, /FLEX_CANDIDATOS|qrHref|hiddenNav/)
  assert.match(dock, /--dock-inferior/)
})

test('las pestañas de escritorio dicen en cuál estás', () => {
  const tabs = leer('src/components/layout/TabsEscritorio.tsx')
  assert.match(
    tabs,
    /aria-current=\{activo \? 'page' : undefined\}/,
    'Sin `aria-current` las cuatro pestañas se ven y se anuncian iguales.'
  )
})

test('existen las rutas /cliente/menu y /cliente/qr', () => {
  assert.ok(existsSync(join(RAIZ, 'src/app/(cliente)/cliente/menu/page.tsx')))
  assert.ok(existsSync(join(RAIZ, 'src/app/(cliente)/cliente/qr/page.tsx')))
})

test('el layout del cliente usa CustomerShell + Inter + retail, no AppShell', () => {
  const src = leer('src/app/(cliente)/layout.tsx')
  assert.match(src, /CustomerShell/)
  assert.match(src, /Inter\(/)
  assert.match(src, /retail/)
  assert.doesNotMatch(src, /AppShell/)
})

test('CustomerShell: header, ubicación, pestañas y dock', () => {
  const src = leer('src/components/layout/CustomerShell.tsx')
  assert.match(src, /action="\/cliente\/buscar"/)
  assert.match(src, /href="\/cliente\/qr"/)
  assert.match(src, /href="\/cliente\/cerca"/)
  assert.match(src, /href="\/cliente\/perfil"/)
  assert.match(src, /<BottomNav \/>/)
  assert.match(src, /<TabsEscritorio \/>/)
  assert.match(src, /con-dock-inferior/)
  // El aviso de empresa de práctica se pintaba dos veces: arriba del contenido
  // y otra vez bajo el dock. Uno solo, y por encima de lo que avisa.
  assert.equal(
    src.match(/<BannerDemo /g)?.length,
    1,
    'El banner de demo se pinta una sola vez.'
  )
})

test('AppShell ya no pinta dock inferior', () => {
  const src = leer('src/components/layout/AppShell.tsx')
  assert.doesNotMatch(src, /BottomNav|qrHref|BOTTOM_NAV_ROLES|hasBottomNav/)
})

test('el ámbito retail existe con tokens de una sola fuente', () => {
  const css = leer('src/app/globals.css')
  assert.match(css, /\.retail \{/)
  assert.match(css, /\.retail-header/)
  assert.match(css, /--color-retail-blue: #0284c7/)
})

// ── D10 · un solo Inicio ─────────────────────────────────────────────────────
//
// Había dos: el retail solo aparecía si la empresa había publicado
// composición, y el resto del tiempo se veía la pantalla anterior íntegra.
// Estas guardias vigilan que no vuelvan a ser dos, y que las seis capacidades
// que solo vivían en la vieja sigan teniendo casa.

test('la pantalla anterior del Inicio ya no existe, ni nadie la nombra', () => {
  assert.equal(
    existsSync(join(RAIZ, 'src/components/cliente/inicio/InicioPrevio.tsx')),
    false,
    'InicioPrevio era el Inicio anterior completo; D10 lo retira.'
  )
  const page = leer('src/app/(cliente)/cliente/inicio/page.tsx')
  assert.match(page, /InicioRetail/)
  assert.doesNotMatch(
    page,
    /InicioPrevio/,
    'El Inicio no puede volver a tener una pantalla de respaldo con el diseño viejo.'
  )
})

test('sin composición publicada, el Inicio sigue siendo retail', () => {
  const src = leer('src/components/cliente/inicio/InicioRetail.tsx')
  // `comercial` puede ser null y aun así se pinta la franja personal y, en su
  // sitio, las ofertas personalizadas. Nada cae a otra pantalla.
  assert.match(src, /comercial: InicioVista \| null/)
  assert.match(src, /RetailOfertas/, 'Sin composición, su sitio lo ocupan las ofertas.')
  assert.match(src, /RetailWallet/, 'La wallet no depende de que la empresa publique.')
})

test('las seis capacidades del Inicio anterior siguen teniendo dónde vivir', () => {
  const src = leer('src/components/cliente/inicio/InicioRetail.tsx')
  for (const [capacidad, marca] of [
    ['wallet', /RetailWallet/],
    ['motor de experiencias', /RetailExperiencia/],
    ['prueba social', /PruebaSocial/],
    ['onboarding', /OnboardingClienteFirstVisit/],
    ['novedades e invitación', /RetailDescubreMas/],
  ] as const) {
    assert.match(src, marca, `Se perdió la capacidad: ${capacidad}.`)
  }
  // La gamificación no tiene sección propia: viaja en la cabecera de la wallet.
  assert.match(leer('src/components/cliente/inicio/RetailWallet.tsx'), /gamificacion/)
})

test('el Inicio no repite el buscador ni el saludo que ya da la carcasa', () => {
  const src = leer('src/components/cliente/inicio/InicioRetail.tsx')
  assert.doesNotMatch(src, /Buscador/, 'El buscador vive en CustomerShell; repetirlo es navegación duplicada.')
  assert.doesNotMatch(src, /Cerca de m/, 'La barra de ubicación ya está en la carcasa.')
  assert.equal(
    existsSync(join(RAIZ, 'src/components/cliente/inicio/BuscadorSimple.tsx')),
    false,
    'El buscador del Inicio anterior duplicaba el de la cabecera.'
  )
})

// ── Utilidades que no existen ────────────────────────────────────────────────
//
// `--primary-soft` y `--primary-hover` son variables CSS, pero el tema las
// registra como colores con el prefijo `brand-`. Escribir `bg-primary-soft`
// compila, no avisa y NO PINTA NADA: el icono de Mi QR salió sin su fondo y la
// franja de ofertas relámpago sin el suyo, y solo se vio en una captura.
//
// Esta guardia mira el alias, no el estilo: si alguien añade un alias nuevo al
// tema, aquí se añade su nombre y sigue valiendo.

test('nadie usa el nombre corto de un color que el tema registra con prefijo', () => {
  const alias = ['primary-soft', 'primary-hover']
  const culpables: string[] = []
  const revisar = (dir: string) => {
    for (const entrada of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entrada.name}`
      if (entrada.isDirectory()) revisar(rel)
      else if (/\.tsx?$/.test(entrada.name)) {
        const src = readFileSync(join(RAIZ, rel), 'utf8')
        for (const a of alias) {
          // El prefijo `brand-` delante es el uso correcto y no cuenta.
          if (new RegExp(`(?<!brand-)\b(bg|text|border|ring)-${a}\b`).test(src)) {
            culpables.push(`${rel} → ${a}`)
          }
        }
      }
    }
  }
  revisar('src')
  assert.deepEqual(
    culpables,
    [],
    'Estas clases no existen y fallan en silencio; usa el prefijo `brand-`:\n  ' +
      culpables.join('\n  ')
  )
})
