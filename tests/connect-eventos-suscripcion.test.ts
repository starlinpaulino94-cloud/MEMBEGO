import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIPO_V2 } from '@membego/contracts'
import { EVENTOS_REENVIADOS } from '../src/modules/integraciones/nucleo'
import {
  COMODIN,
  esFamilia,
  suscripcionQuiere,
} from '../src/modules/connect/webhooksNucleo'
import {
  FAMILIA_AUTOMATIZACIONES,
  eventosDeNegocio,
  eventosSuscribibles,
  soloEventosConocidos,
  valoresSuscribibles,
} from '../src/modules/connect/eventosSuscribibles'

/**
 * ELEGIR QUÉ EVENTOS RECIBE UN WEBHOOK · hallazgo A-5 de la auditoría.
 *
 * El modelo lo soportaba desde la Fase 3 y la interfaz no ofrecía una sola
 * casilla: toda suscripción nacía recibiéndolo todo. Lo que se vigila aquí, más
 * que las casillas, es la TRAMPA que el selector podía haber sido — apagar en
 * silencio los avisos de automatización de quien filtrara por primera vez.
 */

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const codigo = (r: string) =>
  leer(r)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const PANEL = 'src/components/connect/WebhooksPanel.tsx'
const ACCIONES = 'src/modules/connect/adminActions.ts'

// ─── La regla de siempre no se toca ──────────────────────────────────────────

test('sin elegir nada, se sigue recibiendo TODO', () => {
  // Es el default de todas las suscripciones que existen hoy. Cambiarlo dejaría
  // sin avisos a quien ya está integrado, y sin un error en ningún sitio.
  for (const ev of ['customer.created', 'automation.lo_que_sea', 'inventado.x']) {
    assert.ok(suscripcionQuiere([], ev), `${ev} no llegaría con la lista vacía`)
  }
})

test('eligiendo, llega lo elegido y nada más', () => {
  const elegidos = ['purchase.completed', 'referral.converted']
  assert.ok(suscripcionQuiere(elegidos, 'purchase.completed'))
  assert.ok(suscripcionQuiere(elegidos, 'referral.converted'))
  assert.ok(!suscripcionQuiere(elegidos, 'visit.completed'))
})

// ─── La trampa que el comodín evita ──────────────────────────────────────────

test('LA TRAMPA: filtrar no puede apagar en silencio las automatizaciones', () => {
  /**
   * Los avisos de una automatización se llaman `automation.<lo que la regla
   * decida>`: el nombre lo inventa la empresa y NO se puede enumerar en una
   * lista de casillas. Sin una forma de marcarlos, quien filtrara por «compras»
   * dejaría de recibirlos — sin aviso, sin error y sin haberlo pedido.
   */
  const soloCompras = ['purchase.completed']
  assert.ok(!suscripcionQuiere(soloCompras, 'automation.avisar_al_dueno'))

  // Con la familia marcada, vuelven — y da igual cómo se llame la regla.
  const conAutomatizaciones = [...soloCompras, FAMILIA_AUTOMATIZACIONES]
  for (const nombre of ['avisar_al_dueno', 'cupon_enviado', 'lo-que-sea_2']) {
    assert.ok(
      suscripcionQuiere(conAutomatizaciones, `automation.${nombre}`),
      `automation.${nombre} no llega con la familia marcada`
    )
  }
})

test('una familia no se come un evento que solo comparte el principio', () => {
  // `automation.*` cubre `automation.x`, NO `automationX` ni `automations.y`.
  // El prefijo se compara con el punto incluido, y esto lo vigila.
  assert.ok(suscripcionQuiere([FAMILIA_AUTOMATIZACIONES], 'automation.x'))
  assert.ok(!suscripcionQuiere([FAMILIA_AUTOMATIZACIONES], 'automationX'))
  assert.ok(!suscripcionQuiere([FAMILIA_AUTOMATIZACIONES], 'automations.y'))
  assert.ok(!suscripcionQuiere([FAMILIA_AUTOMATIZACIONES], 'automation'))
})

test('la familia no arrastra a los eventos del negocio', () => {
  for (const e of eventosDeNegocio()) {
    assert.ok(
      !suscripcionQuiere([FAMILIA_AUTOMATIZACIONES], e.valor),
      `${e.valor} llega marcando solo las automatizaciones`
    )
  }
})

test('esFamilia distingue una familia de un evento concreto', () => {
  assert.ok(esFamilia(FAMILIA_AUTOMATIZACIONES))
  assert.ok(esFamilia(`x${COMODIN}`))
  assert.ok(!esFamilia('purchase.completed'))
})

// ─── El catálogo sale del bus, no de una lista a mano ────────────────────────

test('se ofrece exactamente lo que el bus emite, ni más ni menos', () => {
  /**
   * Una lista escrita a mano falla de las dos formas y las dos son caras:
   * ofrecer un evento que nadie recibirá nunca (y nadie sabrá por qué), u
   * olvidarse de uno nuevo (y que no se pueda elegir).
   */
  const delBus = [...new Set(EVENTOS_REENVIADOS.map((e) => TIPO_V2[e] ?? e))].sort()
  assert.deepEqual(eventosDeNegocio().map((e) => e.valor), delBus)
})

test('todo evento emitido tiene una frase; ninguno se enseña en inglés', () => {
  // Si alguien añade un evento al bus y olvida traducirlo, esto rompe la CI en
  // vez de enseñarle `purchase.refunded` a la dueña de un salón.
  for (const e of eventosDeNegocio()) {
    assert.notEqual(e.label, e.valor, `${e.valor} no tiene etiqueta de negocio`)
    assert.ok(e.label.length > 10, `${e.valor}: etiqueta demasiado pobre`)
    assert.doesNotMatch(e.label, /[a-z]+\.[a-z_]+/, `${e.valor}: la etiqueta lleva jerga`)
  }
})

test('la familia se ofrece, y va la última', () => {
  const todos = eventosSuscribibles()
  assert.equal(todos.at(-1)?.valor, FAMILIA_AUTOMATIZACIONES)
  // No es una cosa que pase en el negocio: es «lo que tus propias reglas
  // manden». Mezclarla entre los demás la haría indistinguible.
  assert.equal(todos.length, eventosDeNegocio().length + 1)
})

// ─── Lo que llega del formulario ─────────────────────────────────────────────

test('un evento inventado no se guarda', () => {
  // Guardarlo no daría error en ninguna parte: daría una suscripción que no
  // recibe nada y una tarde buscando por qué.
  assert.deepEqual(soloEventosConocidos(['purchase.completed', 'me.lo.invento']), [
    'purchase.completed',
  ])
  assert.deepEqual(soloEventosConocidos(['nada', 'de', 'esto']), [])
})

test('marcar dos veces lo mismo no lo guarda dos veces', () => {
  assert.deepEqual(soloEventosConocidos(['visit.completed', 'visit.completed']), [
    'visit.completed',
  ])
})

test('todo lo que el catálogo ofrece pasa su propia validación', () => {
  // La contraprueba obvia y la que más duele si falla: un valor que la pantalla
  // enseña y el servidor descarta sería una casilla que no hace nada.
  assert.deepEqual(soloEventosConocidos(valoresSuscribibles()).sort(), valoresSuscribibles().sort())
})

// ─── Las dos mitades de la interfaz ──────────────────────────────────────────

test('se puede elegir al crear Y cambiarlo después', () => {
  /**
   * La segunda mitad es la que de verdad hace falta: TODAS las suscripciones
   * que existen hoy tienen la lista vacía, porque hasta ahora no había forma de
   * decir otra cosa. Solo con el alta, esto no le serviría a nadie que ya
   * estuviera integrado.
   */
  const panel = codigo(PANEL)
  assert.match(panel, /<CasillasDeEventos[\s\S]{0,200}idPrefijo="nuevo"/)
  assert.ok(panel.includes('<EditarEventos'), 'no se pueden cambiar los eventos después')
  assert.match(codigo(ACCIONES), /actualizarEventosSuscripcion\(/)
})

test('la pantalla DICE que sin marcar nada llega todo', () => {
  // Es la frase que evita el malentendido caro: quien ve una lista de casillas
  // vacías asume que no recibe nada y marca por miedo, o cree que apagó algo.
  assert.match(leer(PANEL), /Sin marcar ninguna/)
})

test('cambiar eventos se guarda acotado por empresa', () => {
  // El id sale del formulario. Con `update` por id suelto bastaría cambiarlo
  // para reconfigurar la suscripción de otra empresa.
  const src = codigo('src/modules/connect/webhooks.ts')
  const fn = src.slice(src.indexOf('export async function actualizarEventosSuscripcion'))
  assert.match(fn.slice(0, 700), /updateMany\(/)
  assert.match(fn.slice(0, 700), /where: \{ id, companyId \}/)
})

test('la lista enseña las frases, no los identificadores', () => {
  // «Recibe: purchase.first_completed, referral.converted» obliga a traducir de
  // cabeza cada vez que alguien quiere comprobar qué eligió.
  assert.match(codigo(PANEL), /catalogo\.find\(\(c\) => c\.valor === e\)\?\.label/)
})

test('el catálogo se calcula en el servidor, no en el navegador', () => {
  /**
   * `eventosSuscribibles` deriva de `EVENTOS_REENVIADOS`, que vive junto al
   * núcleo de firmas y arrastra `node:crypto`. Importarlo desde un componente
   * de cliente se lo llevaría al bundle.
   */
  const panel = leer(PANEL)
  assert.ok(panel.includes("'use client'"))
  // Sobre los IMPORTS y no sobre el texto: el propio comentario que explica de
  // dónde sale el catálogo nombra el módulo, y una guardia que se dispara con
  // su documentación es una guardia que alguien acaba borrando.
  assert.doesNotMatch(
    codigo(PANEL),
    /import[^\n]*eventosSuscribibles/,
    'el componente de cliente importa el catálogo en vez de recibirlo'
  )
  assert.match(
    codigo('src/app/(admin)/admin/integraciones/desarrolladores/webhooks/page.tsx'),
    /catalogo=\{eventosSuscribibles\(\)\}/
  )
})
