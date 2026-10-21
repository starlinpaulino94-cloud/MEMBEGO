import { test } from 'node:test'
import assert from 'node:assert/strict'
// `.mjs` sin tipos: se declara la forma que devuelve.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import {
  auditar as auditarSinTipar,
  auditarPaquete as auditarPaqueteSinTipar,
  MEDIDAS as MEDIDAS_SIN_TIPAR,
  PRIMITIVAS_EN_ESPERA as PRIMITIVAS_EN_ESPERA_SIN_TIPAR,
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
  // 121 al cerrar la Fase 1; 114 tras el sprint de cierre (2026-10-08): la fusión de la app
  // Expo había subido a 129 y se devolvieron a su sitio (correo a `lib/email`, color de marca
  // por defecto en un solo módulo, texto de ayuda sin hex, botones `destructive`).
  hexEnInterfaz: 111,
  colorCrudo: 147,
  radiosFuera: 0,
  microTextos: 0,
  sombrasArbitrarias: 0,
  duracionesSueltas: 0,
  zIndexSueltos: 5,

  // Fase 2 de la auditoría del panel (docs/auditoria-admin · 12, tarea 2.4): medidas NUEVAS, con el techo que tenían el 2026-10-20 sobre
  // `origin/main` (4243a0f8). Las cifras del informe 07 se midieron sobre un código anterior y ya no coinciden (p. ej. las variables
  // con hex de `globals.css` pasaron de 31 a 65): el techo es el de hoy, no el del informe. Cada fase de rediseño baja los suyos aquí
  // mismo, en el commit que los baja.
  h1Crudo: 39,
  botonCrudo: 39,
  titulo2xlBold: 26,
  tarjetaLocal: 22,
  tablaCruda: 51,
  // Fase 7: la misma deuda en las carpetas de módulos que `PREFIJOS_DE_PANEL` no recorre. Medida el 2026-10-21 (al migrar Reservas).
  tablaCrudaEnModulos: 32,
  variablesHexEnGlobalsCss: 65,
  mapasDeEstado: 58,
  componentesSinUso: 15,

  // Fase 4 (tarea 4.10): accesibilidad del panel, medida el 2026-10-20 (FE-13). Las dos son CANDIDATOS: se cuenta lo que puede
  // dejar a alguien sin nombre o sin foco, y bajarlas es abrir la tarea, no cerrarla (el tipo de `Button` que exija `aria-label`
  // las resuelve de raíz en la fase 7).
  botonIconoSinNombre: 13,
  outlineSinFoco: 20,
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

/**
 * LAS PRIMITIVAS EN ESPERA SOLO PUEDEN SALIR DE LA LISTA (fase 4).
 *
 * `Campo`, `Tabla`, `BarraFiltros`, `NavSeccion`, `SelectorColor` y `BarrasSimples` existen desde la fase 4 y todavía no
 * tienen consumidor: es lo que la fase pide. Mientras esperan no cuentan como «componentes sin uso» (si no, construirlas sería
 * subir un techo). Pero la espera no puede ser eterna ni silenciosa: en cuanto una tiene un importador, esta prueba exige
 * sacarla de la lista, y la lista nunca gana nombres sin que se vea en la revisión.
 */
const PRIMITIVAS_EN_ESPERA = PRIMITIVAS_EN_ESPERA_SIN_TIPAR as Set<string>

function codigoFuente(): { ruta: string; src: string }[] {
  const acc: { ruta: string; src: string }[] = []
  const recorre = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) recorre(p)
      else if (/\.tsx?$/.test(p)) acc.push({ ruta: p.split(sep).join('/'), src: readFileSync(p, 'utf8') })
    }
  }
  recorre('src')
  recorre('packages/ui/src')
  return acc
}

test('cada primitiva en espera existe y todavía no tiene importador (si ya lo tiene, sácala de la lista)', () => {
  const fuentes = codigoFuente()
  for (const nombre of PRIMITIVAS_EN_ESPERA) {
    assert.ok(existsSync(join('packages/ui/src/ui', `${nombre}.tsx`)), `${nombre}: está en la lista pero el archivo no existe`)
    const re = new RegExp(String.raw`['"](?:@/components/ui/|@membego/ui/ui/|\./|\.\./ui/)${nombre}['"]`)
    const importadores = fuentes.filter((f) => f.ruta !== `packages/ui/src/ui/${nombre}.tsx` && re.test(f.src)).map((f) => f.ruta)
    assert.deepEqual(
      importadores,
      [],
      `${nombre} ya tiene consumidor: quítala de PRIMITIVAS_EN_ESPERA en scripts/auditar-diseno.mjs para que cuente como componente en uso.`
    )
  }
})
