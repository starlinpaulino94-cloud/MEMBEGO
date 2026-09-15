/**
 * UNA TUBERÍA NO PUEDE TRAGARSE UN FALLO.
 *
 * En bash, `cmd | tee archivo` devuelve el estado de `tee`, no el de `cmd`.
 * GitHub corre cada `run:` con `bash -e`, que NO lleva `pipefail`. Resultado:
 * un comando que falla dentro de una tubería sale con 0 y el paso se pone
 * VERDE.
 *
 * No es teórico. El 14-09-2026 «Migrar y desplegar» terminó en verde mientras
 * el log decía `P1001: Can't reach database server`: no migró nada y dijo
 * «✅ Migraciones aplicadas». Es justo el fallo que ese flujo existe para
 * evitar —un check verde con la base sin migrar— colado por una tubería.
 *
 * Esta guardia exige `set -o pipefail` en todo bloque `run:` que canalice
 * hacia `tee`, salvo que la tubería termine en `|| true` (ahí el autor dice
 * explícitamente que el fallo no importa).
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FLUJOS = join(__dirname, '..', '.github', 'workflows')

/** Los bloques `run:` de un flujo, con su número de línea de inicio. */
function bloquesRun(texto: string): { linea: number; cuerpo: string }[] {
  const lineas = texto.split('\n')
  const bloques: { linea: number; cuerpo: string }[] = []

  for (let i = 0; i < lineas.length; i++) {
    const apertura = /^(\s*)-?\s*run:\s*[|>]/.exec(lineas[i]!)
    if (!apertura) continue

    const sangria = apertura[1]!.length
    const cuerpo: string[] = []
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j]!
      // Una línea en blanco no cierra el bloque; una con sangría igual o
      // menor, sí (empieza la siguiente clave o el siguiente paso).
      if (l.trim() !== '' && l.search(/\S/) <= sangria) break
      cuerpo.push(l)
    }
    bloques.push({ linea: i + 1, cuerpo: cuerpo.join('\n') })
  }
  return bloques
}

test('ningún paso canaliza hacia tee sin pipefail', () => {
  const culpables: string[] = []

  for (const archivo of readdirSync(FLUJOS).filter((f) => /\.ya?ml$/.test(f))) {
    const texto = readFileSync(join(FLUJOS, archivo), 'utf8')

    for (const { linea, cuerpo } of bloquesRun(texto)) {
      const tuberias = cuerpo
        .split('\n')
        .filter((l) => /\|\s*tee\b/.test(l) && !/\|\|\s*true\s*$/.test(l.trim()))

      if (tuberias.length > 0 && !/set\s+-o\s+pipefail|set\s+-[a-z]*o?\s*pipefail/.test(cuerpo)) {
        culpables.push(`${archivo}:${linea}`)
      }
    }
  }

  assert.deepEqual(
    culpables,
    [],
    'un `cmd | tee` sin `set -o pipefail` devuelve el estado de tee: el paso sale verde aunque el comando falle'
  )
})

test('el paso que aplica las migraciones declara pipefail', () => {
  const texto = readFileSync(join(FLUJOS, 'deploy-migraciones.yml'), 'utf8')
  const paso = texto.slice(texto.indexOf('Aplicar migraciones pendientes'))

  assert.match(
    paso.slice(0, paso.indexOf('SIN SECRETO')),
    /set -o pipefail/,
    'sin pipefail, un migrate deploy fallido se reporta como «✅ Migraciones aplicadas»'
  )
})
