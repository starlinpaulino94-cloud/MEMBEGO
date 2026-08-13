import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FALTAS,
  FALTA_LABEL,
  fichasDeFiltro,
  hayFiltro,
  hrefFiltro,
  leerFiltroOperaciones,
} from '../src/modules/operaciones/filtros'
import { operacionesToCsv } from '../src/modules/operaciones/csv'
import type { OperacionEmpresa } from '../src/modules/operaciones/lista'

/**
 * OPERACIONES POR EMPRESA.
 *
 * El único producto de esta pantalla son tres números por empresa. Si un número
 * miente, la pantalla no sirve para nada — y dos de los tres mentían.
 */

const PAGE = readFileSync(
  join('src', 'app', '(superadmin)', 'superadmin', 'operaciones', 'page.tsx'),
  'utf8'
)
const LISTA = readFileSync(join('src', 'modules', 'operaciones', 'lista.ts'), 'utf8')

/** El código sin comentarios: este archivo EXPLICA lo que ya no hace. */
const sinComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')

// ───────────── M68 · «activas» quiere decir vigentes ─────────────

/**
 * `Promocion` tiene `vigenciaDesde`, `vigenciaHasta` Y `archivada`. Contar
 * `activo: true` a secas metía en «activas» las caducadas hace meses y las
 * programadas para el futuro, y en el total las archivadas.
 *
 * `promocionVigente()` es la definición única, y su propio comentario avisa de
 * que ya hubo dos definiciones conviviendo y una era falsa. Ésta era la tercera.
 */
test('las promociones se cuentan con la definición única de vigencia', () => {
  assert.match(LISTA, /import \{ promocionVigente \} from '@\/modules\/promociones\/vigencia'/)
  assert.match(LISTA, /\.\.\.promocionVigente\(ahora\)/)
  const codigo = sinComentarios(LISTA)
  assert.ok(
    !/where: \{ activo: true \}/.test(codigo),
    'contar `activo: true` a secas es lo que hacía pasar por activas las caducadas'
  )
})

test('el total tampoco cuenta las archivadas', () => {
  // Archivar es la forma de retirar una promoción: sumarla al denominador
  // infla el «3 de 12» con material que nadie va a volver a publicar.
  assert.match(LISTA, /archivada: false/)
})

test('«sin promociones vigentes» se resuelve en la base, no en memoria', () => {
  // `none` con la vigencia dentro: una empresa con diez promociones caducadas
  // está igual de vacía de cara al cliente que una sin ninguna.
  assert.match(LISTA, /promociones: \{ none: promocionVigente\(ahora\) \}/)
})

// ───────────── M69 · el vertical real ─────────────

test('la insignia sale del vertical real, no de la categoría vieja', () => {
  // `tipoNegocioCodigo` manda cuando está: es lo que dice el esquema y lo que
  // ya aplican el registro y las capacidades. La insignia enseñaba `type`.
  assert.match(LISTA, /const codigo = e\.tipoNegocioCodigo \?\? e\.type/)
  assert.match(LISTA, /verticalNombre: verticales\.get\(codigo\) \?\? codigo/)
  assert.ok(
    !/\{c\.type\}|\{e\.type\}/.test(PAGE),
    'la pantalla no puede volver a pintar el campo histórico'
  )
})

test('los verticales se resuelven FUERA de la transacción del listado', () => {
  // `verticalesElegibles()` abre la suya: pedirlos desde dentro tomaría una
  // segunda conexión del pool, y eso no falla — se degrada.
  assert.match(PAGE, /await verticalesElegibles\(\)/)
  assert.ok(
    !/verticalesElegibles/.test(sinComentarios(LISTA)),
    'el listado recibe el mapa ya resuelto; no lo pide él'
  )
})

// ───────────── M70 · las reglas encendidas ─────────────

test('solo se cuentan las reglas de referido activas', () => {
  // `ReglaRecompensa.activo` existe —hay hasta un índice `[companyId, activo]`—
  // y no se filtraba: tres reglas apagadas figuraban igual que tres vivas.
  assert.match(LISTA, /tx\.reglaRecompensa\.groupBy\(\{[\s\S]{0,200}activo: true/)
  assert.match(LISTA, /reglasRecompensa: \{ none: \{ activo: true \} \}/)
})

// ───────────── M71 · de diagnóstico a acción ─────────────

/**
 * Y EL ENLACE SE QUEDA EN ESTE PANEL.
 *
 * `/admin/*` opera sobre la empresa ACTIVA de la sesión, así que un enlace ahí
 * desde una tarjeta llevaría a otra empresa y cambiaría la barra lateral
 * entera. Es el mismo error que ya se corrigió en el Centro de control.
 */
test('cada empresa enlaza a su página, y dentro del panel de plataforma', () => {
  assert.match(PAGE, /href=\{`\/superadmin\/empresas\/\$\{e\.id\}`\}/)
  const fuera = [...PAGE.matchAll(/href=\{?["`](\/admin\/[^"`]+)/g)].map((m) => m[1])
  assert.deepEqual(fuera, [], 'no cruces al panel de empresa: ' + fuera.join(', '))
})

// ───────────── M72 · los filtros de la pantalla ─────────────

test('sin parámetros se ven las reales, todas, y en la página 1', () => {
  assert.deepEqual(leerFiltroOperaciones({}), {
    q: '',
    falta: 'nada',
    ambito: 'reales',
    pagina: 1,
  })
  assert.equal(hayFiltro(leerFiltroOperaciones({})), false)
})

test('un valor inventado en la URL degrada al de por defecto', () => {
  const f = leerFiltroOperaciones({ falta: 'lo-que-sea', ambito: 'x', pagina: '-3' })
  assert.equal(f.falta, 'nada')
  assert.equal(f.ambito, 'reales')
  assert.equal(f.pagina, 1)
})

test('se puede preguntar por lo que falta, que es para lo que existe la pantalla', () => {
  for (const x of FALTAS) assert.ok(FALTA_LABEL[x], `${x} saldría en crudo`)
  assert.equal(leerFiltroOperaciones({ falta: 'whatsapp' }).falta, 'whatsapp')
})

test('«sin WhatsApp» incluye el configurado pero apagado', () => {
  // Para el cliente es el mismo problema —no hay botón—, aunque se arreglen
  // distinto. Contar solo los ausentes escondería la mitad de los casos.
  assert.match(LISTA, /whatsappConfig: \{ is: null \} \}, \{ whatsappConfig: \{ activo: false \} \}/)
})

test('quitar un filtro conserva los demás y vuelve a la página 1', () => {
  const f = leerFiltroOperaciones({ q: 'car', falta: 'whatsapp', ambito: 'todas', pagina: '3' })
  const fichas = fichasDeFiltro(f, '/superadmin/operaciones')
  assert.deepEqual(fichas.map((x) => x.clave), ['q', 'falta', 'ambito'])

  const quitarFalta = fichas.find((x) => x.clave === 'falta')!.quitarHref
  assert.ok(quitarFalta.includes('q=car'))
  assert.ok(quitarFalta.includes('ambito=todas'))
  assert.ok(!quitarFalta.includes('falta='))
  assert.ok(!quitarFalta.includes('pagina='), 'quedarse en la página 3 enseñaría «sin resultados»')
})

test('paginar conserva los filtros', () => {
  const f = leerFiltroOperaciones({ q: 'car', falta: 'reglas' })
  const url = hrefFiltro(f, '/x', { pagina: 2 })
  assert.ok(url.includes('q=car') && url.includes('falta=reglas') && url.includes('pagina=2'))
  assert.ok(!hrefFiltro(f, '/x', { pagina: 1 }).includes('pagina='))
})

test('las cifras de arriba son del ámbito, no del filtro', () => {
  // Son cuánto trabajo queda: si menguaran al filtrar dejarían de servir para
  // decidir qué mirar, que es justo para lo que están.
  assert.match(LISTA, /const ambito: Prisma\.CompanyWhereInput =/)
  assert.match(LISTA, /where: \{ AND: \[ambito, \{ promociones: \{ none: promocionVigente\(ahora\) \} \}\] \}/)
})

test('un solo «ahora» para el filtro, los conteos y los avisos', () => {
  const veces = [...LISTA.matchAll(/new Date\(\)/g)].length
  assert.equal(veces, 1, `el módulo lee el reloj ${veces} veces; tiene que ser una sola`)
})

// ───────────── M73, M75, M76, M77 · la pantalla ─────────────

test('práctica, suspendida y sin publicar se distinguen', () => {
  assert.match(PAGE, /e\.esDemo && \(/)
  assert.match(PAGE, /!e\.isActive && \(/)
  assert.match(PAGE, /e\.isActive && !e\.isPublished && \(/)
})

test('el número de WhatsApp lleva su código de país', () => {
  // Se enseñaba solo `numero`, que son los dígitos nacionales: quien lo copiara
  // para llamar marcaba un número incompleto.
  assert.match(LISTA, /\$\{e\.whatsappConfig\.codigoPais\} \$\{e\.whatsappConfig\.numero\}/)
})

test('el color semántico deja de usarse como decoración', () => {
  // El regalo siempre ámbar y WhatsApp siempre verde, dijeran lo que dijeran
  // los números. En el resto del panel el color ES el dato; gastarlo aquí lo
  // desgasta donde sí significa algo.
  assert.match(PAGE, /<Icono aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" \/>/)
  assert.ok(
    !/<Gift className="h-4 w-4 text-warning"/.test(PAGE),
    'el icono no puede llevar color semántico fijo'
  )
})

test('los plurales no se escriben a mano', () => {
  const codigo = sinComentarios(PAGE)
  assert.ok(!/regla\$\{/.test(codigo), 'usa `plural()`')
  assert.match(PAGE, /from '@\/lib\/plural'/)
})

test('hay estado vacío, y distingue «no hay» de «no encontré»', () => {
  // Sin empresas la pantalla se quedaba en blanco bajo el título.
  assert.match(PAGE, /d\.totalAmbito === 0 \? 'No hay empresas registradas' : 'Sin resultados'/)
})

test('el título coincide con el del menú', () => {
  assert.match(PAGE, /<h1 className="text-h1 text-foreground">Operaciones<\/h1>/)
})

test('las tarjetas son una lista para quien no ve la pantalla', () => {
  assert.match(PAGE, /<ul className="grid list-none gap-4 md:grid-cols-2">/)
})

// ───────────── M78 · el CSV ─────────────

const FILA: OperacionEmpresa = {
  id: 'c1',
  name: 'CARTOWN; Wash',
  verticalCodigo: 'carwash',
  verticalNombre: 'Car Wash',
  esDemo: false,
  isActive: true,
  isPublished: true,
  promosVigentes: 3,
  promosTotal: 12,
  referidosCompletados: 40,
  referidosMes: 12,
  reglasActivas: 2,
  whatsapp: { numero: '+1 8095550100', activo: false },
}

test('las promociones van en dos columnas, no en «3 / 12»', () => {
  // Esa barra convierte el dato en texto: deja de ordenarse y de sumarse, que
  // es para lo único que se abre un CSV.
  const csv = operacionesToCsv([FILA])
  assert.ok(csv.includes('Promos vigentes;Promos totales'))
  assert.ok(csv.includes(';3;12;'))
  assert.ok(!csv.includes('3 / 12'))
})

test('el WhatsApp distingue tres estados, no dos', () => {
  // Sin configurar y configurado-pero-apagado tienen la misma consecuencia
  // para el cliente pero se arreglan distinto.
  assert.ok(operacionesToCsv([FILA]).includes(';Inactivo;'))
  assert.ok(operacionesToCsv([{ ...FILA, whatsapp: null }]).includes(';Sin configurar;'))
})

test('un punto y coma en el nombre no parte la fila', () => {
  const csv = operacionesToCsv([FILA])
  assert.ok(csv.includes('"CARTOWN; Wash"'))
  assert.equal(csv.split('\n').length, 2, 'cabecera y una fila')
})

test('la exportación se lleva el filtro de la pantalla', () => {
  assert.match(PAGE, /hrefFiltro\(f, `\$\{BASE\}\/exportar`\)/)
  const f = leerFiltroOperaciones({ falta: 'whatsapp', ambito: 'todas' })
  const url = hrefFiltro(f, '/superadmin/operaciones/exportar')
  assert.ok(url.includes('falta=whatsapp') && url.includes('ambito=todas'))
})
