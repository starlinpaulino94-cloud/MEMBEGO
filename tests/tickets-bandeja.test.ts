import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COLAS,
  DIAS_PARADO,
  estaParado,
  hayFiltro,
  hrefTickets,
  leerFiltroTickets,
} from '../src/modules/soporte/filtros'
import { COLAS_TICKET } from '../src/lib/soporte'

/**
 * LA BANDEJA DE SOPORTE.
 *
 * Las dos primeras guardias son de ALCANCE, y las escribo con incomodidad: el
 * fallo que impiden lo introduje al montar la ruta gemela. Di por hecho que
 * `resolveCompanyContext` dejaba al superadmin sin empresa, escribí un
 * comentario afirmándolo, y no lo comprobé. La bandeja «de plataforma» enseñaba
 * los tickets de la primera empresa alfabéticamente.
 */

const QUERIES = readFileSync(join('src', 'modules', 'soporte', 'queries.ts'), 'utf8')
const BANDEJA = readFileSync(join('src', 'components', 'soporte', 'BandejaTickets.tsx'), 'utf8')
const TABLA = readFileSync(join('src', 'components', 'admin', 'TicketsTable.tsx'), 'utf8')
const RUTA_SUPER = readFileSync(
  join('src', 'app', '(superadmin)', 'superadmin', 'tickets', 'page.tsx'),
  'utf8'
)
const RUTA_ADMIN = readFileSync(join('src', 'app', '(admin)', 'admin', 'tickets', 'page.tsx'), 'utf8')
const PANEL = readFileSync(join('src', 'modules', 'superadmin', 'panel.ts'), 'utf8')

const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────────────── M79 · el alcance de la bandeja ─────────────────────

test('en el panel de plataforma, sin elección explícita se ven TODAS', () => {
  // `chosen` caía a `companies[0]?.id`: nunca `null` mientras hubiera una
  // empresa. Y de rebote `showEmpresa` —que exige «superadmin y sin empresa»—
  // no se activaba jamás, así que tampoco salía la columna que lo delataba.
  assert.match(QUERIES, /opciones: \{ ambitoPlataforma\?: boolean \} = \{\}/)
  assert.match(QUERIES, /const chosen = opciones\.ambitoPlataforma\s*\n?\s*\?[\s\S]{0,400}pedida/)
})

test('cada ruta declara su alcance, y no se supone', () => {
  assert.match(RUTA_SUPER, /alcance="plataforma"/)
  assert.match(RUTA_ADMIN, /alcance="empresa"/)
})

test('el panel de empresa conserva su comportamiento', () => {
  // Ese panel opera sobre UNA empresa y necesita una elegida: para él, «la
  // primera» sigue siendo la respuesta correcta.
  assert.match(QUERIES, /pedida \|\| exists\(user\.metadata\.companyId\) \|\| companies\[0\]\?\.id \|\| null/)
})

test('la columna de empresa aparece cuando se cruzan empresas', () => {
  assert.match(BANDEJA, /mostrarEmpresa=\{ctx\.companyId === null\}/)
})

// ───────────── M80 · el aviso y su destino, con el MISMO alcance ─────────────

/**
 * ESTA ES LA GUARDIA QUE FALTABA.
 *
 * `tests/superadmin-coherencia.test.ts` ya comprobaba que el aviso y la bandeja
 * usaran la misma COLA (`COLAS_TICKET.pendientes`), y pasaba. Lo que no
 * comprobaba es el ALCANCE — y ahí estaba el desacuerdo: el aviso contaba los
 * pendientes de todas las empresas y la bandeja enseñaba los de una.
 *
 * Una guardia que mide media cosa es peor que ninguna: da un visto bueno que
 * nadie vuelve a cuestionar.
 */
test('el aviso del Centro de control cuenta TODA la plataforma', () => {
  const linea = PANEL.slice(PANEL.indexOf('tx.supportTicket'), PANEL.indexOf('tx.supportTicket') + 220)
  assert.match(linea, /estado: \{ in: \[\.\.\.COLAS_TICKET\.pendientes\] \}/)
  assert.ok(
    !/companyId/.test(linea),
    'el aviso es de plataforma: acotarlo a una empresa lo separaría de su destino'
  )
})

test('y su destino también, porque arranca sin empresa', () => {
  // Las dos mitades del mismo trato: el número y la lista a la que lleva.
  assert.match(RUTA_SUPER, /alcance="plataforma"/)
  assert.match(QUERIES, /ambitoPlataforma/)
})

test('la cola por defecto de la bandeja es la que cuenta el aviso', () => {
  assert.equal(leerFiltroTickets({}).cola, 'pendientes')
  assert.deepEqual([...COLAS_TICKET.pendientes], ['NUEVO', 'EN_PROCESO'])
})

// ───────────── M81 · servidor, búsqueda y paginación ─────────────

test('la bandeja ya no filtra en el navegador', () => {
  // Sobre el código, no sobre los comentarios: el archivo explica precisamente
  // qué hacía con `useState` y `useMemo`, y esa explicación es lo que impide
  // que vuelva.
  const codigo = sinComentarios(TABLA)
  assert.ok(
    !codigo.includes("'use client'"),
    'sin estado de cliente: la cola y la búsqueda viven en la URL'
  )
  assert.ok(!/useMemo|useState/.test(codigo))
})

test('los filtros llegan a la consulta, que ya sabía aceptarlos', () => {
  // `listTicketsAdmin` aceptaba `estado` y `q` desde siempre y nadie se los
  // pasaba: traía 200 filas y el navegador las recortaba.
  assert.match(BANDEJA, /listTicketsAdmin\(ctx\.companyId, ctx\.isSuperadmin, f\)/)
  assert.match(QUERIES, /skip: opciones\.todo \? 0 : \(f\.pagina - 1\) \* POR_PAGINA/)
  assert.ok(
    !/take: 200/.test(sinComentarios(QUERIES)),
    'el tope fijo de 200 dejaba el ticket 201 inalcanzable'
  )
})

test('los contadores de las pestañas salen de la base, no de la página', () => {
  // Contarlos sobre las filas cargadas haría que «Cerrados» dijera 25 cuando
  // hay 900: un contador que cuenta lo que ya se ve no informa de nada.
  assert.match(QUERIES, /tx\.supportTicket\.groupBy\(\{/)
  assert.match(QUERIES, /where: whereSinCola\(companyId, isSuperadmin, f\)/)
})

test('el `where` está tipado', () => {
  assert.match(QUERIES, /\): Prisma\.SupportTicketWhereInput \{/)
  assert.ok(
    !/const where: Record<string, unknown>/.test(QUERIES),
    'el punto donde se decide «una empresa o todas» no puede quedar sin comprobar'
  )
})

test('un admin sin empresa no ve nada, no lo ve todo', () => {
  assert.match(QUERIES, /else if \(!isSuperadmin\) and\.push\(\{ companyId: '__none__' \}\)/)
})

// ───────────── filtros (puros) ─────────────

test('sin parámetros: pendientes, reales, página 1', () => {
  assert.deepEqual(leerFiltroTickets({}), {
    cola: 'pendientes',
    q: '',
    empresa: null,
    ambito: 'reales',
    pagina: 1,
  })
  assert.equal(hayFiltro(leerFiltroTickets({})), false)
})

test('un valor inventado en la URL degrada al de por defecto', () => {
  const f = leerFiltroTickets({ cola: 'inventada', ambito: 'x', pagina: '0' })
  assert.equal(f.cola, 'pendientes')
  assert.equal(f.ambito, 'reales')
  assert.equal(f.pagina, 1)
})

test('cambiar de cola vuelve a la página 1 y conserva la búsqueda', () => {
  const f = leerFiltroTickets({ q: 'ana', cola: 'cerrados', pagina: '4' })
  const url = hrefTickets(f, '/x', { cola: 'esperando', pagina: 1 })
  assert.ok(url.includes('cola=esperando'))
  assert.ok(url.includes('q=ana'))
  assert.ok(!url.includes('pagina='))
})

test('la cola por defecto no ensucia la URL', () => {
  const f = leerFiltroTickets({})
  assert.equal(hrefTickets(f, '/x'), '/x')
})

test('el selector de empresa sigue usando `company`', () => {
  // Es el nombre que ya usaba el `CompanySelector`; cambiarlo rompería los
  // enlaces que existan por ahí.
  assert.equal(leerFiltroTickets({ company: 'cmp_1' }).empresa, 'cmp_1')
  assert.equal(leerFiltroTickets({ company: 'todas' }).empresa, null)
  assert.ok(hrefTickets(leerFiltroTickets({ company: 'cmp_1' }), '/x').includes('company=cmp_1'))
})

test('las tres colas cubren los cinco estados', () => {
  const cubiertos = COLAS.flatMap((c) => [...COLAS_TICKET[c]])
  assert.equal(new Set(cubiertos).size, 5)
})

// ───────────── M82 · la antigüedad ─────────────

test('solo se marcan como parados los que le tocan al negocio', () => {
  const tresDias = DIAS_PARADO * 24 * 60 * 60 * 1000
  assert.equal(estaParado('pendientes', tresDias), true)
  assert.equal(estaParado('pendientes', tresDias - 1), false)
  // En «esperando al cliente» la pelota no es del negocio: marcarlo ahí
  // convertiría el aviso en ruido y dejaría de mirarse.
  assert.equal(estaParado('esperando', tresDias * 10), false)
  assert.equal(estaParado('cerrados', tresDias * 10), false)
})

test('la fila dice cuánto lleva, no una fecha suelta', () => {
  // «12 ago» obliga a calcular la antigüedad de cabeza fila por fila, que es
  // justo lo que se necesita para priorizar.
  assert.match(TABLA, /desdeHace\(t\.desdeUltimoMovimiento\)/)
  assert.match(TABLA, /dateTime=\{t\.actualizado\.toISOString\(\)\}/)
})

test('un solo «ahora» para toda la lista', () => {
  const veces = [...QUERIES.matchAll(/Date\.now\(\)/g)].length
  assert.equal(veces, 1, `el módulo lee el reloj ${veces} veces; tiene que ser una sola`)
})

// ───────────── M83 · el detalle, dentro de su panel ─────────────

test('cada panel abre el ticket dentro de sí mismo', () => {
  // Las filas enlazaban siempre a `/admin/tickets/{id}`: el primer clic hacía
  // justo lo que la ruta gemela venía a evitar.
  assert.match(TABLA, /href=\{`\$\{detalleBase\}\$\{t\.id\}`\}/)
  assert.match(BANDEJA, /detalleBase=\{`\$\{base\}\/`\}/)
  assert.match(BANDEJA, /alcance === 'plataforma' \? '\/superadmin\/tickets' : '\/admin\/tickets'/)
})

test('el detalle es una pantalla montada dos veces, no dos copias', () => {
  const detSuper = readFileSync(
    join('src', 'app', '(superadmin)', 'superadmin', 'tickets', '[id]', 'page.tsx'),
    'utf8'
  )
  const detAdmin = readFileSync(
    join('src', 'app', '(admin)', 'admin', 'tickets', '[id]', 'page.tsx'),
    'utf8'
  )
  for (const src of [detSuper, detAdmin]) {
    assert.match(src, /from '@\/components\/soporte\/DetalleTicket'/)
    assert.ok(!/getTicketDetail/.test(src), 'la lógica vive en el componente compartido')
  }
  assert.match(detSuper, /volverA="\/superadmin\/tickets"/)
  assert.match(detAdmin, /volverA="\/admin\/tickets"/)
})

// ───────────── M84, M86 · práctica y textos ─────────────

test('las de práctica se marcan y se pueden filtrar', () => {
  assert.match(TABLA, /t\.empresaEsDemo && mostrarEmpresa/)
  assert.match(QUERIES, /company: \{ esDemo: f\.ambito === 'practica' \}/)
})

test('el filtro de ámbito solo aparece cuando se cruzan empresas', () => {
  // Acotado a una empresa no distingue nada: sería un control que siempre da
  // lo mismo.
  assert.match(QUERIES, /if \(!companyId && f\.ambito !== 'todas'\)/)
  assert.match(BANDEJA, /mostrarAmbito=\{ctx\.companyId === null\}/)
})

test('en plataforma los tickets no son «tuyos»', () => {
  assert.match(BANDEJA, /Solicitudes de soporte abiertas por los clientes de cada empresa/)
  assert.match(BANDEJA, /alcance === 'plataforma'/)
})
