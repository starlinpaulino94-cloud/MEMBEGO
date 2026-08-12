import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * «MI MEMBEGO» ES DE LA PERSONA, NO DE LA FICHA QUE TENGA ABIERTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ARREGLÓ
 *
 * Una persona tiene UNA ficha de `Cliente` POR EMPRESA. Sus regalos, sus gift
 * cards, sus citas, sus pagos y su historial se guardan bajo la ficha del
 * negocio donde ocurrieron — correctamente. Lo que estaba mal era LEERLOS:
 * cada pantalla filtraba por `metadata.clienteId`, la ficha de la empresa
 * activa, así que solo mostraba la parte de su vida que cabía en ese negocio.
 *
 * El síntoma no era «falta un dato», era peor: cambiar de empresa le vaciaba
 * media pantalla sin decir por qué, y un regalo PENDIENTE que no aparecía
 * expiraba solo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LECCIÓN QUE YA COSTÓ DOS VECES: EL CAMINO ENTERO
 *
 * Al hacer global «Mis beneficios» se migró el listado y se olvidaron el
 * detalle y el paso de agendar: daban 404 justo adonde llevaba el botón. Aquí
 * pasa lo mismo con las ACCIONES — aceptar, rechazar, cancelar—: si el listado
 * mira todas las fichas y la acción solo la activa, el botón responde «esto ya
 * no está pendiente» sobre algo que la propia pantalla acaba de mostrar.
 *
 * Por eso estas guardias vigilan las dos mitades juntas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTAS PRUEBAS **NO** SON
 *
 * Son guardias de texto: comprueban que el código siga diciendo lo que decidió
 * decir. Que las consultas DEVUELVAN lo correcto se comprueba ejecutándolas
 * contra PostgreSQL en `scripts/verificar-cliente-global.mts`, con una persona
 * de dos empresas y otra distinta como control.
 */

const leer = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('los listados de Mi Membego reciben a la persona, no una ficha', () => {
  const firmas: [string, RegExp, string][] = [
    [
      'src/modules/regalos/queries.ts',
      /export async function getRegalosCliente\(\s*supabaseId/,
      'los regalos recibidos en otra empresa desaparecían — y expiraban solos',
    ],
    [
      'src/modules/regalos/giftcards.ts',
      /export async function getGiftCardsCliente\(\s*supabaseId/,
      'una gift card con saldo dejaba de existir en su propia pantalla',
    ],
    [
      'src/modules/cliente/queries.ts',
      /export async function getClientePagos\(\s*supabaseId/,
      'la mitad de sus recibos se perdía al cambiar de empresa',
    ],
    [
      'src/modules/cliente/queries.ts',
      /export async function getClienteVisitas\(\s*\n?\s*supabaseId/,
      'su historial cambiaba debajo de los pies',
    ],
  ]
  for (const [archivo, patron, porque] of firmas) {
    assert.match(leer(archivo), patron, `${archivo}: ${porque}`)
  }
})

test('las que reciben ids, los reciben en plural', () => {
  // `getCitasCliente` y el `getRegalosCliente` de ofertas toman la LISTA de
  // fichas: la pantalla ya tiene que haber llamado a `misClienteIds`. Un
  // `string` suelto aquí es la firma vieja volviendo.
  assert.match(
    leer('src/modules/citas/queries.ts'),
    /export async function getCitasCliente\(clienteIds: string\[\]\)/,
    'Mis citas volvió a mirar una sola ficha: la cita del otro negocio se acerca y no sale en ninguna pantalla.'
  )
  assert.match(
    leer('src/modules/ofertas/queries.ts'),
    /export async function getRegalosCliente\(clienteIds: string\[\]\)/,
    'En la misma pantalla convivirían las compras de todos sus negocios con las ofertas de uno solo.'
  )
})

test('las acciones de regalos comprueban contra TODAS sus fichas', () => {
  const src = leer('src/modules/regalos/actions.ts')
  const responder = src.slice(src.indexOf('export async function responderRegalo'))
  const cancelar = src.slice(src.indexOf('export async function cancelarRegalo'))

  assert.match(
    responder.slice(0, 2000),
    /destinatarioId: \{ in: misFichas \}/,
    'Aceptar/rechazar volvió a mirar la ficha activa: el botón de una tarjeta ' +
      'que el listado SÍ muestra contestaría «este regalo ya no está pendiente».'
  )
  assert.match(
    cancelar.slice(0, 1500),
    /remitenteId: \{ in: misFichas \}/,
    'Cancelar volvió a mirar la ficha activa.'
  )
})

test('aceptar un regalo escribe en la empresa del regalo, no en la activa', () => {
  /**
   * LA MÁS IMPORTANTE DE ESTE ARCHIVO.
   *
   * Al aceptar se crea una compra ESPEJO, se suman usos a una membresía y se
   * emiten dos comprobantes. Todo eso pertenece a `regalo.companyId`. Usando
   * la ficha activa como destino —que era lo que hacía, porque coincidían—, un
   * regalo de otro negocio crearía el beneficio en la empresa equivocada: un
   * negocio entregando algo que nunca ofreció, y con RLS de por medio, o falla
   * o queda mal atribuido.
   *
   * `destinoId` es `regalo.destinatarioId`: la ficha A LA QUE SE ENVIÓ.
   */
  const src = leer('src/modules/regalos/actions.ts')
  const responder = src.slice(
    src.indexOf('export async function responderRegalo'),
    src.indexOf('export async function cancelarRegalo')
  )
  assert.match(
    responder,
    /const destinoId = regalo\.destinatarioId/,
    'El destino tiene que salir del regalo.'
  )
  assert.ok(
    !/clienteId(,|\s*\})/.test(responder.replace(/clienteId: destinoId/g, '')),
    'Volvió a usarse la ficha activa como destino al aceptar un regalo: el ' +
      'beneficio se crearía en la empresa equivocada.'
  )
})

test('cancelar una cita se comprueba contra todas sus fichas', () => {
  const src = leer('src/modules/citas/actions.ts')
  const cancelar = src.slice(src.indexOf('export async function cancelarCitaCliente'))
  assert.match(
    cancelar.slice(0, 1500),
    /clienteId: \{ in: misFichas \}/,
    'El listado muestra las citas de todos sus negocios; si cancelar solo mira ' +
      'la ficha activa, el botón responde «Cita no encontrada» sobre una cita suya.'
  )
})

test('la hora de cada cita se pinta con la zona horaria de SU negocio', () => {
  /**
   * El fallo más silencioso de esta fase. Con citas de varias empresas en una
   * lista, formatearlas todas con la zona de la empresa activa da una hora
   * equivocada CON TODA LA APARIENCIA DE SER CORRECTA — nadie lo nota hasta
   * que alguien llega dos horas tarde.
   */
  const q = leer('src/modules/citas/queries.ts')
  assert.match(
    q,
    /company: \{ select: \{ name: true, zonaHoraria: true, idioma: true \} \}/,
    'Cada cita tiene que viajar con su empresa: sin la zona horaria no se puede pintar bien.'
  )
  const page = leer('src/app/(cliente)/cliente/citas/page.tsx')
  assert.match(page, /const tzDe = \(c: CitaConEmpresa\) => c\.company\.zonaHoraria/)
  assert.ok(
    !/hmEnTz\(c\.inicio, tz\)/.test(page),
    'Volvió a formatearse la hora con la zona de la empresa activa.'
  )
  assert.match(
    page,
    /\{c\.company\.name\}/,
    'Con citas de varios negocios, una hora sin nombre no dice a dónde ir.'
  )
})

test('reservar sigue anclado a una empresa, y regalar también', () => {
  /**
   * No todo se hace global, y decirlo aquí evita el celo del próximo cambio.
   *
   * RESERVAR es con un negocio concreto —sus horarios, sus turnos libres, su
   * zona horaria—. REGALAR también: lo que se regala se canjea en esa empresa.
   * Lo que es de la persona es MIRAR lo que ya tiene.
   */
  const citas = leer('src/app/(cliente)/cliente/citas/page.tsx')
  assert.match(
    citas,
    /getAgendaConfig\(cliente\.companyId\)/,
    'La agenda que se ofrece es la del negocio activo: no se reserva «en general».'
  )
  for (const p of ['giftcard', 'regalar', 'enviar']) {
    const src = leer(`src/app/(cliente)/cliente/regalos/${p}/page.tsx`)
    assert.match(
      src,
      /const companyId = user\.metadata\.companyId/,
      `/${p} regala DENTRO de una empresa; necesita saber cuál.`
    )
  }
})

test('a nadie se le dice «No autorizado» por no tener nada todavía', () => {
  // Quien acaba de registrarse está perfectamente autorizado. Lo que no tiene
  // es una sola visita, un solo pago ni un solo beneficio. Ver
  // `SinEmpresaTodavia` y `tests/cliente-sin-empresa.test.ts`.
  for (const p of [
    'src/app/(cliente)/cliente/historial/page.tsx',
    'src/app/(cliente)/cliente/mis-promociones/page.tsx',
  ]) {
    const src = leer(p)
    assert.ok(
      !/No autorizado/.test(src),
      `${p} vuelve a contestar «No autorizado» a un usuario nuevo.`
    )
    assert.match(src, /SinEmpresaTodavia/, `${p} debe ofrecer a dónde ir.`)
  }
})
