import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIAS_INACTIVO,
  fichasDeFiltro,
  hayFiltro,
  hrefPagina,
  leerFiltroUsuarios,
  ROLES_FILTRABLES,
  ROL_FILTRO_LABEL,
} from '../src/modules/usuarios/filtros'
import { ROL_LABEL, ROL_STAFF_LABEL } from '../src/types'

/**
 * CONTROL DE ACCESOS DE LA PLATAFORMA.
 *
 * Esta pantalla no es de gestión: decide quién entra a qué y quién puede
 * suplantar a quién. Las guardias van en ese orden — primero lo que protege un
 * privilegio, después lo que ordena la pantalla.
 */

const BASE = '/superadmin/usuarios'
const PAGE = readFileSync(join('src', 'app', '(superadmin)', 'superadmin', 'usuarios', 'page.tsx'), 'utf8')
const FICHA = readFileSync(
  join('src', 'app', '(superadmin)', 'superadmin', 'usuarios', '[id]', 'page.tsx'),
  'utf8'
)
const ACTIONS = readFileSync(join('src', 'modules', 'superadmin', 'usuariosActions.ts'), 'utf8')
const LISTA = readFileSync(join('src', 'modules', 'usuarios', 'lista.ts'), 'utf8')
const TARJETA = readFileSync(join('src', 'components', 'superadmin', 'EmpresasDeUsuario.tsx'), 'utf8')

// ───────────────────────────── PRIVILEGIO ─────────────────────────────

/**
 * EL RANGO NO PASA POR EL FORMULARIO DE LA FICHA.
 *
 * Abrir la ficha de un superadmin (M42) tiene un filo: si la acción aceptara el
 * campo `role` que llega en el formulario, cualquiera con acceso a la ficha
 * podría otorgarse el rango saltándose `alternarSuperadmin` —su confirmación y
 * su regla de no tocarse a uno mismo—. La pantalla oculta el desplegable, pero
 * una pantalla que oculta un campo no impide que el campo se envíe desde otra
 * pestaña. La negativa tiene que estar en el servidor.
 */
test('a un superadmin se le conserva el rango, venga lo que venga en el formulario', () => {
  assert.match(
    ACTIONS,
    /const role: AppRole = esSuperadmin \? 'SUPERADMIN' : rolEnviado/,
    'el rol de un superadmin se conserva; no se lee de `formData`'
  )
  assert.match(
    ACTIONS,
    /const esSuperadmin = target\.role === 'SUPERADMIN'/,
    'y se decide por lo que dice la BASE, no por lo que diga el formulario'
  )
})

test('los clientes siguen sin poder editarse desde el panel de plataforma', () => {
  assert.match(ACTIONS, /target\.role === 'CLIENTE'/)
  assert.match(FICHA, /usuario\.role === 'CLIENTE'/)
})

test('la ficha de un superadmin ya no devuelve 404', () => {
  // Era la causa de tener que entrar en la base de datos para corregir un
  // nombre. Lo que se protege es el rango, no la ficha.
  const bloque = FICHA.slice(FICHA.indexOf('notFound') - 400, FICHA.indexOf('notFound') + 40)
  assert.ok(
    !/role === 'SUPERADMIN'/.test(bloque),
    'la ficha no puede volver a bloquearse por ser superadmin'
  )
})

// ───────────────────────────── FILTROS (puros) ─────────────────────────────

test('sin parámetros, la lista sale entera y ordenada por nombre', () => {
  const f = leerFiltroUsuarios({})
  assert.deepEqual(f, {
    q: '',
    rol: 'todos',
    empresa: null,
    inactivos: false,
    orden: 'nombre',
    pagina: 1,
  })
  assert.equal(hayFiltro(f), false)
})

test('un valor inventado en la URL no rompe nada: se ignora', () => {
  // La URL la escribe cualquiera. Un `rol=DIOS` tiene que degradar al valor por
  // defecto, no llegar al `where` de Prisma.
  const f = leerFiltroUsuarios({ rol: 'DIOS', orden: 'porque-sí', pagina: '-4' })
  assert.equal(f.rol, 'todos')
  assert.equal(f.orden, 'nombre')
  assert.equal(f.pagina, 1)
})

test('«todas» y la cadena vacía significan lo mismo en empresa: sin filtro', () => {
  // Una llega del `<select>` reseteado y la otra de un enlace escrito a mano.
  assert.equal(leerFiltroUsuarios({ empresa: 'todas' }).empresa, null)
  assert.equal(leerFiltroUsuarios({ empresa: '' }).empresa, null)
  assert.equal(leerFiltroUsuarios({ empresa: 'cmp_1' }).empresa, 'cmp_1')
})

test('«solo superadmins» es una pregunta que ahora se puede hacer', () => {
  const f = leerFiltroUsuarios({ rol: 'SUPERADMIN' })
  assert.equal(f.rol, 'SUPERADMIN')
  assert.equal(hayFiltro(f), true)
})

/**
 * QUITAR UN FILTRO NO PUEDE LLEVARSE LOS DEMÁS.
 *
 * Es el error clásico de construir esos enlaces a mano en el JSX, y es
 * silencioso: la lista se ensancha y parece que el filtro «no funcionó».
 */
test('cada ficha quita SOLO su filtro', () => {
  const f = leerFiltroUsuarios({
    q: 'ana',
    rol: 'ADMINISTRADOR',
    empresa: 'cmp_1',
    inactivos: '1',
    pagina: '3',
  })
  const fichas = fichasDeFiltro(f, BASE, [{ id: 'cmp_1', name: 'CARTOWN' }])
  assert.deepEqual(
    fichas.map((x) => x.clave),
    ['q', 'rol', 'empresa', 'inactivos']
  )

  const quitarRol = fichas.find((x) => x.clave === 'rol')!.quitarHref
  assert.ok(quitarRol.includes('q=ana'), 'la búsqueda se conserva')
  assert.ok(quitarRol.includes('empresa=cmp_1'), 'la empresa se conserva')
  assert.ok(quitarRol.includes('inactivos=1'), 'el filtro de inactividad se conserva')
  assert.ok(!quitarRol.includes('rol='), 'y el rol es lo único que se va')

  // Y se vuelve a la primera página: quedarse en la 3 de una lista que ahora
  // tiene una sola es la forma más rápida de ver «sin resultados» por error.
  assert.ok(!quitarRol.includes('pagina='), 'quitar un filtro vuelve a la página 1')
})

test('la ficha de empresa dice el NOMBRE, no el id', () => {
  const f = leerFiltroUsuarios({ empresa: 'cmp_1' })
  const [ficha] = fichasDeFiltro(f, BASE, [{ id: 'cmp_1', name: 'CARTOWN' }])
  assert.equal(ficha.texto, 'CARTOWN')
})

test('paginar conserva los filtros', () => {
  const f = leerFiltroUsuarios({ q: 'ana', rol: 'SUPERADMIN' })
  const url = hrefPagina(f, BASE, 2)
  assert.ok(url.includes('q=ana') && url.includes('rol=SUPERADMIN') && url.includes('pagina=2'))
  // La página 1 no se escribe: la URL limpia es la canónica.
  assert.ok(!hrefPagina(f, BASE, 1).includes('pagina='))
})

// ───────────────────── UN SOLO MAPA DE ROLES (M41) ─────────────────────

test('la pantalla no lleva su propia copia del mapa de roles', () => {
  // Era la tercera copia local en este panel: `ROL_STAFF_LABEL` más dos
  // entradas escritas a mano en el archivo de la página.
  assert.ok(
    !/const ROL_LABEL/.test(PAGE),
    'usa `ROL_LABEL` de @/types; no declares otro mapa aquí'
  )
  assert.match(PAGE, /import \{ ROL_LABEL \} from '@\/types'/)
})

test('el mapa canónico se construye SOBRE el de staff, no repitiéndolo', () => {
  for (const [clave, texto] of Object.entries(ROL_STAFF_LABEL)) {
    assert.equal(ROL_LABEL[clave], texto, `${clave} dice cosas distintas en los dos mapas`)
  }
  assert.equal(ROL_LABEL.SUPERADMIN, 'Superadmin')
})

test('todo rol filtrable tiene etiqueta', () => {
  for (const r of ROLES_FILTRABLES) {
    assert.ok(ROL_FILTRO_LABEL[r], `${r} saldría en crudo en el desplegable`)
  }
})

// ───────────────────── LA PANTALLA (M39, M40, M43, M44) ─────────────────────

test('el filtrado ocurre en el servidor, no en el navegador', () => {
  assert.match(PAGE, /listarUsuarios\(f\)/)
  assert.match(PAGE, /leerFiltroUsuarios\(await searchParams\)/)
})

test('la lista filtra por la empresa activa Y por los accesos extra', () => {
  // La tarjeta enseña las dos; filtrar solo por una haría desaparecer a un
  // usuario visible «con» esa empresa justo al filtrar por ella.
  const bloque = LISTA.slice(LISTA.indexOf('if (f.empresa)'), LISTA.indexOf('if (f.empresa)') + 500)
  assert.match(bloque, /companyId: f\.empresa/)
  assert.match(bloque, /empresasAcceso: \{ some: \{ companyId: f\.empresa \} \}/)
})

test('«sin actividad» se resuelve en la base, no trayendo a todo el mundo', () => {
  assert.match(LISTA, /auditLogs: \{ none: \{ createdAt: \{ gte: corte \} \} \}/)
  assert.ok(DIAS_INACTIVO >= 30, 'un umbral corto marcaría como sobrante a medio equipo')
})

test('la última actividad se pide solo de los que se van a pintar', () => {
  assert.match(LISTA, /where: \{ userId: \{ in: ids \} \}/)
  assert.match(LISTA, /_max: \{ createdAt: true \}/)
})

/**
 * Y NO SE LLAMA «ÚLTIMO ACCESO».
 *
 * La bitácora registra lo que se HACE, no que se entre a mirar: alguien puede
 * entrar cada día sin dejar una sola línea. Llamarlo «último acceso» sería
 * prometer una precisión que el dato no tiene, y sobre esa promesa alguien
 * acabaría cerrando la cuenta de quien sí trabaja.
 */
test('la actividad no se vende como último inicio de sesión', () => {
  // Se mira el texto que SE VE, no los comentarios: este archivo explica
  // precisamente por qué no se llama así, y esa explicación no puede hacer
  // saltar su propia guardia.
  const visible = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(
    !/[úu]ltimo acceso|[úu]ltima entrada|[úu]ltimo inicio de sesi[óo]n/i.test(visible),
    'el dato viene de la bitácora: es ACTIVIDAD, no inicio de sesión'
  )
  assert.match(PAGE, /Actividad: \{desdeHace/)
})

test('las insignias de empresa tienen tope', () => {
  assert.match(TARJETA, /const TOPE = \d+/)
  assert.match(TARJETA, /\+\{resto\.length\} más/)
  const tope = Number(TARJETA.match(/const TOPE = (\d+)/)![1])
  assert.ok(tope > 0 && tope <= 4, 'un tope alto no es un tope: en móvil ya rompía con cuatro')
})

test('las empresas de práctica se distinguen de las reales', () => {
  assert.match(TARJETA, /e\.esDemo &&/)
  assert.match(TARJETA, /práctica/)
  assert.match(LISTA, /esDemo: true/, 'y el dato tiene que llegar desde la consulta')
})

/**
 * LO EXCEPCIONAL, AL FINAL.
 *
 * Lo primero que se veía al abrir el control de accesos era la herramienta para
 * suplantar a alguien. Lo que se viene a hacer aquí casi siempre es buscar a una
 * persona.
 */
test('«entrar como» va debajo de la lista, no encima', () => {
  const lista = PAGE.indexOf('d.filas.map')
  const entrarComo = PAGE.lastIndexOf('<EntrarComoCard />')
  assert.ok(lista > 0 && entrarComo > lista, 'la caja de suplantación va después de la lista')
})

test('el título y el alcance dejan de contradecirse', () => {
  assert.match(PAGE, /Usuarios y accesos/)
  assert.ok(
    !/Usuarios de staff<\/h1>/.test(PAGE),
    'el título decía «staff» y debajo había una caja que acepta clientes'
  )
})
