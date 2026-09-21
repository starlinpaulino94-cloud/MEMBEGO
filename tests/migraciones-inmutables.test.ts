/**
 * UNA MIGRACIÓN APLICADA NO SE TOCA.
 *
 * Prisma guarda el SHA-256 de cada `migration.sql` en `_prisma_migrations` al
 * aplicarlo. Si después se edita el archivo —aunque solo sea un comentario— la
 * suma deja de coincidir.
 *
 * QUÉ PASA ENTONCES, COMPROBADO CONTRA PRISMA 6.19.3, porque la respuesta no es
 * la que parece y esta prueba se escribió primero dando por hecha la otra:
 *
 *   · `migrate deploy` → NO se entera. Aplica igual y sale en verde.
 *   · `migrate status` → NO se entera. Dice «up to date».
 *   · `migrate dev`    → SÍ. «The migration X was modified after it was
 *                        applied», y exige `migrate reset`, que BORRA la base.
 *
 * O sea: no rompe el despliegue —eso es lo que se creyó al principio y era
 * falso—, rompe a quien programa. Quien edita el comentario no se entera; el
 * siguiente que cree una migración se encuentra con que Prisma le pide borrar
 * su base de desarrollo para poder seguir.
 *
 * Y hay un daño más callado: el archivo deja de describir lo que de verdad se
 * aplicó. En un repo donde el SQL se aplica a mano —aquí pasa—, ese archivo es
 * lo único que queda como registro de la verdad.
 *
 * El error es fácil de cometer y difícil de ver: el diff parece inofensivo y
 * nada local falla. Pasó el 14-09-2026 corrigiendo un comentario equivocado en
 * `20260905_connect_identidad_externa`; se revirtió y de ahí salió esta prueba.
 *
 * Ejecutar: npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumasEnDisco, sumasSelladas } from '../scripts/sellar-migraciones.mjs'

test('ninguna migración existente cambió de contenido', () => {
  const disco = sumasEnDisco()
  const selladas = sumasSelladas()

  const cambiadas: string[] = []
  for (const [nombre, suma] of selladas) {
    const actual = disco.get(nombre)
    if (actual === undefined) {
      cambiadas.push(`${nombre}: BORRADA — una migración aplicada no se borra`)
    } else if (actual !== suma) {
      cambiadas.push(`${nombre}: EDITADA — su suma ya está grabada en _prisma_migrations`)
    }
  }

  assert.deepEqual(
    cambiadas,
    [],
    'Deshaz la edición: el archivo ya se aplicó en algún entorno y Prisma tiene su suma.\n' +
      'Lo que querías escribir va en migrations_manual/, en docs/ o en una migración nueva.\n' +
      cambiadas.join('\n')
  )
})

test('toda migración nueva está sellada', () => {
  // Sin esto, el cerrojo se podría saltar añadiendo la migración y no sellándola:
  // quedaría fuera de la comparación y editable para siempre.
  const selladas = sumasSelladas()
  const sinSellar = [...sumasEnDisco().keys()].filter((n) => !selladas.has(n))
  assert.deepEqual(sinSellar, [], 'Corre `npm run migraciones:sellar` y revisa el diff')
})
