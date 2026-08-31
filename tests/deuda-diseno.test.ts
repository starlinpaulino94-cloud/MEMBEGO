import { test } from 'node:test'
import assert from 'node:assert/strict'
// `.mjs` sin tipos: se declara la forma que devuelve.
import {
  auditar as auditarSinTipar,
  auditarPaquete as auditarPaqueteSinTipar,
  MEDIDAS as MEDIDAS_SIN_TIPAR,
} from '../scripts/auditar-diseno.mjs'

const auditar = auditarSinTipar as () => Record<string, number>
const auditarPaquete = auditarPaqueteSinTipar as () => Record<string, number>
const MEDIDAS = MEDIDAS_SIN_TIPAR as Record<string, { que: string; porque: string }>

/**
 * LA DEUDA DE DISEÑO SOLO PUEDE BAJAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ TECHOS Y NO CEROS
 *
 * Poner cero en todo hoy dejaría la suite roja hasta que alguien migre
 * seiscientos usos, y una suite que lleva semanas en rojo se ignora entera —
 * incluidas las pruebas que sí importan.
 *
 * Un techo hace lo único que hace falta ahora: que la deuda no CREZCA mientras
 * se migra módulo a módulo. Cada fase baja los suyos y el número queda escrito
 * aquí, así que el progreso es visible sin tener que medirlo a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS NÚMEROS SALEN DEL AUDITOR, NO SE COPIAN
 *
 * Esta prueba importa `scripts/auditar-diseno.mjs` en vez de repetir sus
 * expresiones. Duplicadas, la prueba y el informe acabarían contando cosas
 * distintas y nadie sabría cuál mirar.
 */

/**
 * Los techos, medidos el día que se cerró la Fase 1.
 *
 * Bajar uno: cámbialo aquí en el mismo commit que lo baja. Subir uno: no.
 */
const TECHOS: Record<string, number> = {
  hexEnInterfaz: 121,
  colorCrudo: 170,
  radiosFuera: 0,
  microTextos: 0,
  sombrasArbitrarias: 0,
  duracionesSueltas: 0,
  zIndexSueltos: 5,
}

test('ninguna deuda de diseño crece', () => {
  const hoy = auditar()
  const subidas: string[] = []

  for (const [clave, techo] of Object.entries(TECHOS)) {
    const actual = hoy[clave]
    assert.equal(typeof actual, 'number', `el auditor no midió \`${clave}\``)
    if (actual > techo) {
      subidas.push(
        `· ${MEDIDAS[clave].que}: ${actual} (techo ${techo}, +${actual - techo})\n` +
          `    ${MEDIDAS[clave].porque}`
      )
    }
  }

  assert.deepEqual(
    subidas,
    [],
    'La deuda de diseño creció:\n' +
      subidas.join('\n') +
      '\n\n  Se mide con `node scripts/auditar-diseno.mjs`.'
  )
})

test('los techos no se quedan por encima de la realidad', () => {
  // Un techo muy por encima del número real deja de proteger sin que se note:
  // se puede añadir deuda hasta llenarlo y la prueba sigue en verde. Cuando
  // una fase baja un número, este aviso obliga a bajar también su techo.
  const hoy = auditar()
  const holgados = Object.entries(TECHOS)
    .filter(([clave, techo]) => techo - hoy[clave] > 10)
    .map(([clave, techo]) => `· ${MEDIDAS[clave].que}: techo ${techo}, real ${hoy[clave]}`)

  assert.deepEqual(
    holgados,
    [],
    'Hay techos con mucha holgura. Bájalos al número real:\n' + holgados.join('\n')
  )
})

/**
 * EL PAQUETE ES DISTINTO: SU DEUDA SE REPARTE.
 *
 * `@membego/ui` es lo que un satélite instalaría. Un color crudo dentro no es
 * una infracción más: es la misma infracción entregada a cada sistema nuevo que
 * se conecte, sin que su equipo la haya escrito ni pueda quitarla.
 *
 * Por eso tiene techo propio y más apretado que el del producto.
 */
const TECHOS_PAQUETE: Record<string, number> = {
  colorCrudo: 37,
  radiosFuera: 0,
}

test('la deuda de @membego/ui no crece', () => {
  const hoy = auditarPaquete()
  for (const [clave, techo] of Object.entries(TECHOS_PAQUETE)) {
    assert.ok(
      hoy[clave] <= techo,
      `\`${clave}\` en @membego/ui subió a ${hoy[clave]} (techo ${techo}). ` +
        'Es lo que se reparte a cada satélite: la deuda de aquí no la escribe ' +
        'quien la sufre.'
    )
  }
})
