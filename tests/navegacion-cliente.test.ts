import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { navForRole } from '../src/components/layout/nav-config'

/**
 * LA NAVEGACIÓN DEL CLIENTE SEPARA TRES COSAS QUE NO SON LA MISMA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ERROR CONCRETO QUE ESTO ARREGLA
 *
 * «Planes» vivía dentro del grupo «Mis beneficios», al lado de «Mis
 * membresías». No es un problema de orden: son cosas opuestas.
 *
 *   · Un PLAN es catálogo. Algo que TODAVÍA se puede comprar.
 *   · Una MEMBRESÍA es una instancia. Algo que YA es tuyo.
 *
 * Juntos, quien entra a ver qué tiene se encuentra un escaparate de lo que no
 * tiene; y quien quiere comprar no lo busca ahí.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UNA GUARDIA Y NO SOLO UN COMENTARIO
 *
 * Es el tipo de decisión que se deshace sola: alguien añade un módulo nuevo y
 * lo pone «donde encaja visualmente», no donde encaja conceptualmente. Con el
 * tiempo los grupos vuelven a mezclarse y nadie recuerda que la separación era
 * deliberada.
 */

const CLIENTE = navForRole('CLIENTE')
const rutas = (grupo: string) =>
  CLIENTE.find((g) => g.label === grupo)?.items.map((i) => i.href) ?? []

test('lo que se adquiere y lo que ya se tiene están separados', () => {
  const descubrir = rutas('Descubrir')
  const mio = rutas('Mi Membego')

  assert.ok(
    descubrir.includes('/cliente/planes'),
    'Los PLANES son catálogo: van en Descubrir. En «Mis beneficios» le enseñan ' +
      'a alguien un escaparate de lo que NO tiene, justo donde entró a ver lo ' +
      'que sí tiene.'
  )
  assert.ok(
    mio.includes('/mis-membresias'),
    'Las MEMBRESÍAS ya son suyas: van en Mi Membego.'
  )
  assert.ok(
    !mio.includes('/cliente/planes'),
    'Volvió «Planes» a «Mi Membego»: un plan no es tuyo hasta que lo contratas.'
  )
  assert.ok(
    !descubrir.includes('/mis-membresias'),
    'Las membresías del cliente no son algo que descubrir.'
  )
})

test('la actividad no se mezcla con lo que se posee', () => {
  const actividad = rutas('Actividad')
  const mio = rutas('Mi Membego')
  // Lo que YA OCURRIÓ (pagos, citas, historial) contra lo que TIENES. Un pago
  // hecho no es un activo; una membresía activa no es un evento pasado.
  for (const r of ['/cliente/pagos', '/cliente/citas', '/cliente/historial']) {
    assert.ok(actividad.includes(r), `${r} pertenece a Actividad.`)
    assert.ok(!mio.includes(r), `${r} no es algo que el cliente «tenga».`)
  }
})

test('ninguna ruta del cliente se perdió al reagrupar', () => {
  // Reagrupar es mover etiquetas, no direcciones. Si una ruta desaparece del
  // menú, su pantalla sigue existiendo y deja de tener camino — que es peor
  // que borrarla, porque nadie se entera.
  const todas = CLIENTE.flatMap((g) => g.items.map((i) => i.href))
  const OBLIGATORIAS = [
    '/cliente/inicio',
    '/cliente/promociones',
    '/cliente/planes',
    '/cliente/cerca',
    '/cliente/mis-promociones',
    '/mis-membresias',
    '/cliente/regalos',
    '/cliente/invita-y-gana',
    '/cliente/ruleta',
    '/cliente/citas',
    '/cliente/pagos',
    '/cliente/historial',
    '/cliente/perfil',
    '/cliente/vehiculos',
    '/cliente/ayuda',
  ]
  for (const r of OBLIGATORIAS) {
    assert.ok(todas.includes(r), `Desapareció ${r} del menú del cliente.`)
  }
})

test('toda entrada del menú lleva a una pantalla que existe', () => {
  // Enlazar a una pantalla inexistente es peor que no enlazar: promete algo y
  // devuelve un 404.
  const faltan: string[] = []
  for (const g of CLIENTE) {
    for (const i of g.items) {
      const base = i.href.replace(/^\//, '').split('?')[0]
      const candidatos = [
        `src/app/(cliente)/${base}/page.tsx`,
        `src/app/${base}/page.tsx`,
      ]
      if (!candidatos.some(existsSync)) faltan.push(`${i.label} → ${i.href}`)
    }
  }
  assert.deepEqual(faltan, [], 'Entradas del menú sin pantalla:\n  ' + faltan.join('\n  '))
})

test('el selector de empresa del cliente se oculta cuando no hay dónde elegir', () => {
  // Con una sola empresa, un selector de una opción es ruido: ocupa sitio en la
  // cabecera y sugiere que hay una decisión que tomar cuando no la hay.
  //
  // Esto YA estaba bien y se comprobó al auditar: lo que el encargo describía
  // como «selector obligatorio en la barra superior» es el del panel de ADMIN,
  // que sí gestiona varias empresas y donde el propio encargo permite
  // conservarlo (§ 4.1).
  const src = readFileSync('src/components/cliente/CompanySwitcher.tsx', 'utf8')
  assert.match(
    src,
    /companies\.length < 2\)\s*return null/,
    'El selector del cliente debe desaparecer con menos de dos empresas.'
  )
})
