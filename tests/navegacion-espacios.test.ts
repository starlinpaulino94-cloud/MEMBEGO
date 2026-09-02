import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canSeeItem,
  canSeeWorkspace,
  rankOf,
  resolverRuta,
  visibleGroups,
  visibleWorkspaces,
  workspaceLanding,
  workspaceOf,
  workspacesForRole,
  buscarModulos,
  CLAVES_BADGE,
  type CapacidadNav,
  type ContextoNav,
  type TipoEmpresaNav,
} from '../src/components/layout/nav-config'
import { CAPACIDADES, CATEGORIAS } from '../src/modules/capacidades/catalogo'
import type { AppRole } from '../src/types'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA NAVEGACIÓN DE DOS NIVELES — reglas que no se ven hasta que fallan.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Un menú de espacios tiene tres formas conocidas de romperse, y ninguna da
 * error:
 *
 *  1. Un icono del riel que abre un panel VACÍO. Quien lo ve no piensa «no
 *     tengo permiso», piensa «esto está roto».
 *  2. Un espacio que resuelve mal por prefijo, así que el menú resalta un
 *     módulo y la cabecera dice otro.
 *  3. Un módulo apagado por capacidad que sigue ofreciéndose: se pulsa y la
 *     autorización lo echa. El menú prometió una puerta cerrada.
 *
 * Las tres se prueban aquí, sin navegador y sin base de datos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y UNA ADVERTENCIA QUE VALE PARA TODO EL ARCHIVO
 *
 * NADA de esto prueba autorización. Que un módulo no se OFREZCA no significa
 * que no se pueda abrir escribiendo la URL: eso lo impiden `requireRole` y
 * `requireSection`, que siguen intactos y tienen sus propias pruebas
 * (`tests/accesos.test.ts`, `tests/permisos-empleado.test.ts`). Aquí solo se
 * verifica qué se ofrece.
 */

const ADMIN: AppRole = 'ADMINISTRADOR'
const ctx = (extra: Partial<ContextoNav> = {}): ContextoNav => ({ role: ADMIN, ...extra })

// ── Sincronía con el catálogo real ──────────────────────────────────────────

/**
 * La configuración del menú declara capacidades y verticales como uniones de
 * TEXTO, para no arrastrar el catálogo (469 líneas de datos) al paquete que
 * descarga el navegador. El precio de esa decisión es que pueden separarse del
 * catálogo sin que nada avise. Esto es lo que avisa.
 */
test('las capacidades del menú existen en el catálogo real', () => {
  const delMenu: CapacidadNav[] = ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES', 'POS_CAJA']
  for (const cap of delMenu) {
    assert.ok(
      (CAPACIDADES as readonly string[]).includes(cap),
      `«${cap}» está en la navegación y NO en el catálogo de capacidades. ` +
        'El menú filtraría por algo que el resolutor nunca enciende.'
    )
  }
})

test('los verticales del menú son los del catálogo real', () => {
  const delMenu: TipoEmpresaNav[] = ['CAR_WASH', 'BARBERIA', 'RESTAURANTE', 'GYM', 'EXCURSIONES']
  assert.deepEqual([...delMenu].sort(), [...CATEGORIAS].sort())
})

test('toda clave de contador declarada la usa algún módulo', () => {
  const usadas = new Set<string>()
  for (const role of ['ADMINISTRADOR', 'SUPERADMIN', 'CLIENTE', 'EMPLEADO'] as AppRole[]) {
    for (const w of workspacesForRole(role)) {
      for (const g of w.groups) for (const i of g.items) if (i.badge) usadas.add(i.badge)
    }
  }
  for (const clave of CLAVES_BADGE) {
    assert.ok(usadas.has(clave), `la clave de contador «${clave}» no la pide ningún módulo`)
  }
})

// ── Rangos ──────────────────────────────────────────────────────────────────

test('el rango ordena de plataforma a cliente', () => {
  assert.ok(rankOf('SUPERADMIN') > rankOf('ADMINISTRADOR'))
  assert.ok(rankOf('ADMINISTRADOR') > rankOf('EMPLEADO'))
  assert.ok(rankOf('EMPLEADO') > rankOf('CLIENTE'))
  // El rol heredado es el MISMO rol con el nombre viejo: darle otro rango
  // habría hecho que las empresas antiguas perdieran módulos sin que nadie
  // cambiara nada.
  assert.equal(rankOf('ADMIN_EMPRESA'), rankOf('ADMINISTRADOR'))
})

// ── Visibilidad por CAPACIDAD ───────────────────────────────────────────────

const rutasDe = (c: ContextoNav) =>
  visibleWorkspaces(c).flatMap((w) => w.groups.flatMap((g) => g.items.map((i) => i.href)))

test('sin la capacidad CITAS, el módulo Citas no se ofrece', () => {
  const conTodo = ctx({ capacidades: ['CITAS', 'SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] })
  const sinCitas = ctx({ capacidades: ['SEGUIMIENTO', 'RULETA', 'EXCURSIONES'] })

  assert.ok(rutasDe(conTodo).includes('/admin/citas'))
  assert.ok(
    !rutasDe(sinCitas).includes('/admin/citas'),
    'El menú ofrecía «Citas» a una empresa que no la tiene contratada. Se ' +
      'pulsa, `requireSection` la niega, y quien la pulsó no entiende por qué.'
  )
})

test('sin capacidades legibles NO se filtra nada (fail-open)', () => {
  // Es la misma regla del resolutor del servidor: una empresa viva no puede
  // perder módulos de su menú porque una consulta falló. Y no abre ninguna
  // puerta — quien pulse un módulo apagado se encuentra `requireSection`.
  const rutas = rutasDe(ctx())
  assert.ok(rutas.includes('/admin/citas'))
  assert.ok(rutas.includes('/admin/gamificacion'))
  assert.ok(rutas.includes('/admin/seguimiento'))
})

test('el espacio entero desaparece cuando su capacidad está apagada', () => {
  const con = visibleWorkspaces(ctx({ capacidades: ['EXCURSIONES'] })).map((w) => w.id)
  const sin = visibleWorkspaces(ctx({ capacidades: [] })).map((w) => w.id)
  assert.ok(con.includes('experiencias'))
  assert.ok(
    !sin.includes('experiencias'),
    'Un icono en el riel que abre un panel vacío se lee como una aplicación rota.'
  )
})

// ── Visibilidad por TIPO DE EMPRESA ─────────────────────────────────────────

test('«Mis vehículos» solo se ofrece en un car wash', () => {
  const carWash: ContextoNav = { role: 'CLIENTE', tipoEmpresa: 'CAR_WASH' }
  const barberia: ContextoNav = { role: 'CLIENTE', tipoEmpresa: 'BARBERIA' }
  assert.ok(rutasDe(carWash).includes('/cliente/vehiculos'))
  assert.ok(
    !rutasDe(barberia).includes('/cliente/vehiculos'),
    'Pedirle la placa del carro al cliente de una barbería es el mismo fallo ' +
      'que ya se corrigió en el registro.'
  )
})

test('sin vertical conocido tampoco se filtra por tipo', () => {
  assert.ok(rutasDe({ role: 'CLIENTE' }).includes('/cliente/vehiculos'))
})

// ── Visibilidad por ROL y por PERMISOS ──────────────────────────────────────

test('un rol acotado solo ve sus secciones', () => {
  const marketing = rutasDe({ role: 'MARKETING' })
  assert.ok(marketing.includes('/admin/campanas'), 'Marketing tiene que ver Campañas')
  assert.ok(
    !marketing.includes('/admin/empleados'),
    'Marketing no administra el equipo: no se le ofrece.'
  )
  const supervisor = rutasDe({ role: 'SUPERVISOR' })
  assert.ok(supervisor.includes('/admin/reportes'))
  assert.ok(!supervisor.includes('/admin/campanas'))
})

test('un espacio sin ni un módulo visible no se pinta', () => {
  // A Marketing no le corresponde ninguna sección del dominio «Empresa», así
  // que su espacio de Configuración no debe aparecer en el riel.
  const espacios = visibleWorkspaces({ role: 'MARKETING' })
  const empresa = workspacesForRole('MARKETING').find((w) => w.id === 'empresa')!
  assert.equal(visibleGroups(empresa, { role: 'MARKETING' }).length, 0)
  assert.ok(!espacios.some((w) => w.id === 'empresa'))
  assert.equal(canSeeWorkspace(empresa, { role: 'MARKETING' }), false)
})

test('los ajustes por empleado quitan el módulo del menú', () => {
  const permisos = { v: 1 as const, secciones: { pagos: false } }
  const conAjuste = rutasDe({ role: ADMIN, permisos })
  assert.ok(!conAjuste.includes('/admin/pagos'))
  // Y lo que NO se tocó sigue estando: tanto un módulo con sección propia…
  assert.ok(conAjuste.includes('/admin/registros'))
  // …como los dos que NO mapean a ninguna (/admin/crm y /admin/facturas). Es
  // el caso que esta prueba encontró: al aplicar los ajustes se les negaba por
  // no tener sección, y desaparecían del menú de quien nunca los tocó.
  assert.ok(conAjuste.includes('/admin/facturas'))
  assert.ok(conAjuste.includes('/admin/crm'))
})

test('las rutas ocultas por el contexto desaparecen de todas partes', () => {
  const c = ctx({ ocultas: ['/admin/regalos'] })
  assert.ok(!rutasDe(c).includes('/admin/regalos'))
  // Ojo con lo que se afirma: «regalos» sigue devolviendo «Ofertas», porque su
  // descripción menciona los regalos VIP y eso es un acierto del buscador. Lo
  // que no puede devolver es el módulo OCULTO.
  assert.ok(
    !buscarModulos('regalos', c).some((r) => r.item.href === '/admin/regalos'),
    'el buscador ofreció una ruta que el menú esconde'
  )
})

test('canSeeItem no depende del orden en que se pregunte', () => {
  const item = workspacesForRole(ADMIN)
    .flatMap((w) => w.groups)
    .flatMap((g) => g.items)
    .find((i) => i.href === '/admin/citas')!
  assert.equal(canSeeItem(item, ctx({ capacidades: ['CITAS'] })), true)
  assert.equal(canSeeItem(item, ctx({ capacidades: [] })), false)
})

// ── Resolución por PREFIJO MÁS LARGO ────────────────────────────────────────

test('el espacio de una ruta se resuelve por el prefijo más largo', () => {
  const c = ctx()
  // /admin/audiencia/segmentos casa con DOS módulos: «Audiencia» (Analítica)
  // y «Segmentos» (Clientes). Gana el prefijo largo, y con él su espacio.
  assert.equal(workspaceOf('/admin/audiencia', c), 'analitica')
  assert.equal(workspaceOf('/admin/audiencia/segmentos', c), 'clientes')
  assert.equal(resolverRuta('/admin/audiencia/segmentos', c)?.href, '/admin/audiencia/segmentos')
})

test('un enlace profundo conserva su módulo activo', () => {
  const c = ctx()
  assert.equal(resolverRuta('/admin/planes/abc123/editar', c)?.href, '/admin/planes')
  assert.equal(
    resolverRuta('/admin/integraciones/desarrolladores/webhooks', c)?.href,
    '/admin/integraciones'
  )
})

test('un prefijo histórico también resuelve su módulo', () => {
  // El QR de una membresía vive en /membresia/<id>, fuera del árbol del
  // módulo. Sin el prefijo declarado, la pantalla que más se abre no marcaba
  // nada activo en el menú.
  const c: ContextoNav = { role: 'CLIENTE' }
  const r = resolverRuta('/membresia/abc123', c)
  assert.equal(r?.href, '/mis-membresias')
  assert.equal(r?.workspaceId, 'mi-membego')
})

test('un prefijo no casa a medias', () => {
  // /admin/planeswhatever NO es /admin/planes. Casar por `startsWith` pelado
  // marcaría activo un módulo que no tiene nada que ver.
  assert.equal(resolverRuta('/admin/planeswhatever', ctx()), null)
})

test('una ruta fuera de todo menú no resuelve espacio', () => {
  assert.equal(workspaceOf('/admin/nada-de-esto', ctx()), null)
})

// ── Aterrizaje de cada espacio ──────────────────────────────────────────────

test('cada espacio visible tiene un aterrizaje que su dueño puede abrir', () => {
  for (const role of ['ADMINISTRADOR', 'SUPERADMIN', 'CLIENTE', 'EMPLEADO', 'MARKETING', 'SUPERVISOR'] as AppRole[]) {
    const c: ContextoNav = { role }
    for (const espacio of visibleWorkspaces(c)) {
      const destino = workspaceLanding(espacio, c)
      assert.ok(destino, `${role} · ${espacio.label}: el icono del riel no lleva a ningún sitio`)
      // Y ese destino tiene que ser uno de SUS módulos visibles, no cualquiera.
      assert.ok(
        rutasDe(c).includes(destino!),
        `${role} · ${espacio.label}: aterriza en ${destino}, que no se le ofrece`
      )
    }
  }
})

test('el aterrizaje es el módulo marcado como principal', () => {
  const c = ctx()
  const operaciones = visibleWorkspaces(c).find((w) => w.id === 'operaciones')!
  assert.equal(workspaceLanding(operaciones, c), '/admin/scanner')
})

test('sin el principal, el aterrizaje cae al primer módulo que quede', () => {
  // A un supervisor «Escanear QR» sí se le ofrece; a Marketing, el espacio de
  // Operaciones no le queda con nada. Se prueba con una negación puntual.
  const c = ctx({ permisos: { v: 1 as const, secciones: { scanner: false } } })
  const operaciones = visibleWorkspaces(c).find((w) => w.id === 'operaciones')!
  assert.equal(workspaceLanding(operaciones, c), '/admin/pagos')
})

// ── Buscador ────────────────────────────────────────────────────────────────

test('el buscador entiende lo que la gente escribe, no solo la etiqueta', () => {
  const c = ctx()
  // «canjear» no aparece en ninguna etiqueta del menú.
  assert.equal(buscarModulos('canjear', c)[0]?.item.href, '/admin/scanner')
  // Y las tildes no pueden ser un requisito para encontrar nada.
  assert.equal(buscarModulos('analitica', c)[0]?.workspace.id, 'analitica')
})

test('el buscador nunca ofrece lo que el menú esconde', () => {
  const sinCitas = ctx({ capacidades: [] })
  assert.deepEqual(
    buscarModulos('citas', sinCitas).map((r) => r.item.href),
    []
  )
})

// ── Contrato del shell (lo que no se puede probar sin navegador) ────────────

/**
 * GUARDIAS DE ESTRUCTURA.
 *
 * Lo que sigue NO prueba comportamiento: lee el código y comprueba que ciertas
 * decisiones siguen escritas. Se hace así porque el comportamiento real
 * —scroll, sticky, foco, hidratación— necesita un navegador con sesión, y este
 * proyecto no puede autenticarse en pruebas automáticas (docs/PRUEBAS-E2E.md).
 *
 * Son decisiones que se deshacen SOLAS al refactorizar, y cuyo síntoma aparece
 * en la pantalla de alguien y no en la suite. Vale más una guardia literal que
 * ninguna guardia. Cada una dice qué rompe si desaparece.
 */
/**
 * Se leen los archivos SIN COMENTARIOS. Sin esto, una guardia que prohíbe
 * `overflow-x-hidden` falla por encontrar el texto del comentario que explica
 * por qué está prohibido — pasó al escribir esta misma prueba.
 */
const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('la raíz del shell usa overflow-x-clip y no overflow-x-hidden', () => {
  const src = leer('src/components/layout/AppShell.tsx')
  assert.ok(
    src.includes('overflow-x-clip'),
    'Sin recorte horizontal, una tabla ancha saca la barra de scroll de toda la página.'
  )
  assert.ok(
    !/overflow-x-hidden/.test(src),
    '`overflow-x-hidden` convierte la raíz en contenedor de scroll y eso ROMPE ' +
      'el `sticky` del menú: se despega y sube con la página. `clip` recorta ' +
      'sin crear contenedor.'
  )
})

test('el menú de escritorio es sticky, a pantalla completa y sin estirarse', () => {
  const src = leer('src/components/layout/AppShell.tsx')
  for (const clase of ['sticky', 'top-0', 'h-screen', 'self-start']) {
    assert.ok(
      new RegExp(`\\b${clase}\\b`).test(src),
      `falta \`${clase}\` en el menú. Sin \`self-start\` el hijo de flex se ` +
        'estira a la altura de TODA la página y `sticky` no tiene contra qué ' +
        'pegarse: el menú deja de quedarse quieto.'
    )
  }
})

test('todo scroll interno del menú lleva min-h-0', () => {
  // Sin `min-h-0`, un hijo flexible no baja de su altura de contenido (el
  // mínimo automático de flexbox): la lista empuja la columna en vez de hacer
  // scroll y el pie —perfil, Configuración, plegar— se sale del viewport.
  for (const archivo of [
    'src/components/layout/NavPanel.tsx',
    'src/components/layout/NavRail.tsx',
  ]) {
    const src = leer(archivo)
    const scrollers = src.match(/className="[^"]*overflow-y-auto[^"]*"/g) ?? []
    assert.ok(scrollers.length > 0, `${archivo} ya no tiene ningún contenedor con scroll`)
    for (const clase of scrollers) {
      assert.ok(
        clase.includes('min-h-0'),
        `${archivo}: \`${clase}\` hace scroll y no lleva \`min-h-0\`. ` +
          'El síntoma es el pie del menú cortado en una pantalla baja.'
      )
    }
  }
})

test('el pie del riel vive fuera del contenedor con scroll', () => {
  const src = leer('src/components/layout/NavRail.tsx')
  const nav = src.indexOf('overflow-y-auto')
  const pie = src.indexOf('border-t border-sidebar-border')
  assert.ok(nav > 0 && pie > nav, 'el pie del riel debe ir DESPUÉS del <nav> con scroll')
  assert.ok(
    /shrink-0[^"]*border-t border-sidebar-border|border-t border-sidebar-border[^"]*shrink-0/.test(src),
    'el pie tiene que ser `shrink-0`: si encoge, Configuración y el perfil se ' +
      'comen a sí mismos antes que ceder espacio la lista.'
  )
})

test('el modo compacto se guarda y se aplica antes de pintar', () => {
  const src = leer('src/components/layout/AppShell.tsx')
  assert.ok(src.includes('membego.nav.compacto.v1'), 'la preferencia dejó de persistirse')
  assert.ok(src.includes('localStorage.setItem'), 'no se escribe la preferencia')
  assert.ok(
    // En el código el atributo se escribe como propiedad del DOM
    // (`dataset.navCompacto`); en el CSS, como selector (`data-nav-compacto`).
    src.includes('dataset.navCompacto') && src.includes('dangerouslySetInnerHTML'),
    'sin el script previo al pintado, quien tiene el menú plegado ve el panel ' +
      'ancho un instante y encogerse: el mismo parpadeo del tema claro/oscuro.'
  )
  assert.ok(
    leer('src/app/globals.css').includes("html[data-nav-compacto='1'] [data-nav-panel]"),
    'falta la regla CSS que aplica el modo compacto antes de hidratar'
  )
})

test('el flyout del modo compacto responde también al teclado', () => {
  const src = leer('src/components/layout/NavRail.tsx')
  assert.ok(src.includes('onMouseEnter'), 'falta la apertura por cursor')
  assert.ok(
    src.includes('onFocus') && src.includes('onBlur'),
    'Solo con hover, quien navega con teclado se queda con iconos mudos: ' +
      'plegado el menú, no hay forma de saber qué hay dentro de un espacio.'
  )
  assert.ok(src.includes("=== 'Escape'"), 'Escape tiene que cerrar el flyout')
})

test('el cajón móvil reutiliza la MISMA navegación del escritorio', () => {
  const src = leer('src/components/layout/AppShell.tsx')
  const montajes = src.match(/<AppSidebar/g) ?? []
  assert.equal(
    montajes.length,
    2,
    'El cajón móvil y el menú de escritorio tienen que montar el mismo ' +
      'componente. Una segunda lista de módulos escrita a mano se queda atrás ' +
      'en cuanto alguien añade uno.'
  )
  assert.ok(src.includes('<Sheet'), 'el cajón usa el Sheet del sistema de diseño')
  assert.ok(
    // El cajón está abierto mientras la ruta desde la que se abrió siga siendo
    // la actual: al llegar a otra, se cierra solo. Derivarlo así —y no
    // sincronizarlo con un efecto— es lo que impide que los dos datos
    // discrepen durante un render.
    src.includes('abiertoEn === pathname'),
    'el cajón tiene que cerrarse al CAMBIAR de ruta (no en el clic): así ' +
      'también se cierra si la navegación viene de las migas, y nunca antes ' +
      'de tiempo si falla.'
  )
})

test('un contador que falta no rompe ni pinta un cero inventado', () => {
  const src = leer('src/components/layout/NavPanel.tsx')
  assert.ok(
    /contador > 0/.test(src),
    'Un «0» no es información: es ruido con forma de aviso, y entrena a no ' +
      'mirar el sitio donde de verdad aparece un número.'
  )
  const badges = leer('src/modules/navegacion/badges.ts')
  assert.ok(
    badges.includes('allSettled'),
    'los contadores tienen que resolverse por separado: uno que falla no ' +
      'puede llevarse por delante a los demás ni al menú'
  )
  assert.ok(
    /status !== 'fulfilled'/.test(badges),
    'un conteo fallido debe quedarse FUERA del resultado, no volverse cero'
  )
})

test('ningún componente del shell decide visibilidad por rol a mano', () => {
  // Es la regla que sostiene todo lo demás: si la visibilidad vuelve a los
  // `.tsx`, deja de poder probarse en este archivo.
  const CONDICIONAL = /role\s*===\s*'(SUPERADMIN|ADMINISTRADOR|GERENTE|CAJERO|MARKETING|SUPERVISOR|EMPLEADO|RECEPCION)'/
  for (const archivo of [
    'src/components/layout/AppShell.tsx',
    'src/components/layout/AppSidebar.tsx',
    'src/components/layout/NavRail.tsx',
    'src/components/layout/NavPanel.tsx',
    'src/components/layout/AppHeader.tsx',
    'src/components/layout/CommandPalette.tsx',
  ]) {
    assert.ok(
      !CONDICIONAL.test(leer(archivo)),
      `${archivo} decide visibilidad por rol a mano. Eso va en nav-config, ` +
        'donde se puede probar.'
    )
  }
})
