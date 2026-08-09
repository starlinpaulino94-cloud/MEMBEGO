import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  navForRole,
  navContextsForRole,
  allLinks,
  migasDeRuta,
} from '../src/components/layout/nav-config'
import type { AppRole } from '../src/types'

/**
 * SHELL GLOBAL — navegación y suelo tipográfico (DS 2.0 · Fases 0 y 1).
 *
 * POR QUÉ SE PRUEBA ESTO Y NO EL ASPECTO DE LAS PANTALLAS:
 *
 * Reagrupar un menú es la clase de cambio que rompe cosas en silencio. Una
 * ruta que se cae del menú no da error: simplemente deja de existir para
 * quien no se sepa la URL, y nadie lo nota hasta que un administrador
 * pregunta dónde fueron a parar sus comprobantes. Igual con el breadcrumb: si
 * el dominio deja de resolverse, la cabecera no falla, solo vuelve a decir
 * menos de lo que debería.
 *
 * Son funciones puras sobre datos estáticos, así que se verifican sin
 * navegador y sin base de datos — exactamente lo que uno rompería sin darse
 * cuenta al mover un enlace de grupo en una fase futura.
 */

const ROLES: AppRole[] = [
  'ADMINISTRADOR',
  'CLIENTE',
  'SUPERADMIN',
  'EMPLEADO',
  'MARKETING',
  'SUPERVISOR',
]

// ── Integridad del menú ──────────────────────────────────────────────────

test('ningún rol se queda sin navegación', () => {
  for (const role of ROLES) {
    const links = allLinks(navForRole(role))
    assert.ok(links.length > 0, `${role} no tiene ni un enlace`)
  }
})

test('no hay rutas duplicadas dentro de un mismo rol', () => {
  for (const role of ROLES) {
    const hrefs = allLinks(navForRole(role)).map((l) => l.href)
    const unicos = new Set(hrefs)
    assert.equal(
      hrefs.length,
      unicos.size,
      `${role} repite alguna ruta en el menú: ${hrefs.filter((h, i) => hrefs.indexOf(h) !== i).join(', ')}`
    )
  }
})

test('no hay dos entradas con la misma etiqueta apuntando a rutas distintas', () => {
  // Es el defecto concreto que arregló la Fase 0: existían dos "Campañas",
  // /admin/campanas y /admin/audiencia/campanas, en el mismo menú. Etiqueta
  // idéntica y destino distinto es una trampa, no una decisión de diseño.
  for (const role of ROLES) {
    const porEtiqueta = new Map<string, Set<string>>()
    for (const l of allLinks(navForRole(role))) {
      const set = porEtiqueta.get(l.label) ?? new Set()
      set.add(l.href)
      porEtiqueta.set(l.label, set)
    }
    for (const [label, hrefs] of porEtiqueta) {
      assert.equal(
        hrefs.size,
        1,
        `${role}: "${label}" apunta a ${hrefs.size} rutas distintas (${[...hrefs].join(', ')})`
      )
    }
  }
})

test('cada grupo tiene al menos un enlace', () => {
  for (const role of ROLES) {
    for (const grupo of navForRole(role)) {
      assert.ok(grupo.items.length > 0, `${role}: el grupo "${grupo.label}" está vacío`)
    }
  }
})

test('el panel de administrador son ocho dominios', () => {
  const grupos = navForRole('ADMINISTRADOR')
  assert.equal(grupos.length, 8)
  assert.deepEqual(
    grupos.map((g) => g.label),
    ['Inicio', 'Clientes', 'Beneficios', 'Marketing', 'Operaciones', 'Analítica', 'Empresa', 'Soporte']
  )
})

// ── Contextos (superadmin) ───────────────────────────────────────────────

test('solo el superadmin tiene más de un contexto', () => {
  for (const role of ROLES) {
    const n = navContextsForRole(role).length
    if (role === 'SUPERADMIN') assert.equal(n, 2, 'el superadmin debe tener dos contextos')
    else assert.equal(n, 1, `${role} no debería tener selector de contexto`)
  }
})

test('los contextos del superadmin cubren toda su navegación', () => {
  // El selector reparte los enlaces; no puede perder ninguno por el camino.
  const plano = new Set(allLinks(navForRole('SUPERADMIN')).map((l) => l.href))
  const enContextos = new Set(
    navContextsForRole('SUPERADMIN').flatMap((c) => allLinks(c.groups).map((l) => l.href))
  )
  assert.deepEqual([...plano].sort(), [...enContextos].sort())
})

// ── Breadcrumb ───────────────────────────────────────────────────────────

test('el breadcrumb nombra el dominio, no solo la página', () => {
  const grupos = navForRole('ADMINISTRADOR')
  const m = migasDeRuta(grupos, '/admin/campanas')
  assert.equal(m.dominio, 'Marketing')
  assert.equal(m.seccion?.label, 'Campañas')
  assert.equal(m.hoja, null)
})

test('gana el href más largo, no el primero que casa por prefijo', () => {
  // /admin/audiencia/segmentos casa TAMBIÉN con /admin/audiencia. Si ganara el
  // prefijo corto, el breadcrumb diría "Audiencia" estando en otra pantalla.
  //
  // Esta prueba usaba /admin/audiencia/campanas hasta la Fase 11, que sacó esa
  // ruta del menú al darle pestañas a Audiencia. Al salir del menú deja de
  // tener miga propia y resuelve a "Audiencia" — que es lo correcto: sus
  // pestañas ya dicen en cuál de las tres vistas estás. El principio no
  // cambió, solo la ruta que lo ejercita.
  const grupos = navForRole('ADMINISTRADOR')
  const m = migasDeRuta(grupos, '/admin/audiencia/segmentos')
  assert.equal(m.seccion?.href, '/admin/audiencia/segmentos')
  assert.equal(m.seccion?.label, 'Segmentos')
})

test('una subvista fuera del menú hereda la miga de su sección', () => {
  // /admin/audiencia/campanas ya no está en el menú: su navegación son las
  // pestañas de Audiencia. El breadcrumb debe decir "Audiencia", no quedarse
  // en blanco ni inventar un nombre.
  const grupos = navForRole('ADMINISTRADOR')
  const m = migasDeRuta(grupos, '/admin/audiencia/campanas')
  assert.equal(m.seccion?.href, '/admin/audiencia')
  assert.equal(m.dominio, 'Analítica')
})

test('las subpáginas se nombran en vez de quedar como "Detalle"', () => {
  const grupos = navForRole('ADMINISTRADOR')
  assert.equal(migasDeRuta(grupos, '/admin/planes/nuevo').hoja, 'Nuevo')
  assert.equal(migasDeRuta(grupos, '/admin/planes/abc123/editar').hoja, 'Editar')
  // Un id suelto no tiene nombre legible: "Detalle" es lo honesto.
  assert.equal(migasDeRuta(grupos, '/admin/planes/abc123').hoja, 'Detalle')
})

test('un dominio de un solo módulo no se repite a sí mismo', () => {
  // "Inicio / Resumen" está bien; "Inicio / Inicio" sería ruido.
  const m = migasDeRuta(navForRole('CLIENTE'), '/cliente/inicio')
  assert.equal(m.dominio, null)
  assert.equal(m.seccion?.label, 'Inicio')
})

test('una ruta fuera del menú no inventa migas', () => {
  const m = migasDeRuta(navForRole('ADMINISTRADOR'), '/ruta/que/no/existe')
  assert.deepEqual(m, { dominio: null, seccion: null, hoja: null })
})

test('toda ruta del menú resuelve a su propia sección', () => {
  for (const role of ROLES) {
    const grupos = navForRole(role)
    for (const link of allLinks(grupos)) {
      const m = migasDeRuta(grupos, link.href)
      assert.equal(
        m.seccion?.href,
        link.href,
        `${role}: ${link.href} no se resuelve a sí misma`
      )
    }
  }
})

// ── Suelo tipográfico ────────────────────────────────────────────────────

/**
 * GUARDIA DEL SUELO DE 12px (DS 2.0 · Fase 0).
 *
 * La auditoría contó 218 tamaños escritos a mano por debajo del suelo. No se
 * migran de una barrida —le toca a cada módulo en su fase—, así que esta
 * guardia NO exige cero: fija el número actual como techo. Si alguien añade
 * un `text-[10px]` nuevo, la prueba falla; según se saldan, se baja el techo.
 *
 * Es deuda que solo puede bajar.
 */
const RAICES = ['src', 'packages/ui/src']
const MICRO = /text-\[(\d+(?:\.\d+)?)px\]/g

/** Techo actual. Bajarlo conforme las fases vayan saldando la deuda. */
const TECHO_MICRO_TEXTOS = 193

function archivosTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) archivosTsx(ruta, acc)
    else if (ruta.endsWith('.tsx')) acc.push(ruta)
  }
  return acc
}

test('los textos por debajo de 12px no aumentan', () => {
  const infractores: string[] = []
  let total = 0

  for (const raiz of RAICES) {
    for (const archivo of archivosTsx(raiz)) {
      const src = readFileSync(archivo, 'utf8')
      for (const m of src.matchAll(MICRO)) {
        if (Number(m[1]) >= 12) continue
        total++
        infractores.push(`${archivo}: ${m[0]}`)
      }
    }
  }

  assert.ok(
    total <= TECHO_MICRO_TEXTOS,
    `Hay ${total} textos por debajo de 12px y el techo es ${TECHO_MICRO_TEXTOS}. ` +
      `Usa .text-caption (12.5px) o .text-overline (12px).\n` +
      infractores.slice(0, 10).join('\n')
  )
})

/**
 * GUARDIA DEL CONTENEDOR DE PÁGINA (DS 2.0 · Fase 1).
 *
 * `AppShell` ya envuelve el contenido en un `<main>` con el ancho máximo y el
 * padding del sistema. Una página que declara los suyos produce dos fallos a
 * la vez: `<main>` anidado —que es HTML inválido y confunde a los lectores de
 * pantalla, que buscan UN contenido principal— y doble padding, que la
 * desalinea del resto del producto.
 *
 * Igual que la guardia tipográfica: no exige cero, fija el número actual como
 * techo. Cada página lo salda en su fase.
 */
const TECHO_MAIN_ANIDADO = 5

test('las páginas del área cliente no anidan otro <main>', () => {
  const paginas = archivosTsx(join('src', 'app', '(cliente)')).filter((f) =>
    f.endsWith('page.tsx')
  )
  const infractoras = paginas.filter((f) => /<main[\s>]/.test(readFileSync(f, 'utf8')))

  assert.ok(
    infractoras.length <= TECHO_MAIN_ANIDADO,
    `${infractoras.length} páginas declaran su propio <main> dentro del de AppShell ` +
      `(techo ${TECHO_MAIN_ANIDADO}). El contenedor lo pone el shell.\n` +
      infractoras.join('\n')
  )
})

test('el shell global respeta el suelo tipográfico', () => {
  // El shell sí está migrado por completo: aquí la exigencia es cero.
  const archivos = archivosTsx(join('src', 'components', 'layout'))
  assert.ok(archivos.length > 0, 'no se encontraron archivos del shell')

  for (const archivo of archivos) {
    const src = readFileSync(archivo, 'utf8')
    for (const m of src.matchAll(MICRO)) {
      assert.ok(
        Number(m[1]) >= 12,
        `${archivo} usa ${m[0]}; el shell no puede bajar de 12px`
      )
    }
  }
})
