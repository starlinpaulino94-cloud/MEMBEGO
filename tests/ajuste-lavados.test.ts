import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FUNCIONES_POR_SECCION } from '../src/lib/auth/funciones'

const raiz = join(__dirname, '..')

/** Con los comentarios fuera: una prueba satisfecha por leer la explicación de
 *  lo que vigila no vigila nada. */
function fuente(ruta: string): string {
  return readFileSync(join(raiz, ruta), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const ACCION = 'src/modules/admin/ajusteLavadosActions.ts'

test('la función existe en el catálogo de permisos', () => {
  // Sin esto no se puede conceder ni revocar: quedaría abierta a todo el
  // mundo o cerrada a todos, y las dos cosas son un fallo.
  const membresias = FUNCIONES_POR_SECCION.membresias ?? []
  assert.ok(
    membresias.some((f) => f.codigo === 'ajustar_lavados'),
    'falta `ajustar_lavados` en la sección membresías'
  )
})

test('la acción exige el permiso, no solo ser administrador', () => {
  const src = fuente(ACCION)
  assert.match(src, /requireSection\(\s*'membresias'\s*,\s*'ajustar_lavados'\s*\)/)
})

test('el motivo es obligatorio', () => {
  // Un contador que ve «−2 lavados» sin explicación no puede cuadrar nada.
  const src = fuente(ACCION)
  assert.match(src, /if \(!motivo\)/, 'debe rechazarse un ajuste sin motivo')
})

test('se mueve un DELTA, no se fija un total', () => {
  // «Ponlo en 4» exige saber cuánto había y se equivoca en cuanto dos personas
  // lo tocan a la vez. El total lo calcula el servidor.
  const src = fuente(ACCION)
  assert.match(src, /const despues = antes \+ delta/)
  assert.match(src, /delta === 0/, 'un ajuste de cero no es un ajuste')
})

test('no se puede dejar el saldo en negativo', () => {
  // En el mostrador un saldo negativo no significa nada: el escáner ya
  // rechaza en cero, así que el número solo serviría para confundir.
  const src = fuente(ACCION)
  assert.match(src, /if \(despues < 0\)/)
})

test('la empresa sale de la membresía, nunca del formulario', () => {
  const src = fuente(ACCION)
  assert.doesNotMatch(
    src,
    /formData\.get\(\s*['"]companyId['"]\s*\)/,
    'el navegador no decide sobre qué empresa se escribe'
  )
  assert.match(src, /membership\.companyId !== user\.metadata\.companyId/)
})

test('un plan ilimitado no admite ajuste', () => {
  const src = fuente(ACCION)
  assert.match(src, /esIlimitado/)
})

test('el ajuste queda auditado con antes, después y motivo', () => {
  const src = fuente(ACCION)
  assert.match(src, /AJUSTE_LAVADOS/)
  for (const campo of ['delta', 'antes', 'despues', 'motivo']) {
    assert.match(src, new RegExp(`\\b${campo},`), `el asiento debería guardar \`${campo}\``)
  }
})

test('el comprobante es el asiento de auditoría, no un documento aparte', () => {
  // Si fueran dos cosas podrían discrepar. El número del comprobante ES el id
  // del asiento, así que no hay dos versiones de lo que pasó.
  const src = fuente(ACCION)
  assert.match(src, /comprobanteId/, 'la acción debe devolver el id del asiento')

  const pagina = fuente('src/app/(admin)/admin/membresias/ajuste/[id]/page.tsx')
  assert.match(pagina, /auditLog\.findFirst/, 'el comprobante debe leerse de la bitácora')
})

test('el comprobante no se puede leer desde otra empresa', () => {
  // El id va en la URL: sin `companyId` en el WHERE, bastaría con escribirlo a
  // mano para ver el ajuste de otro negocio.
  const pagina = fuente('src/app/(admin)/admin/membresias/ajuste/[id]/page.tsx')
  assert.match(pagina, /where:\s*\{[^}]*companyId/)
})
