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
  // Vacía: F4 quitó las últimas excepciones.
]
// Componentes que sirven a la app Y a la landing: lo operativo no puede estar
// cableado al espacio público; debe recibir su destino.
const EXCEPCIONES_COMPARTIDOS: Excepcion[] = [
  // Vacía: F4 quitó las últimas excepciones.
]

/** Vista previa del PANEL para la empresa (consulta, no operación del cliente) y la nav/pie de la landing. */
const EXENTOS_ENLACES = new Set([
  // El mapa único de rutas: es el ÚNICO lugar donde se escribe la ruta de cada espacio.
  'src/modules/comercio/rutas.ts',
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
  // Los cargadores que arman datos para las dos fichas: una ruta pública escrita aquí llega a la ficha de la app (F4 lo encontró en `ficha-item`).
  ...archivosDe('src/modules/comercio'),
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

/**
 * LA REGLA: desde ninguna ruta pública se puede ALCANZAR una operación comercial.
 *
 * «Alcanzar» es transitivo. Una página pública que importa una tarjeta, que
 * importa un botón, que llama a una acción de servidor, expone esa acción igual
 * que si la importara ella: Next la registra para esa página y el navegador la
 * descarga. Mirar solo los imports directos (como hacía la primera versión de
 * esta guardia) dejaba pasar justo ese caso.
 *
 * Y a la vez NO se prohíbe por directorio. Una tarjeta compartida que solo
 * presenta información puede vivir en `components/deals` sin que la landing la
 * tenga prohibida: lo que se prohíbe son los NODOS que operan, y se avisa solo
 * si la landing llega a uno, con la cadena de imports que lo demuestra.
 *
 * Nodos que operan:
 *   · los componentes que disparan una operación (carrito, pedido, oferta, compra…);
 *   · los servicios que escriben (pedidos, checkout, inventario, ofertas);
 *   · cualquier módulo `'use server'` (acción de servidor) que no esté permitido.
 */
const COMPONENTES_OPERATIVOS = [
  'src/components/checkout/AgregarAlCarrito.tsx',
  'src/components/checkout/CarritoVista.tsx',
  'src/components/checkout/IconoCarrito.tsx',
  'src/components/checkout/PagarFormulario.tsx',
  'src/components/checkout/useCarrito.ts',
  'src/components/checkout/useResumen.ts',
  'src/components/pedidos/PedirForm.tsx',
  'src/components/deals/ReclamarOfertaBoton.tsx',
  'src/components/deals/AccionObtenerOferta.tsx',
  'src/components/catalogo/AccionesDeCompra.tsx',
  'src/components/ofertas/ReclamarOferta.tsx',
  'src/components/supply-v2/boton-comprar.tsx',
  'src/components/supply-v2/boton-contratar-membresia.tsx',
  'src/components/excursiones/ExcursionCarritoContext.tsx',
  'src/components/excursiones/ExcursionCarritoWrapper.tsx',
  'src/components/excursiones/ExcursionCarritoDrawer.tsx',
  'src/components/excursiones/PasarelaSimuladaModal.tsx',
]

/** Servicios que ESCRIBEN pedidos, reservas, existencias u ofertas. La landing no los alcanza ni de lejos. */
const SERVICIOS_QUE_ESCRIBEN = [
  'src/modules/orders/service.ts',
  'src/modules/orders/escaner.ts',
  'src/modules/checkout/service.ts',
  'src/modules/inventory/service.ts',
  'src/modules/deals/service.ts',
  'src/modules/deals/reclamos.ts',
]

/**
 * Acciones de servidor que SÍ puede alcanzar la landing, con su razón:
 *   · marketplace/actions: contadores de vistas y de «compartir» (analítica).
 *   · solicitudes/actions: la solicitud de alta de una empresa (captación B2B).
 *   · cliente/actions: el buscador unificado, que solo lee.
 *   · invitaciones/clienteActions: contadores del embudo de las landings de invitación (compartir, vistas).
 *   · registro/actions: el alta de una cuenta de cliente (módulo de registro; la landing de invitación la
 *     incrusta). Crea una CUENTA, no un pedido ni una compra.
 *   · registro/empresaActions: el alta de un negocio (captación B2B).
 */
const ACCIONES_PERMITIDAS = [
  'src/modules/marketplace/actions.ts',
  'src/modules/solicitudes/actions.ts',
  'src/modules/cliente/actions.ts',
  'src/modules/invitaciones/clienteActions.ts',
  'src/modules/registro/actions.ts',
  'src/modules/registro/empresaActions.ts',
]

/** Los puntos de entrada de la landing: sus páginas, sus layouts y los enlaces compartidos. */
const RAICES_DE_LA_LANDING = [
  ...archivosDe('src/app/(public)'),
  ...archivosDe('src/app/invitar'),
  'src/app/layout.tsx',
]

const EXTENSIONES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function resolverImport(desde: string, especificador: string): string | null {
  let base: string
  if (especificador.startsWith('@/')) base = join('src', especificador.slice(2))
  else if (especificador.startsWith('.')) base = join(desde, '..', especificador)
  else return null // paquete externo (next, react, lucide…): no es código nuestro
  for (const ext of EXTENSIONES) {
    const candidato = base + ext
    if (existsSync(join(RAIZ, candidato)) && statSync(join(RAIZ, candidato)).isFile()) return candidato
  }
  return null
}

/**
 * Los módulos que `archivo` importa EN TIEMPO DE EJECUCIÓN. Los imports de solo tipos
 * (`import type`) no cuentan: desaparecen al compilar y no llevan nada a la página.
 */
function importsEnEjecucion(archivo: string): string[] {
  const src = leer(archivo)
  const salida = new Set<string>()
  const patrones = [
    /(?:^|\n)\s*import\s+(?!type\b)(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?!type\b)(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const patron of patrones) {
    for (const m of src.matchAll(patron)) {
      const destino = resolverImport(archivo, m[1])
      if (destino) salida.add(destino)
    }
  }
  return [...salida]
}

const esAccionDeServidor = (archivo: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(leer(archivo))

function esNodoQueOpera(archivo: string): boolean {
  if (COMPONENTES_OPERATIVOS.includes(archivo) || SERVICIOS_QUE_ESCRIBEN.includes(archivo)) return true
  return esAccionDeServidor(archivo) && !ACCIONES_PERMITIDAS.includes(archivo)
}

/** Cada nodo operativo que la landing alcanza, con la cadena de imports que lo demuestra. */
function operacionesAlcanzablesDesde(raices: string[]): Map<string, string[]> {
  const padre = new Map<string, string | null>()
  const cola: string[] = []
  for (const r of raices) {
    padre.set(r, null)
    cola.push(r)
  }
  const alcanzados = new Map<string, string[]>()
  while (cola.length > 0) {
    const actual = cola.shift()!
    if (esNodoQueOpera(actual)) {
      const cadena: string[] = []
      for (let n: string | null = actual; n; n = padre.get(n) ?? null) cadena.unshift(n)
      alcanzados.set(actual, cadena)
      // Al llegar a un nodo que opera no se sigue: lo que cuelga de él ya cuelga de él.
      continue
    }
    for (const sig of importsEnEjecucion(actual)) {
      if (!padre.has(sig)) {
        padre.set(sig, actual)
        cola.push(sig)
      }
    }
  }
  return alcanzados
}

/**
 * Operaciones que la landing TODAVÍA alcanza. Cada una nombra la fase que la quita
 * (`decisión` = el producto aún tiene que resolverlo). Al terminar F6 está vacía.
 * F2 vació todo lo de productos, servicios y ofertas del catálogo; F3, todo lo de excursiones y seguir empresa.
 */
const EXCEPCIONES_LANDING_OPERA: Array<{ nodo: string; fase: string }> = [
  // Vacía: F4 quitó las últimas excepciones.
]

test('la landing no alcanza ninguna operación comercial, ni directa ni transitivamente', () => {
  const alcanzadas = operacionesAlcanzablesDesde(RAICES_DE_LA_LANDING)
  const permitidas = new Set(EXCEPCIONES_LANDING_OPERA.map((e) => e.nodo))
  const nuevas = [...alcanzadas.entries()].filter(([nodo]) => !permitidas.has(nodo)).map(([nodo, cadena]) => `${nodo}\n      ← ${cadena.slice(0, -1).reverse().join('\n      ← ')}`)
  assert.deepEqual(
    nuevas,
    [],
    'la landing alcanza una operación comercial (carrito, pedido, reserva, compra, canje o acción de servidor). Esa operación vive en /cliente; en la landing va solo el traspaso (TraspasoALaApp). La cadena de imports que lo demuestra:'
  )
  const olvidadas = EXCEPCIONES_LANDING_OPERA.filter((e) => !alcanzadas.has(e.nodo)).map((e) => `${e.nodo} (la quitaba ${e.fase})`)
  assert.deepEqual(olvidadas, [], 'la landing ya no alcanza esta operación; quítala de la lista (el trabajo de esa fase está hecho)')
})

test('el cierre transitivo no da falsos positivos: una tarjeta que solo presenta no se marca', () => {
  // `TarjetaOferta` y `FichaDeItem` viven en directorios de operaciones pero solo presentan:
  // la landing las usa y NO debe aparecer ninguna como operativa por estar cerca de una.
  for (const presentacion of ['src/components/deals/TarjetaOferta.tsx', 'src/components/catalogo/FichaDeItem.tsx', 'src/components/catalogo/TarjetaCatalogoPublica.tsx', 'src/components/public/TraspasoALaApp.tsx']) {
    assert.equal(esNodoQueOpera(presentacion), false, `${presentacion} solo presenta`)
    assert.deepEqual([...operacionesAlcanzablesDesde([presentacion]).keys()], [], `${presentacion} no debe alcanzar ninguna operación`)
  }
})

test('el cierre transitivo SÍ ve una operación escondida detrás de otros componentes', () => {
  // Control del detector. El inicio de la app llega al botón de obtener oferta pasando por dos componentes
  // que NO operan (InicioRetail y VibeComercio): si el recorrido solo mirara imports directos, no lo vería.
  const desdeElInicio = operacionesAlcanzablesDesde(['src/app/(cliente)/cliente/inicio/page.tsx'])
  const cadena = desdeElInicio.get('src/components/deals/AccionObtenerOferta.tsx')
  assert.ok(cadena, 'el inicio de la app debe alcanzar AccionObtenerOferta')
  assert.ok(cadena.length >= 3, `debe llegar por intermediarios, no por un import directo: ${cadena.join(' → ')}`)
  // La ficha de la app llega a su bloque de compra.
  const desdeLaFicha = operacionesAlcanzablesDesde(['src/app/(cliente)/cliente/empresas/[companySlug]/catalogo/[itemSlug]/page.tsx'])
  assert.ok(desdeLaFicha.has('src/components/catalogo/AccionesDeCompra.tsx'), 'la ficha de la app debe alcanzar AccionesDeCompra')
  // Y las acciones de servidor se reconocen por su directiva, no por su nombre.
  assert.equal(esAccionDeServidor('src/modules/orders/cliente-actions.ts'), true)
  assert.equal(esAccionDeServidor('src/modules/checkout/actions.ts'), true)
  assert.equal(esAccionDeServidor('src/modules/orders/publico.ts'), false)
  assert.equal(esAccionDeServidor('src/modules/comercio/ficha-item.ts'), false)
})

test('los imports de solo tipos no cuentan como alcanzar una operación', () => {
  // `AccionesDeCompra` no se importa por tipo en ninguna parte; el control es sobre el propio analizador.
  const imports = importsEnEjecucion('src/components/catalogo/FichaDeItem.tsx')
  assert.ok(!imports.includes('src/modules/comercio/ficha-item.ts'), 'FichaDeItem importa ficha-item solo por tipo (import type): no debe contar')
  assert.ok(imports.includes('src/modules/comercio/rutas.ts'), 'pero sí cuenta lo que importa en ejecución')
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
  // Vacía: F4 quitó las últimas excepciones.
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

const EXCEPCIONES_PANELES_A_LANDING: Array<{ archivo: string; fase: string }> = []

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
  assert.match(proxy, /destinoParaRol\(redirectTo, role, roleHome,/, 'el proxy debe validar el destino con el validador compartido (rol incluido)')
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
  volcar('LANDING_OPERA', [...operacionesAlcanzablesDesde(RAICES_DE_LA_LANDING).entries()].map(([nodo, cadena]) => ({ nodo, via: cadena[cadena.length - 2] })))
  volcar('SESION', archivosDe('src/app/(public)').filter((f) => /\bgetUser\s*\(/.test(leer(f))))
  volcar('PANELES', [
    ...archivosDe('src/app/(vendedor)'),
  ].filter((f) => leer(f).split('\n').some((l) => !esComentario(l) && /href="\/"/.test(l))))
})
