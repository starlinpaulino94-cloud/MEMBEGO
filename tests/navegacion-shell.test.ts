import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  navForRole,
  visibleWorkspaces,
  allLinks,
  breadcrumbs,
  type ContextoNav,
} from '../src/components/layout/nav-config'
import type { AppRole } from '../src/types'

/**
 * SHELL GLOBAL — navegación y suelo tipográfico (DS 2.0 · Fases 0 y 1;
 * DS 3.0 · navegación de dos niveles).
 *
 * POR QUÉ SE PRUEBA ESTO Y NO EL ASPECTO DE LAS PANTALLAS:
 *
 * Reagrupar un menú es la clase de cambio que rompe cosas en silencio. Una
 * ruta que se cae del menú no da error: simplemente deja de existir para quien
 * no se sepa la URL, y nadie lo nota hasta que un administrador pregunta dónde
 * fueron a parar sus comprobantes. Igual con las migas: si el espacio deja de
 * resolverse, la cabecera no falla, solo dice menos de lo que debería.
 *
 * Son funciones puras sobre datos estáticos, así que se verifican sin
 * navegador y sin base de datos — exactamente lo que uno rompería sin darse
 * cuenta al mover un módulo de espacio en una fase futura.
 *
 * Las reglas propias de los ESPACIOS (visibilidad por capacidad, vertical y
 * rol; prefijo más largo; espacios vacíos) viven en
 * `tests/navegacion-espacios.test.ts`. Aquí se comprueba que reagrupar en
 * espacios NO cambió el inventario ni el orden de los dominios.
 */

const ROLES: AppRole[] = [
  'ADMINISTRADOR',
  'CLIENTE',
  'SUPERADMIN',
  'EMPLEADO',
  'MARKETING',
  'SUPERVISOR',
]

const ctxDe = (role: AppRole): ContextoNav => ({ role })

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
  //
  // Se comprueba POR ESPACIO y no sobre la lista plana. El superadministrador
  // tiene los espacios de la plataforma y además «Panel de empresa», que NUNCA
  // se pintan juntos en el segundo nivel, y cada uno tiene su «Planes», su
  // «Membresías» y sus «Reportes». Exigir unicidad sobre la unión obligaría a
  // colgarles un «globales» que dentro de su propio espacio no distingue nada.
  //
  // El único sitio donde todos los espacios SÍ aparecen juntos es la paleta de
  // comandos, y eso lo cubre la prueba siguiente.
  for (const role of ROLES) {
    for (const espacio of visibleWorkspaces(ctxDe(role))) {
      const porEtiqueta = new Map<string, Set<string>>()
      for (const l of allLinks(espacio.groups)) {
        const set = porEtiqueta.get(l.label) ?? new Set()
        set.add(l.href)
        porEtiqueta.set(l.label, set)
      }
      for (const [label, hrefs] of porEtiqueta) {
        assert.equal(
          hrefs.size,
          1,
          `${role} · ${espacio.label}: "${label}" apunta a ${hrefs.size} rutas distintas (${[...hrefs].join(', ')})`
        )
      }
    }
  }
})

/**
 * Y CUANDO LOS ESPACIOS SE JUNTAN, ALGO TIENE QUE SEPARARLOS.
 *
 * La paleta de comandos es el único sitio que enseña todos los espacios a la
 * vez. Ahí sí conviven dos «Planes» que van a rutas distintas, y lo que los
 * distingue es el encabezado del grupo: la paleta lo compone como
 * «<espacio> · <grupo>» justo por esto.
 *
 * Esta prueba comprueba que ese encabezado compuesto es único, que es la
 * garantía de verdad: sin ella, aflojar la prueba de arriba habría dejado la
 * ambigüedad suelta en el único lugar donde importa.
 */
test('en la paleta, espacio + grupo + etiqueta identifica una sola ruta', () => {
  for (const role of ROLES) {
    const espacios = visibleWorkspaces(ctxDe(role))
    const varios = espacios.length > 1
    const porClave = new Map<string, Set<string>>()
    for (const espacio of espacios) {
      for (const g of espacio.groups) {
        const heading = varios ? `${espacio.label} · ${g.label}` : g.label
        for (const item of g.items) {
          const clave = `${heading} → ${item.label}`
          const set = porClave.get(clave) ?? new Set()
          set.add(item.href)
          porClave.set(clave, set)
        }
      }
    }
    for (const [clave, hrefs] of porClave) {
      assert.equal(hrefs.size, 1, `${role}: "${clave}" lleva a ${[...hrefs].join(', ')}`)
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

test('el panel de administrador siguen siendo nueve dominios', () => {
  // Esta prueba existía antes de los espacios y NO se relaja: es justamente la
  // garantía de que reagrupar dominios en espacios no movió módulos ni cambió
  // el inventario. Los nueve dominios siguen siendo los mismos y en el mismo
  // orden; lo único nuevo es cómo se reparten en el riel.
  const grupos = navForRole('ADMINISTRADOR')
  assert.equal(grupos.length, 9)
  assert.deepEqual(
    grupos.map((g) => g.label),
    ['Inicio', 'Clientes', 'Parques y Tours', 'Beneficios', 'Marketing', 'Operaciones', 'Analítica', 'Empresa', 'Soporte']
  )
})

test('los espacios cubren toda la navegación de su rol', () => {
  // El riel reparte los módulos entre espacios; no puede perder ninguno por el
  // camino. Es el sustituto exacto de la prueba que cubría los dos contextos
  // del superadministrador.
  for (const role of ROLES) {
    const plano = new Set(allLinks(navForRole(role)).map((l) => l.href))
    const enEspacios = new Set(
      visibleWorkspaces(ctxDe(role)).flatMap((e) => allLinks(e.groups).map((l) => l.href))
    )
    assert.deepEqual(
      [...plano].sort(),
      [...enEspacios].sort(),
      `${role}: la lista plana y los espacios no contienen lo mismo`
    )
  }
})

// ── Migas ────────────────────────────────────────────────────────────────

test('las migas nombran el espacio, no solo la página', () => {
  const m = breadcrumbs('/admin/campanas', ctxDe('ADMINISTRADOR'))
  assert.deepEqual(
    m.map((x) => x.label),
    ['Crecimiento', 'Marketing', 'Campañas']
  )
  // La primera miga es un enlace al aterrizaje del espacio: volver deja de
  // exigir un viaje por el menú.
  assert.equal(m[0].href, '/admin/planes')
  // La última es la página actual: no se enlaza a sí misma.
  assert.equal(m[m.length - 1].href, undefined)
})

test('gana el href más largo, no el primero que casa por prefijo', () => {
  // /admin/audiencia/segmentos casa TAMBIÉN con /admin/audiencia. Si ganara el
  // prefijo corto, las migas dirían "Audiencia" estando en otra pantalla.
  const m = breadcrumbs('/admin/audiencia/segmentos', ctxDe('ADMINISTRADOR'))
  assert.equal(m[m.length - 1].label, 'Segmentos')
})

test('una subvista fuera del menú hereda la miga de su sección', () => {
  // /admin/audiencia/campanas ya no está en el menú: su navegación son las
  // pestañas de Audiencia. Las migas deben decir "Audiencia", no quedarse en
  // blanco ni inventar un nombre.
  const m = breadcrumbs('/admin/audiencia/campanas', ctxDe('ADMINISTRADOR'))
  const etiquetas = m.map((x) => x.label)
  assert.ok(etiquetas.includes('Audiencia'), `no menciona Audiencia: ${etiquetas.join(' / ')}`)
  assert.equal(etiquetas[0], 'Analítica')
})

test('las subpáginas se nombran en vez de quedar como "Detalle"', () => {
  const ctx = ctxDe('ADMINISTRADOR')
  const hoja = (p: string) => breadcrumbs(p, ctx).at(-1)?.label
  assert.equal(hoja('/admin/planes/nuevo'), 'Nuevo')
  assert.equal(hoja('/admin/planes/abc123/editar'), 'Editar')
  // Un id suelto no tiene nombre legible: "Detalle" es lo honesto.
  assert.equal(hoja('/admin/planes/abc123'), 'Detalle')
})

test('un espacio de un solo módulo no se repite a sí mismo', () => {
  // "Inicio / Inicio" sería ruido; el home del cliente es el inicio.
  const m = breadcrumbs('/cliente/inicio', ctxDe('CLIENTE'))
  assert.deepEqual(
    m.map((x) => x.label),
    ['Inicio']
  )
})

test('una ruta fuera del menú no inventa migas', () => {
  assert.deepEqual(breadcrumbs('/ruta/que/no/existe', ctxDe('ADMINISTRADOR')), [])
})

test('toda ruta del menú resuelve a su propio módulo', () => {
  for (const role of ROLES) {
    const ctx = ctxDe(role)
    for (const espacio of visibleWorkspaces(ctx)) {
      for (const link of allLinks(espacio.groups)) {
        const m = breadcrumbs(link.href, ctx)
        assert.equal(
          m.at(-1)?.label,
          link.label,
          `${role}: ${link.href} no se resuelve a sí misma (${m.map((x) => x.label).join(' / ')})`
        )
      }
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

/**
 * Techo actual. Bajarlo conforme las fases vayan saldando la deuda.
 *
 * 218 en la Fase 0 · 193 tras la Fase 13 · 186 tras la Fase 16, que dejó el
 * área de superadministrador a cero · 185 al cerrar los acentos de `--info` ·
 * 169 tras la Fase 17, que dejó a cero el área del empleado — la que más
 * tenía y la que peor se lee (de pie, con el cliente delante) · 163 tras la
 * Fase 18, con la web pública también a cero · 160 tras la Fase 20, que se
 * llevó por delante los que vivían en componentes huérfanos.
 */
const TECHO_MICRO_TEXTOS = 271

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
