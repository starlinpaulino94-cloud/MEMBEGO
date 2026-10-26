/**
 * LA POLÍTICA DE PAGOS PUBLICADA (/privacy § 5) DICE LO QUE EL SISTEMA HACE.
 *
 * La casilla que el cliente marca al activar la renovación es corta y remite a la Política de pagos: lo que promete la
 * política es lo que el cliente acepta. Si alguien cambia `POLITICA_RENOVACION` (los días de aviso, cuántos días antes se
 * cobra, cuántos intentos) y no cambia la política pública —o al revés—, el cliente aceptó una cosa y el sistema hace
 * otra. Estas pruebas lo impiden. También vigilan que la política no afirme nada que el código no cumpla (la fecha de
 * vencimiento SÍ se guarda cuando el procesador la entrega) y que los enlaces que la señalan lleguen a su sección.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLITICA_RENOVACION } from '../src/modules/pagos/renovacionPolitica'
import { RUTA_POLITICA_RENOVACION } from '../src/modules/pagos/consentimientosCore'

const raiz = join(__dirname, '..')
const fuente = (ruta: string) => readFileSync(join(raiz, ruta), 'utf8')
/** El texto que ve la persona: JSX sin etiquetas ni comentarios, con los espacios normalizados. */
const visible = (ruta: string) =>
  fuente(ruta)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{' '\}/g, ' ')
    .replace(/\s+/g, ' ')

const PRIVACIDAD = 'src/app/(public)/privacy/page.tsx'
const TERMINOS = 'src/app/(public)/terms/page.tsx'
const seccion = (texto: string, desde: string, hasta: string) => {
  const i = texto.indexOf(desde)
  const j = texto.indexOf(hasta, i)
  assert.ok(i >= 0 && j > i, `no se encontró la sección «${desde}»`)
  return texto.slice(i, j)
}

const EN_LETRAS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
const numero = (palabra: string) => EN_LETRAS[palabra.toLowerCase()] ?? Number(palabra)
const DIA = 24 * 60 * 60 * 1000

test('la política publicada dice las MISMAS cifras que la política del sistema', () => {
  const renov = seccion(visible(PRIVACIDAD), '5.3 Renovación automática', '5.4 Constancia')
  const aviso = renov.match(/(\w+) días antes del vencimiento te avisamos/i)
  assert.ok(aviso, 'la política ya no dice cuántos días antes se avisa')
  assert.equal(numero(aviso![1]), POLITICA_RENOVACION.avisoPrevioDias, 'días de aviso previo')
  const cobro = renov.match(/se intenta desde (\w+) días antes del vencimiento/i)
  assert.ok(cobro, 'la política ya no dice desde cuándo se cobra')
  assert.equal(numero(cobro![1]), POLITICA_RENOVACION.diasAntesDelPrimerIntento, 'días antes del primer intento')
  const intentos = renov.match(/hasta (\w+) intentos en total/i)
  assert.ok(intentos, 'la política ya no dice cuántos intentos son')
  assert.equal(numero(intentos![1]), POLITICA_RENOVACION.maxRechazosPorCiclo, 'intentos por ciclo')
  // «al día siguiente» solo es cierto con un cron diario y un espaciado menor que un día.
  assert.match(renov, /al día siguiente/)
  assert.ok(POLITICA_RENOVACION.espaciadoMinimoMs < DIA)
})

test('la política promete exactamente lo que el sistema hace, y nada más', () => {
  const renov = seccion(visible(PRIVACIDAD), '5.3 Renovación automática', '5.4 Constancia')
  for (const [promesa, regex] of [
    ['el precio vigente del plan', /precio vigente del plan/],
    ['el aviso por correo y en la cuenta', /por correo y en tu cuenta/],
    ['sin aviso no se cobra (exigeAvisoPrevio)', /Si no podemos avisarte, no cobramos/],
    ['cobrar antes no quita días', /Cobrar antes no te quita días/],
    ['un rechazo avisa y no hizo cargo', /no se hizo ningún cargo/],
    ['siempre antes del vencimiento', /siempre antes del vencimiento/],
    ['los rechazos definitivos desactivan', /vencida, reportada o inválida/],
    ['al desactivar, la tarjeta sigue guardada', /Tu tarjeta sigue guardada/],
    ['la membresía sigue vigente', /sigue vigente hasta su vencimiento/],
    ['un cobro dudoso no se repite', /no lo repetimos hasta confirmar con CardNET/],
    ['recibo por correo', /recibo por correo/],
    ['desactivar desde la membresía o quitando la tarjeta', /desde tu membresía o quitando la tarjeta/],
    ['las heredadas se pueden confirmar o desactivar', /confirmarlas o desactivarlas/],
  ] as const) {
    assert.match(renov, regex, `la política ya no dice: ${promesa}`)
  }
  // Lo que el sistema NO hace, la política no lo promete.
  assert.doesNotMatch(renov, /reembols|devoluci/i, 'promete reembolsos que el sistema no gestiona')
})

test('la política no niega lo que el código guarda: el vencimiento (mes y año) sí se conserva cuando lo entrega el procesador', () => {
  const pagos = seccion(visible(PRIVACIDAD), '5. Pagos con tarjeta', '6. Tus derechos')
  assert.doesNotMatch(pagos, /ni almacena[^.]*vencimiento/i, 'vuelve a decir que nunca se guarda el vencimiento')
  assert.match(pagos, /mes y el año de vencimiento/)
  assert.match(pagos, /número completo de tu tarjeta ni el código CVV/)
  // Las dos autorizaciones, separadas, y lo que se registra de cada una.
  assert.match(pagos, /No activa la renovación automática/)
  assert.match(pagos, /versión del texto que viste/)
  assert.match(pagos, /dirección IP/)
})

test('los enlaces a las condiciones llegan a su sección: la pantalla, los términos y el ancla existen', () => {
  const html = fuente(PRIVACIDAD)
  const ancla = RUTA_POLITICA_RENOVACION.split('#')[1]
  assert.ok(ancla)
  assert.match(html, new RegExp(`id="${ancla}"`), `la política ya no tiene el ancla #${ancla}`)
  assert.match(html, /id="pagos-con-tarjeta"/)
  assert.match(fuente(TERMINOS), /href="\/privacy#renovacion-automatica"/, 'los términos ya no enlazan las condiciones')
  assert.match(visible(TERMINOS), /solo se renueva automáticamente[^.]*si lo autorizas expresamente/)
  // La fecha de la política se movió con el cambio.
  for (const ruta of [PRIVACIDAD, TERMINOS]) assert.match(visible(ruta), /Última actualización: octubre de 2026/)
})
