/**
 * VERIFICACIÓN DE IDENTIDAD · Fase 6 · LA MATRIZ DE ESCENARIOS NO MIENTE.
 *
 * `docs/identidad/FASE-6-PRUEBAS-DE-SEGURIDAD.md` dice, para cada escenario de seguridad que se pidió, qué prueba lo cubre. Una tabla así se
 * pudre en silencio: alguien renombra o borra la prueba y el documento sigue afirmando que está cubierto. Esta prueba lee la tabla y comprueba
 * que cada archivo existe y que cada fragmento citado sigue escrito en él.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const DOC = 'docs/identidad/FASE-6-PRUEBAS-DE-SEGURIDAD.md'

/** Los escenarios que se pidieron, en orden: la matriz debe tener una fila para cada uno. */
const ESCENARIOS_PEDIDOS = [
  'Documento válido',
  'Documento inválido',
  'La selfie no coincide',
  'Prueba de vida fallida',
  'Verificación interrumpida',
  'Sesión expirada',
  'Webhook falso',
  'Webhook duplicado',
  'Eventos fuera de orden',
  'Dos verificaciones simultáneas',
  'Acceso de otra persona o empresa',
  'Solicitud de borrado',
  'Reintento después de un rechazo',
  'Proveedor inaccesible',
  'Persona ya verificada',
]

const filas = readFileSync(join(RAIZ, DOC), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('|'))

test('LA MATRIZ TIENE UNA FILA PARA CADA ESCENARIO PEDIDO, en su orden y con al menos una prueba', () => {
  const matriz = filas.filter((l) => /^\|\s*\d+\s*\|/.test(l))
  assert.equal(matriz.length, ESCENARIOS_PEDIDOS.length)
  matriz.forEach((fila, i) => {
    const celdas = fila.split('|').map((c) => c.trim())
    assert.equal(Number(celdas[1]), i + 1, `la fila ${i + 1} está fuera de orden`)
    assert.ok(celdas[2]!.toLowerCase().startsWith(ESCENARIOS_PEDIDOS[i]!.toLowerCase()), `la fila ${i + 1} debería ser «${ESCENARIOS_PEDIDOS[i]}» y es «${celdas[2]}»`)
    assert.match(celdas[3]!, /`tests\/[^`]+\.test\.ts`\s*«/, `la fila ${i + 1} no cita ninguna prueba`)
  })
})

test('CADA PRUEBA CITADA EXISTE Y SIGUE ESCRITA: el archivo está y contiene cada fragmento', () => {
  const citas: { archivo: string; fragmento: string; fila: string }[] = []
  for (const fila of filas) {
    for (const segmento of fila.split(';')) {
      const archivo = /`(tests\/[^`]+\.test\.ts)`/.exec(segmento)?.[1]
      if (!archivo) continue
      for (const m of segmento.matchAll(/«([^»]+)»/g)) citas.push({ archivo, fragmento: m[1]!, fila: fila.slice(0, 50) })
    }
  }
  assert.ok(citas.length >= 40, `se encontraron ${citas.length} citas`)
  const faltan: string[] = []
  for (const { archivo, fragmento, fila } of citas) {
    if (!existsSync(join(RAIZ, archivo))) {
      faltan.push(`${archivo} no existe (${fila})`)
      continue
    }
    const texto = readFileSync(join(RAIZ, archivo), 'utf8')
    if (!texto.includes(fragmento)) faltan.push(`${archivo}: «${fragmento}»`)
  }
  assert.deepEqual(faltan, [], 'la matriz cita pruebas que ya no están: actualiza el documento o recupera la prueba')
})
