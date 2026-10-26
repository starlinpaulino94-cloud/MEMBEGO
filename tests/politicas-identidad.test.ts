/**
 * LA POLÍTICA PUBLICADA (/privacy § 7) DICE LO QUE EL SISTEMA HACE.
 *
 * Los tres permisos que la persona marca antes de verificarse son cortos a propósito y remiten a la sección
 * «Verificación de identidad» de la política: lo que ahí se promete es lo que la persona acepta. Si alguien cambia el
 * plazo (`POLITICA_IDENTIDAD`), la información que ve la persona (`puntosDePrivacidad`) o los textos de consentimiento, y
 * no cambia la política pública —o al revés—, la persona aceptó una cosa y el sistema hace otra. Estas pruebas lo impiden,
 * igual que `tests/politicas-pagos.test.ts` lo hace con los pagos.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLITICA_IDENTIDAD } from '../src/modules/identidad/identidadCore'
import {
  RUTA_POLITICA_IDENTIDAD,
  TIPOS_CONSENTIMIENTO_IDENTIDAD,
  VERSION_VIGENTE,
  renderizarTextoIdentidad,
} from '../src/modules/identidad/identidadConsentimientosCore'
import { puntosDePrivacidad } from '../src/modules/identidad/vistaCore'

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
const seccion = visible(PRIVACIDAD).slice(visible(PRIVACIDAD).indexOf('7. Verificación de identidad'))

const EN_LETRAS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
const numero = (palabra: string) => EN_LETRAS[palabra.toLowerCase()] ?? Number(palabra)

test('la sección existe, con el ancla a la que apuntan los textos de consentimiento', () => {
  assert.equal(RUTA_POLITICA_IDENTIDAD, '/privacy#verificacion-identidad')
  assert.match(fuente(PRIVACIDAD), /id="verificacion-identidad"/)
  assert.ok(seccion.startsWith('7. Verificación de identidad'), 'la sección 7 no se encontró')
  for (const sub of ['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7']) assert.match(seccion, new RegExp(sub), sub)
})

test('el PLAZO publicado es el del sistema («3 años» = POLITICA_IDENTIDAD.validezMeses / 12)', () => {
  const m = seccion.match(/durante (\w+) años/)
  assert.ok(m, 'la política ya no dice cuántos años se conserva el resultado')
  assert.equal(numero(m![1]), POLITICA_IDENTIDAD.validezMeses / 12)
  // Y el mismo plazo que le dicen los textos de consentimiento y la pantalla.
  assert.match(renderizarTextoIdentidad(VERSION_VIGENTE.IDENTIDAD_BIOMETRIA), new RegExp(`durante ${POLITICA_IDENTIDAD.validezMeses / 12} años`))
  assert.match(puntosDePrivacidad().join(' '), new RegExp(`durante ${POLITICA_IDENTIDAD.validezMeses / 12} años`))
})

test('lo que se le dice a la persona en la pantalla está publicado en la política', () => {
  // Cada afirmación de la pantalla tiene su equivalente en /privacy §7.
  const equivalencias: [string, RegExp][] = [
    ['el proveedor y dónde procesa', /Didit[\s\S]*Unión Europea/],
    ['el proveedor elimina imágenes y datos biométricos', /Didit elimina las imágenes y los datos biométricos al concluir/],
    ['se conserva solo el resultado', /conserva solo el resultado: si estás verificado, el nivel y la fecha/],
    ['los negocios solo ven verificado y desde cuándo, si la persona lo permite', /solo ven que estás verificado y desde cuándo, y únicamente si tú lo permites/],
    ['nunca ven cédula ni selfie', /Nunca ven tu cédula, tu selfie ni tu número de documento/],
    ['la finalidad', /únicamente para comprobar que eres el titular del documento y prevenir el fraude y el robo de identidad/],
    ['es opcional y no condiciona compras ni membresías', /opcional[\s\S]*no hace falta para comprar ni para usar tus membresías/],
    ['se puede borrar desde el perfil', /borremos tus datos de verificación en cualquier momento desde la pantalla de verificación de tu perfil/],
    ['eliminar la cuenta borra también en el proveedor', /Si eliminas tu cuenta, tus datos de verificación también se borran, en MembeGo y en Didit/],
  ]
  for (const [que, regex] of equivalencias) assert.match(seccion, regex, `la política no dice: ${que}`)
})

test('la política describe los TRES permisos que la pantalla pide, ninguno marcado de antemano, y que se retiran', () => {
  assert.equal(TIPOS_CONSENTIMIENTO_IDENTIDAD.length, 3)
  assert.match(seccion, /tres permisos, cada uno con su casilla y ninguna marcada de antemano/)
  assert.match(seccion, /\(1\) capturar tu cédula y tu selfie y generar los datos biométricos/)
  assert.match(seccion, /\(2\) que Didit los procese en la Unión Europea/)
  assert.match(seccion, /\(3\), opcional, que los negocios vean que estás verificado/)
  assert.match(seccion, /retirar cualquiera cuando quieras/)
  assert.match(seccion, /Si retiras el primero, se cancela la verificación en curso/)
  // Y la pantalla de verdad no marca nada de antemano.
  const pantalla = fuente('src/components/cliente/identidad/VerificacionIdentidad.tsx')
  assert.doesNotMatch(pantalla, /defaultChecked|checked=\{true\}/, 'una casilla de consentimiento no puede venir marcada')
  assert.match(pantalla, /useState<Record<string, boolean>>\(\{\}\)/, 'todas las casillas empiezan sin marcar')
})

test('la política no promete lo que el sistema no hace', () => {
  for (const [regex, motivo] of [
    [/garantiz/i, 'garantías'],
    [/100 ?%/, 'porcentajes absolutos'],
    [/nunca (se )?comparte/i, '«nunca se comparte»'],
    [/conservamos (tu|la|las) (foto|selfie|cédula|imágenes)/i, 'conservar imágenes'],
    [/publicidad (personalizada|dirigida)/i, 'uso publicitario'],
  ] as const) {
    assert.doesNotMatch(seccion, regex, motivo)
  }
  // Lo que sí dice: la identidad no es precondición de nada.
  assert.match(seccion, /opcional/)
})

test('la sección sigue a «Tus derechos» sin romper la numeración de los pagos, y la fecha de actualización no se movió sola', () => {
  const texto = visible(PRIVACIDAD)
  assert.ok(texto.indexOf('6. Tus derechos') < texto.indexOf('7. Verificación de identidad'))
  assert.ok(texto.indexOf('5. Pagos con tarjeta') < texto.indexOf('6. Tus derechos'))
  assert.match(texto, /Última actualización: octubre de 2026/)
  assert.match(visible(TERMINOS), /Última actualización: octubre de 2026/)
  // La retención al eliminar la cuenta remite a la sección.
  assert.match(texto, /Si verificaste tu identidad, también borramos tu resultado de verificación y los datos que tenga el proveedor \(sección 7\)/)
})

test('las pantallas de eliminar cuenta dicen que también se borra la verificación', () => {
  assert.match(visible('src/app/(public)/eliminar-cuenta/page.tsx'), /Si verificaste tu identidad, también borraremos tu resultado de verificación y los datos que guarde nuestro proveedor/)
  assert.match(visible('src/app/(public)/eliminar-cuenta/confirmar/page.tsx'), /Si verificaste tu identidad, también se borran tu resultado y los datos que guarde nuestro proveedor/)
})
