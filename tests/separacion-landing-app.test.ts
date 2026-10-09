import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROLE_HOME, ROUTE_PROTECTION } from '../src/types'

/**
 * LA FRONTERA ENTRE LA LANDING, LA APP DEL CLIENTE Y LOS PANELES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE DECIDIÓ (docs/SEPARACION_LANDING_APP.md)
 *
 * La landing es un portal de información y descubrimiento: se puede consultar
 * y compartir, pero NO se opera. Nada de carritos, pedidos, reservas, compras,
 * canjes ni contrataciones en el espacio público. Toda acción operativa vive
 * en la app (`/cliente`) o en su panel, y la landing solo ofrece el traspaso
 * (iniciar sesión y seguir a la ruta de la app).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA PRUEBA ESTÁTICA Y UNA LISTA QUE SOLO PUEDE ENCOGERSE
 *
 * El código de hoy ya incumple la regla en varios sitios (ver el documento).
 * Arreglarlo es trabajo de las fases F1 a F5. Esta prueba hace dos cosas
 * mientras tanto:
 *
 *   1. Impide EMPEORAR: una violación nueva, que no esté en la lista, falla.
 *   2. Impide OLVIDAR: una excepción que ya no existe en el código y sigue en
 *      la lista también falla, así cada fase está obligada a vaciar la suya.
 *
 * Al terminar F6 todas las listas EXCEPCIONES_* deben estar vacías.
 *
 * LÍMITE CONOCIDO: es análisis de texto. Ve literales de ruta, constantes
 * `RUTA_*` públicas e imports; no ve un enlace armado por concatenación
 * arbitraria. Para eso están el E2E `separacion-invariantes.spec.ts` y las
 * pruebas por fase.
 */

const RAIZ = join(import.meta.dirname, '..')

function archivosDe(dir: string): string[] {
  const absoluto = join(RAIZ, dir)
  if (!existsSync(absoluto)) return []
  const acc: string[] = []
  for (const e of readdirSync(absoluto)) {
    const p = join(absoluto, e)
    if (statSync(p).isDirectory()) acc.push(...archivosDe(relative(RAIZ, p)))
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(relative(RAIZ, p))
  }
  return acc.sort()
}

const leer = (archivo: string) => readFileSync(join(RAIZ, archivo), 'utf8')
const esComentario = (linea: string) => /^\s*(\/\/|\*|\/\*)/.test(linea)

// ── 1 · Enlaces hacia rutas públicas ────────────────────────────────────────

/** Rutas de la landing que son OPERATIVAS: ahí se compra, se reserva, se paga. */
const CLASES_OPERATIVAS: Array<[string, RegExp]> = [
  ['/carrito', /(['"`])\/carrito(?=[/?#'"`])/g],
  ['/checkout', /(['"`])\/checkout(?=[/?#'"`])/g],
  ['/catalogo', /(['"`])\/catalogo(?=[/?#'"`])/g],
  ['/excursiones', /(['"`])\/excursiones(?=[/?#'"`])/g],
  ['/empresas/*/excursiones', /(['"`])\/empresas\/\$\{[^}]*\}\/excursiones/g],
  ['/empresas/*/catalogo', /(['"`])\/empresas\/\$\{[^}]*\}\/catalogo/g],
  ['/promociones/(membego|membresias|campanas)', /(['"`])\/promociones\/(membego|membresias|campanas)/g],
  ['RUTA_* pública (Supply)', /\bRUTA_(OFERTAS_MEMBEGO|OFERTAS_PUBLICAS|CAMPANAS_PUBLICAS|MEMBRESIAS_PUBLICAS)\b/g],
]

/** Rutas de consulta: la app tiene su equivalente y no debe sacar al cliente de ella. */
const CLASES_VITRINA: Array<[string, RegExp]> = [
  ['/promociones', /(['"`])\/promociones(?=[/?#'"`])/g],
  ['/empresas', /(['"`])\/empresas(?=[/?#'"`])/g],
  ['/ofertas', /(['"`])\/ofertas(?=[/?#'"`])/g],
]

export type Hallazgo = { archivo: string; clase: string; veces: number }

function enlacesAPublico(archivos: string[], clases: Array<[string, RegExp]>): Hallazgo[] {
  const cuenta = new Map<string, number>()
  for (const archivo of archivos) {
    for (const linea of leer(archivo).split('\n')) {
      if (esComentario(linea)) continue
      // Ni los imports ni las declaraciones de la constante son un enlace.
      if (/^\s*(import\b|export\s+const\s+RUTA_)/.test(linea)) continue
      if (/^\s*RUTA_\w+,?\s*$/.test(linea)) continue
      for (const [clase, patron] of clases) {
        patron.lastIndex = 0
        const n = [...linea.matchAll(patron)].length
        if (n > 0) cuenta.set(`${archivo}\u0000${clase}`, (cuenta.get(`${archivo}\u0000${clase}`) ?? 0) + n)
      }
    }
  }
  return [...cuenta.entries()]
    .map(([k, veces]) => {
      const [archivo, clase] = k.split('\u0000')
      return { archivo, clase, veces }
    })
    .sort((a, b) => (a.archivo + a.clase).localeCompare(b.archivo + b.clase))
}

type Excepcion = Hallazgo & { fase: string }

function comparar(nombre: string, reales: Hallazgo[], permitidas: Excepcion[], queEs = 'enlaces nuevos de la app a rutas operativas de la landing. Apunta a la ruta de /cliente.') {
  const clave = (h: Hallazgo) => `${h.archivo} · ${h.clase}`
  const mapaPermitidas = new Map(permitidas.map((e) => [clave(e), e]))
  const nuevas: string[] = []
  const olvidadas: string[] = []
  for (const r of reales) {
    const e = mapaPermitidas.get(clave(r))
    if (!e) nuevas.push(`${clave(r)} ×${r.veces}`)
    else if (r.veces > e.veces) nuevas.push(`${clave(r)} ×${r.veces} (permitido ×${e.veces})`)
  }
  const mapaReales = new Map(reales.map((r) => [clave(r), r]))
  for (const e of permitidas) {
    const r = mapaReales.get(clave(e))
    if (!r) olvidadas.push(`${clave(e)} (la quitaba ${e.fase})`)
    else if (r.veces < e.veces) olvidadas.push(`${clave(e)} ahora ×${r.veces}, la lista dice ×${e.veces} (la quitaba ${e.fase})`)
  }
  assert.deepEqual(
    nuevas,
    [],
    `${nombre}: ${queEs}`
  )
  assert.deepEqual(
    olvidadas,
    [],
    `${nombre}: la excepción ya no existe en el código; quítala de la lista (el trabajo de esa fase está hecho).`
  )
}

// La app del cliente: ningún enlace a la landing, sea la ruta que sea.
const EXCEPCIONES_APP_DIRECTA: Excepcion[] = [
  { archivo: 'src/app/(cliente)/cliente/bienvenida-ref/[companySlug]/page.tsx', clase: '/empresas', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(cliente)/cliente/bienvenida-ref/[companySlug]/page.tsx', clase: '/empresas/*/excursiones', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(cliente)/cliente/bonos/page.tsx', clase: '/promociones', veces: 1, fase: 'F1' },
  { archivo: 'src/app/(cliente)/cliente/bonos/page.tsx', clase: 'RUTA_* pública (Supply)', veces: 2, fase: 'F4' },
  { archivo: 'src/app/(cliente)/cliente/compras/page.tsx', clase: '/promociones', veces: 1, fase: 'F1' },
  { archivo: 'src/app/(cliente)/cliente/cupones/page.tsx', clase: 'RUTA_* pública (Supply)', veces: 2, fase: 'F4' },
  { archivo: 'src/app/(cliente)/cliente/dashboard/ExcursionSearchCard.tsx', clase: '/empresas', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(cliente)/cliente/dashboard/ExcursionSearchCard.tsx', clase: '/empresas/*/excursiones', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(cliente)/cliente/fidelizacion/page.tsx', clase: 'RUTA_* pública (Supply)', veces: 2, fase: 'F4' },
  { archivo: 'src/app/(cliente)/cliente/pedidos/page.tsx', clase: '/catalogo', veces: 1, fase: 'F1' },
  { archivo: 'src/components/cliente/inicio/BuscadorExcursiones.tsx', clase: '/excursiones', veces: 3, fase: 'F1' },
  { archivo: 'src/components/cliente/inicio/BuscadorUnificado.tsx', clase: '/empresas', veces: 1, fase: 'F3' },
  { archivo: 'src/components/cliente/inicio/BuscadorUnificado.tsx', clase: '/empresas/*/excursiones', veces: 1, fase: 'F3' },
  { archivo: 'src/components/cliente/inicio/BuscadorUnificado.tsx', clase: '/excursiones', veces: 2, fase: 'F1' },
]
// Componentes que sirven a la app Y a la landing: lo operativo no puede estar
// cableado al espacio público; debe recibir su destino.
const EXCEPCIONES_COMPARTIDOS: Excepcion[] = [
  { archivo: 'src/components/catalogo/TarjetaCatalogoPublica.tsx', clase: '/empresas', veces: 1, fase: 'F1' },
  { archivo: 'src/components/catalogo/TarjetaCatalogoPublica.tsx', clase: '/empresas/*/catalogo', veces: 1, fase: 'F1' },
  { archivo: 'src/components/catalogo/TarjetaCatalogoPublica.tsx', clase: 'RUTA_* pública (Supply)', veces: 1, fase: 'F4' },
  { archivo: 'src/components/checkout/AgregarAlCarrito.tsx', clase: '/carrito', veces: 2, fase: 'F2' },
  { archivo: 'src/components/checkout/CarritoVista.tsx', clase: '/carrito', veces: 1, fase: 'F2' },
  { archivo: 'src/components/checkout/CarritoVista.tsx', clase: '/empresas', veces: 2, fase: 'F2' },
  { archivo: 'src/components/checkout/IconoCarrito.tsx', clase: '/carrito', veces: 1, fase: 'F2' },
  { archivo: 'src/components/checkout/PagarFormulario.tsx', clase: '/carrito', veces: 4, fase: 'F2' },
  { archivo: 'src/components/deals/TarjetaOferta.tsx', clase: '/empresas', veces: 1, fase: 'F1' },
  { archivo: 'src/components/supply-v2/checkout-cliente.tsx', clase: '/promociones', veces: 1, fase: 'F4' },
  { archivo: 'src/components/supply-v2/checkout-cliente.tsx', clase: '/promociones/(membego|membresias|campanas)', veces: 1, fase: 'F4' },
  { archivo: 'src/components/supply-v2/checkout-cliente.tsx', clase: 'RUTA_* pública (Supply)', veces: 1, fase: 'F4' },
  { archivo: 'src/components/excursiones/ExcursionCarritoDrawer.tsx', clase: '/checkout', veces: 1, fase: 'F3' },
  { archivo: 'src/components/marketplace/CompanyProfile.tsx', clase: '/empresas/*/excursiones', veces: 1, fase: 'F3' },
  { archivo: 'src/components/public/ExcursionCard.tsx', clase: '/empresas/*/excursiones', veces: 1, fase: 'F1' },
  { archivo: 'src/components/public/ExcursionCard.tsx', clase: '/excursiones', veces: 1, fase: 'F1' },
]

/** Vista previa del PANEL para la empresa (consulta, no operación del cliente) y la nav/pie de la landing. */
const EXENTOS_ENLACES = new Set([
  'src/components/catalogo/PanoramaComercial.tsx',
  // La barra y el pie de la landing enlazan a la propia landing, que es su sitio.
  'src/components/public/PublicNav.tsx',
  'src/components/public/PublicFooter.tsx',
])

const ARCHIVOS_APP = [
  ...archivosDe('src/app/(cliente)'),
  ...archivosDe('src/components/cliente'),
  ...archivosDe('src/components/layout'),
]
const ARCHIVOS_COMPARTIDOS_ESTRICTOS = [
  ...archivosDe('src/components/checkout'),
  ...archivosDe('src/components/deals'),
  ...archivosDe('src/components/catalogo'),
  ...archivosDe('src/components/pedidos'),
  ...archivosDe('src/components/supply-v2'),
].filter((f) => !EXENTOS_ENLACES.has(f))
const ARCHIVOS_COMPARTIDOS_CON_MODO = [
  ...archivosDe('src/components/marketplace'),
  ...archivosDe('src/components/public'),
  ...archivosDe('src/components/excursiones'),
].filter((f) => !EXENTOS_ENLACES.has(f))

test('la app del cliente no manda al cliente a la landing', () => {
  comparar(
    'app del cliente',
    enlacesAPublico(ARCHIVOS_APP, [...CLASES_OPERATIVAS, ...CLASES_VITRINA]),
    EXCEPCIONES_APP_DIRECTA
  )
})

test('los componentes compartidos no cablean a la landing lo operativo', () => {
  const reales = [
    ...enlacesAPublico(ARCHIVOS_COMPARTIDOS_ESTRICTOS, [...CLASES_OPERATIVAS, ...CLASES_VITRINA]),
    ...enlacesAPublico(ARCHIVOS_COMPARTIDOS_CON_MODO, CLASES_OPERATIVAS),
  ]
  comparar('componentes compartidos', reales, EXCEPCIONES_COMPARTIDOS)
})

// ── 2 · La landing no opera ─────────────────────────────────────────────────

/** Componentes que disparan una operación comercial: no pueden montarse en la landing. */
const COMPONENTES_OPERATIVOS = [
  'components/checkout/AgregarAlCarrito',
  'components/checkout/CarritoVista',
  'components/checkout/IconoCarrito',
  'components/checkout/PagarFormulario',
  'components/checkout/useCarrito',
  'components/checkout/useResumen',
  'components/pedidos/PedirForm',
  'components/deals/ReclamarOfertaBoton',
  'components/ofertas/ReclamarOferta',
  'components/supply-v2/boton-comprar',
  'components/supply-v2/boton-contratar-membresia',
  'components/excursiones/ExcursionCarritoContext',
  'components/excursiones/ExcursionCarritoWrapper',
  'components/excursiones/ExcursionCarritoDrawer',
  'components/excursiones/PasarelaSimuladaModal',
]

/**
 * Acciones de servidor que SÍ pueden importarse desde la landing, con su razón:
 *   · marketplace/actions: contadores de vistas y de «compartir» (analítica).
 *   · solicitudes/actions: la solicitud de alta de una empresa (captación B2B).
 *   · cliente/actions: el buscador unificado, que solo lee.
 */
const ACCIONES_PERMITIDAS = [
  '@/modules/marketplace/actions',
  '@/modules/solicitudes/actions',
  '@/modules/cliente/actions',
]

type Importa = { archivo: string; clase: string; veces: number }

function importsOperativos(archivos: string[]): Importa[] {
  const cuenta = new Map<string, number>()
  for (const archivo of archivos) {
    const src = leer(archivo)
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    // Imports relativos a componentes locales de la página (ReservaExcursionForm, CheckoutClient).
    const locales = [...src.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1])
    for (const spec of imports) {
      let clase: string | null = null
      if (COMPONENTES_OPERATIVOS.some((c) => spec === `@/${c}`)) clase = spec.replace('@/', '')
      else if (/^@\/modules\/.+(-actions|\/actions)$/.test(spec) && !ACCIONES_PERMITIDAS.includes(spec)) clase = spec.replace('@/', '')
      if (clase) cuenta.set(`${archivo}\u0000${clase}`, (cuenta.get(`${archivo}\u0000${clase}`) ?? 0) + 1)
    }
    for (const spec of locales) {
      if (/\/(ReservaExcursionForm|CheckoutClient)$/.test(spec)) {
        cuenta.set(`${archivo}\u0000local:${spec.split('/').pop()}`, 1)
      }
    }
  }
  return [...cuenta.entries()]
    .map(([k, veces]) => {
      const [archivo, clase] = k.split('\u0000')
      return { archivo, clase, veces }
    })
    .sort((a, b) => (a.archivo + a.clase).localeCompare(b.archivo + b.clase))
}

// Cada una nombra la fase que la elimina. `decision` marca lo que el producto
// aún tiene que resolver (seguir empresa y reseñas son acciones del cliente).
const EXCEPCIONES_LANDING_OPERA: Excepcion[] = [
  { archivo: 'src/app/(public)/carrito/pagar/[companySlug]/page.tsx', clase: 'components/checkout/PagarFormulario', veces: 1, fase: 'F2' },
  { archivo: 'src/app/(public)/carrito/page.tsx', clase: 'components/checkout/CarritoVista', veces: 1, fase: 'F2' },
  { archivo: 'src/app/(public)/checkout/CheckoutClient.tsx', clase: 'components/excursiones/ExcursionCarritoContext', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/checkout/CheckoutClient.tsx', clase: 'components/excursiones/PasarelaSimuladaModal', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/checkout/CheckoutClient.tsx', clase: 'modules/excursiones/reservas/cliente-actions', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/checkout/page.tsx', clase: 'components/excursiones/ExcursionCarritoWrapper', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/checkout/page.tsx', clase: 'local:CheckoutClient', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx', clase: 'components/checkout/AgregarAlCarrito', veces: 1, fase: 'F2' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx', clase: 'components/deals/ReclamarOfertaBoton', veces: 1, fase: 'F2' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx', clase: 'components/pedidos/PedirForm', veces: 1, fase: 'F2' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx', clase: 'local:ReservaExcursionForm', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/ReservaExcursionForm.tsx', clase: 'components/excursiones/ExcursionCarritoContext', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/ReservaExcursionForm.tsx', clase: 'modules/excursiones/reservas/cliente-actions', veces: 2, fase: 'F3' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/ReservaExcursionForm.tsx', clase: 'modules/social/actions', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/layout.tsx', clase: 'components/excursiones/ExcursionCarritoWrapper', veces: 1, fase: 'F3' },
  { archivo: 'src/app/(public)/oferta/[codigo]/page.tsx', clase: 'components/ofertas/ReclamarOferta', veces: 1, fase: 'F4' },
  { archivo: 'src/app/(public)/promociones/membego/[slug]/page.tsx', clase: 'components/supply-v2/boton-comprar', veces: 1, fase: 'F4' },
  { archivo: 'src/app/(public)/promociones/membresias/page.tsx', clase: 'components/supply-v2/boton-contratar-membresia', veces: 1, fase: 'F4' },
  { archivo: 'src/components/marketplace/ResenaForm.tsx', clase: 'modules/resenas/actions', veces: 1, fase: 'F3 (decisión de producto: reseñas)' },
  { archivo: 'src/components/public/FollowButton.tsx', clase: 'modules/social/actions', veces: 1, fase: 'F3 (decisión de producto: seguir empresa)' },
  { archivo: 'src/components/public/PublicNav.tsx', clase: 'components/checkout/IconoCarrito', veces: 1, fase: 'F2' },
]

const ARCHIVOS_LANDING = [
  ...archivosDe('src/app/(public)'),
  ...archivosDe('src/components/public'),
  ...archivosDe('src/components/marketplace'),
]

test('la landing no importa operaciones comerciales', () => {
  comparar('landing', importsOperativos(ARCHIVOS_LANDING), EXCEPCIONES_LANDING_OPERA, 'la landing importa una operación comercial (carrito, pedido, reserva, compra, canje, acción de servidor). Esa operación vive en /cliente; aquí solo va el traspaso.')
})

// ── 3 · La landing sigue siendo estática ────────────────────────────────────

test('el layout y la barra públicos no leen la sesión en servidor', () => {
  // El estado de sesión de la landing será un componente de cliente ligero (F5).
  // Si el layout leyera cookies o cabeceras, TODA la landing pasaría a dinámica.
  for (const archivo of ['src/app/(public)/layout.tsx', 'src/components/public/PublicNav.tsx', 'src/components/public/PublicFooter.tsx']) {
    const src = leer(archivo)
    assert.doesNotMatch(src, /from\s+'next\/headers'/, `${archivo} no puede leer cabeceras/cookies`)
    assert.doesNotMatch(src, /from\s+'@\/lib\/auth(\/[^']*)?'/, `${archivo} no puede leer la sesión en servidor`)
    assert.doesNotMatch(src, /from\s+'@\/lib\/supabase\/server'/, `${archivo} no puede crear el cliente de servidor`)
    assert.doesNotMatch(src, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/, `${archivo} no puede forzar render dinámico`)
  }
})

const EXCEPCIONES_PAGINAS_CON_SESION: Array<{ archivo: string; fase: string }> = [
  { archivo: 'src/app/(public)/checkout/page.tsx', fase: 'F3' },
  { archivo: 'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx', fase: 'F3' },
  { archivo: 'src/app/(public)/oferta/[codigo]/page.tsx', fase: 'F4' },
  { archivo: 'src/app/(public)/promociones/campanas/[code]/page.tsx', fase: 'F4' },
  { archivo: 'src/app/(public)/promociones/campanas/page.tsx', fase: 'F4' },
  { archivo: 'src/app/(public)/promociones/membego/[slug]/page.tsx', fase: 'F4' },
]

test('las páginas públicas no leen la sesión en servidor', () => {
  const reales = archivosDe('src/app/(public)')
    .filter((f) => /\bgetUser\s*\(/.test(leer(f)))
    .sort()
  const permitidas = EXCEPCIONES_PAGINAS_CON_SESION.map((e) => e.archivo).sort()
  const nuevas = reales.filter((f) => !permitidas.includes(f))
  const olvidadas = EXCEPCIONES_PAGINAS_CON_SESION.filter((e) => !reales.includes(e.archivo)).map((e) => `${e.archivo} (la quitaba ${e.fase})`)
  assert.deepEqual(nuevas, [], 'una página pública nueva lee la sesión: el estado de sesión va en el componente de cliente de la barra')
  assert.deepEqual(olvidadas, [], 'la página ya no lee la sesión: quítala de la lista')
})

// ── 4 · Los paneles no dependen de la landing ───────────────────────────────

const EXCEPCIONES_PANELES_A_LANDING: Array<{ archivo: string; fase: string }> = [
  { archivo: 'src/app/(vendedor)/layout.tsx', fase: 'F1' },
]

test('los paneles y espacios autenticados no enlazan a la portada de la landing', () => {
  const archivos = [
    ...archivosDe('src/app/(admin)'),
    ...archivosDe('src/app/(superadmin)'),
    ...archivosDe('src/app/(empleado)'),
    ...archivosDe('src/app/(vendedor)'),
    ...archivosDe('src/app/(onboarding)'),
    ...archivosDe('src/components/admin'),
    ...archivosDe('src/components/superadmin'),
    ...archivosDe('src/components/layout'),
  ]
  const portada = /(href=(?:"\/"|\{'\/'\}|\{"\/"\})|\b(?:redirect|push|replace)\(\s*['"]\/['"]\s*\))/
  const reales = archivos.filter((f) => leer(f).split('\n').some((l) => !esComentario(l) && portada.test(l))).sort()
  const permitidas = EXCEPCIONES_PANELES_A_LANDING.map((e) => e.archivo).sort()
  assert.deepEqual(
    reales.filter((f) => !permitidas.includes(f)),
    [],
    'un espacio autenticado manda a la portada de la landing: debe ir a su propia casa (ROLE_HOME)'
  )
  assert.deepEqual(
    EXCEPCIONES_PANELES_A_LANDING.filter((e) => !reales.includes(e.archivo)).map((e) => `${e.archivo} (la quitaba ${e.fase})`),
    [],
    'la excepción ya no existe: quítala de la lista'
  )
})

// ── 5 · La autenticación y la autorización no se tocan ──────────────────────

test('cada rol tiene una casa que su propia protección le permite abrir', () => {
  for (const [rol, casa] of Object.entries(ROLE_HOME)) {
    const reglas = ROUTE_PROTECTION.filter((r) => casa.startsWith(r.prefix))
    assert.ok(reglas.length > 0, `${rol}: la casa ${casa} no está protegida por ningún prefijo`)
    assert.ok(
      reglas.some((r) => (r.roles as string[]).includes(rol)),
      `${rol}: su casa ${casa} le queda cerrada por ROUTE_PROTECTION (bucle de redirección)`
    )
  }
})

test('las puertas de acceso son públicas y los espacios privados están protegidos', () => {
  for (const publica of ['/login', '/acceso', '/recuperar', '/actualizar-password', '/registro', '/', '/empresas', '/catalogo']) {
    assert.equal(ROUTE_PROTECTION.some((r) => publica.startsWith(r.prefix)), false, `${publica} no puede estar protegida`)
  }
  for (const privada of ['/admin/dashboard', '/superadmin/dashboard', '/cliente/inicio', '/empleado/scanner', '/vendedor', '/mis-membresias', '/membresia/x']) {
    assert.equal(ROUTE_PROTECTION.some((r) => privada.startsWith(r.prefix)), true, `${privada} tiene que estar protegida`)
  }
})

test('el cierre de sesión va a una pantalla pública de acceso y el proxy rechaza destinos externos', () => {
  const logout = leer('src/modules/auth/actions.ts')
  assert.match(logout, /export async function logout\(\)[\s\S]*?redirect\('\/login'\)/, 'logout debe terminar en /login')
  const proxy = leer('src/proxy.ts')
  assert.match(proxy, /redirectTo\.startsWith\('\/'\)\s*&&\s*!redirectTo\.startsWith\('\/\/'\)/, 'el proxy debe rechazar destinos que no sean rutas internas')
  assert.match(proxy, /fail-closed|Fail-closed/i, 'el proxy debe seguir fallando cerrado')
})

// ── 6 · Las URL públicas que valen para SEO y enlaces compartidos ───────────

const URL_PUBLICAS_QUE_SE_CONSERVAN = [
  'src/app/(public)/page.tsx',
  'src/app/(public)/empresas/page.tsx',
  'src/app/(public)/empresas/[companySlug]/page.tsx',
  'src/app/(public)/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx',
  'src/app/(public)/empresas/[companySlug]/excursiones/page.tsx',
  'src/app/(public)/empresas/[companySlug]/excursiones/[excursionSlug]/page.tsx',
  'src/app/(public)/excursiones/page.tsx',
  'src/app/(public)/catalogo/page.tsx',
  'src/app/(public)/ofertas/page.tsx',
  'src/app/(public)/promociones/page.tsx',
  'src/app/(public)/promociones/membego/[slug]/page.tsx',
  'src/app/(public)/promociones/membresias/page.tsx',
  'src/app/(public)/promociones/campanas/page.tsx',
  'src/app/(public)/promociones/campanas/[code]/page.tsx',
  'src/app/(public)/promocion/[clave]/page.tsx',
  'src/app/(public)/oferta/[codigo]/page.tsx',
  'src/app/(public)/plan/[id]/page.tsx',
  'src/app/(public)/i/[code]/page.tsx',
  'src/app/invitar/[code]/page.tsx',
  'src/app/(public)/caracteristicas/page.tsx',
  'src/app/(public)/faq/page.tsx',
  'src/app/(public)/blog/page.tsx',
  'src/app/(public)/contact/page.tsx',
  'src/app/(public)/descargar/page.tsx',
  'src/app/(public)/privacy/page.tsx',
  'src/app/(public)/terms/page.tsx',
  'src/app/(public)/registro-empresa/page.tsx',
  'src/app/(public)/solicitud-empresa/page.tsx',
  'src/app/(public)/eliminar-cuenta/page.tsx',
]

test('las URL públicas con valor de SEO y de enlace compartido siguen existiendo', () => {
  const faltan = URL_PUBLICAS_QUE_SE_CONSERVAN.filter((f) => !existsSync(join(RAIZ, f)))
  assert.deepEqual(faltan, [], 'se retiró una página pública con valor de SEO o de enlace compartido: déjala como ficha de consulta y redirige solo lo operativo')
})

test('el sitemap sigue anunciando la portada, el marketplace y las promociones', () => {
  const sitemap = leer('src/app/sitemap.ts')
  for (const ruta of ["''", "'/empresas'", "'/promociones'"]) assert.ok(sitemap.includes(ruta), `el sitemap ya no incluye ${ruta}`)
})

test('las rutas operativas de la landing nunca estuvieron en el sitemap', () => {
  const sitemap = leer('src/app/sitemap.ts')
  for (const ruta of ['/carrito', '/checkout']) assert.equal(sitemap.includes(`'${ruta}`), false, `${ruta} no puede anunciarse`)
})

// ── El detector, probado contra sí mismo ────────────────────────────────────

test('el detector reconoce los enlaces que debe vigilar', () => {
  const casos: Array<[string, string]> = [
    ['<Link href="/carrito">', '/carrito'],
    ["router.push('/checkout')", '/checkout'],
    ['href={`/empresas/${e.empresa.slug}/excursiones/${e.slug}`}', '/empresas/*/excursiones'],
    ['href={`/empresas/${c.slug}/catalogo/${i.slug}`}', '/empresas/*/catalogo'],
    ['<Link href="/promociones/membego/x">', '/promociones/(membego|membresias|campanas)'],
    ['const h = `${RUTA_OFERTAS_MEMBEGO}/${s}`', 'RUTA_* pública (Supply)'],
    ['<Link href="/excursiones?q=a">', '/excursiones'],
  ]
  for (const [linea, esperada] of casos) {
    const [, patron] = CLASES_OPERATIVAS.find(([c]) => c === esperada)!
    patron.lastIndex = 0
    assert.ok(patron.test(linea), `no detecta ${esperada} en: ${linea}`)
  }
  // Lo que NO debe confundir: la ruta de la app y la de la vitrina propia.
  for (const [, patron] of CLASES_OPERATIVAS) {
    for (const ok of ['<Link href="/cliente/carrito">', "href={`/cliente/empresas/${s}/catalogo/${i}`}", '<Link href="/cliente/excursiones">']) {
      patron.lastIndex = 0
      assert.equal(patron.test(ok), false, `falso positivo en: ${ok}`)
    }
  }
})

test('VOLCADO (solo con SEPARACION_VOLCAR=1): imprime las listas reales para revisarlas', { skip: process.env.SEPARACION_VOLCAR !== '1' }, () => {
  const volcar = (t: string, v: unknown) => console.log(`\n### ${t}\n${JSON.stringify(v, null, 1)}`)
  volcar('APP', enlacesAPublico(ARCHIVOS_APP, [...CLASES_OPERATIVAS, ...CLASES_VITRINA]))
  volcar('COMPARTIDOS', [
    ...enlacesAPublico(ARCHIVOS_COMPARTIDOS_ESTRICTOS, [...CLASES_OPERATIVAS, ...CLASES_VITRINA]),
    ...enlacesAPublico(ARCHIVOS_COMPARTIDOS_CON_MODO, CLASES_OPERATIVAS),
  ])
  volcar('LANDING_OPERA', importsOperativos(ARCHIVOS_LANDING))
  volcar('SESION', archivosDe('src/app/(public)').filter((f) => /\bgetUser\s*\(/.test(leer(f))))
  volcar('PANELES', [
    ...archivosDe('src/app/(vendedor)'),
  ].filter((f) => leer(f).split('\n').some((l) => !esComentario(l) && /href="\/"/.test(l))))
})
