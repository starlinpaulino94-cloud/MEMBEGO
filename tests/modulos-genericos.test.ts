import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

/**
 * LOS MÓDULOS GENÉRICOS SON DE MEMBEGO, NO DE UN OFICIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE RETIRÓ Y POR QUÉ
 *
 * «Aplicaciones» era un launchpad de sistemas especializados CONSTRUIDOS DENTRO
 * de MembeGo: se entraba a una app de la categoría del negocio y desde ahí a
 * sus módulos. La idea cambió — cada oficio se construye como sistema aparte y
 * se conecta por contrato (`docs/platform/satelite.md`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DAÑO QUE HACÍA AL MENÚ
 *
 * La app declaraba `navOculta`: con ella activa, cuatro entradas desaparecían
 * del menú lateral «porque ya viven dentro de la app». Eran Escanear QR, Citas,
 * Seguimiento y Sucursales.
 *
 * Ninguna de las cuatro es de un lavadero. Escanear un QR, agendar una cita,
 * ver quién no ha venido o llevar las sucursales son cosas de MembeGo, y las
 * hace igual un restaurante. Quien retirara el launcher sin devolverlas al menú
 * las dejaba sin ningún camino: la pantalla existe y no se llega.
 *
 * Estas guardias vigilan las dos mitades: que el launcher no vuelva, y que las
 * cinco pantallas genéricas sigan teniendo su sitio.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const NAV = 'src/components/layout/nav-config.ts'
const LAYOUT_ADMIN = 'src/app/(admin)/layout.tsx'

test('los cinco módulos genéricos están en el menú', () => {
  const nav = leer(NAV)
  // Los cuatro del admin y el de caja, que es del empleado porque se cobra en
  // el mostrador. Son las cinco pantallas que el catálogo de apps reutilizaba
  // entre categorías: la prueba de que nunca fueron de un oficio concreto.
  for (const [ruta, nombre] of [
    ['/admin/scanner', 'Escanear QR'],
    ['/admin/citas', 'Citas'],
    ['/admin/seguimiento', 'Seguimiento'],
    ['/admin/sucursales', 'Sucursales'],
    ['/empleado/caja', 'Caja'],
  ] as const) {
    assert.ok(
      nav.includes(`'${ruta}'`),
      `«${nombre}» (${ruta}) desapareció del menú. Es una pantalla de MembeGo: ` +
        'sin entrada en el menú, existe y no se llega a ella.'
    )
  }
})

test('nada vuelve a esconder entradas del menú por la app de un oficio', () => {
  const layout = leer(LAYOUT_ADMIN)
  assert.ok(
    !/navOcultaPorApps/.test(layout),
    'Volvió `navOcultaPorApps`: escondía del menú las pantallas genéricas ' +
      '«porque ya viven dentro de la app Car Wash». Ya no hay app dentro de ' +
      'MembeGo, así que esconderlas solo las deja inalcanzables.'
  )
  assert.ok(
    !/navOculta/.test(leer(NAV)),
    'El menú no debe declarar entradas ocultas por categoría de negocio.'
  )
})

test('el launchpad de aplicaciones no vuelve', () => {
  for (const ruta of [
    'src/app/(admin)/admin/aplicaciones',
    'src/app/(admin)/admin/app/[app]',
    'src/modules/apps/catalogo.ts',
  ]) {
    assert.ok(
      !existsSync(ruta),
      `Volvió ${ruta}. Los sistemas de cada oficio se construyen aparte y se ` +
        'conectan por contrato; el catálogo en el código era justo el techo que ' +
        'la plataforma vino a quitar.'
    )
  }
  assert.ok(
    !leer(NAV).includes("/admin/aplicaciones"),
    'Volvió la entrada «Aplicaciones» al menú.'
  )
})

test('las pantallas de Car Wash siguen en el repositorio', () => {
  // Se decidió OCULTARLAS, no borrarlas: son 13 pantallas y 20 tablas con
  // datos, y su sitio final es un sistema independiente que todavía no existe.
  // Borrarlas ahora sería perder la operación de quien lo use hoy.
  assert.ok(
    existsSync('src/app/(admin)/admin/app/carwash'),
    'Las pantallas de Car Wash se borraron. Debían conservarse para su ' +
      'extracción a un sistema independiente.'
  )
  assert.ok(
    existsSync('prisma/schema/carwash.prisma'),
    'El esquema de Car Wash se borró. Sus tablas tienen datos.'
  )
  // Ocultas de verdad: nada del menú las enlaza.
  assert.ok(
    !leer(NAV).includes('/admin/app/'),
    'El menú volvió a enlazar pantallas de Car Wash. Quedan alcanzables por ' +
      'URL hasta que existan como sistema aparte, no desde el menú.'
  )
})
