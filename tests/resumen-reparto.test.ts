import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GRUPOS, repartir, type TareaConPeso } from '../src/modules/admin/resumen/reparto'

/**
 * LAS CONSULTAS DEL RESUMEN NO SE PONEN EN FILA (auditoría admin · fase 5, tarea 5.1).
 *
 * Todo el Resumen en UNA transacción serializaba sus sentencias: menos consultas pero más espera (medido contra la base de QA:
 * la cabecera pasó de pintarse a los 2 s a los 5,5 s). Se repartieron entre unas pocas transacciones paralelas. Estas pruebas
 * guardan que el reparto es completo, equilibrado y determinista, y que el motor lo usa.
 */

const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const t = (nombre: string, peso: number): TareaConPeso<string> => ({ peso, correr: nombre })
const nombres = (g: TareaConPeso<string>[][]) => g.map((x) => x.map((y) => y.correr))

// Las tareas del administrador, con los pesos que declara `consultas.ts` (pagos 6, ingresos 2, el resto 1).
const ADMIN = [
  t('pagos', 6), t('membresias', 1), t('vencen', 1), t('riesgo', 1), t('citas', 1), t('empleados', 1),
  t('ingresos', 2), t('clientesNuevos', 1), t('visitas', 1), t('registros', 1),
]

test('cada tarea cae en un grupo y solo en uno: no se pierde ni se repite ninguna consulta', () => {
  const grupos = repartir(ADMIN)
  const todas = nombres(grupos).flat().sort()
  assert.deepEqual(todas, ADMIN.map((x) => x.correr).sort())
  assert.equal(new Set(todas).size, ADMIN.length)
})

test('hay como mucho GRUPOS transacciones a la vez, y ninguna vacía', () => {
  const grupos = repartir(ADMIN)
  assert.ok(grupos.length <= GRUPOS)
  assert.equal(grupos.length, GRUPOS, 'con diez tareas se usan los cinco grupos')
  for (const g of grupos) assert.ok(g.length > 0)
})

test('el grupo más cargado es el de la tarea más pesada: el tiempo de pared no crece por el reparto', () => {
  const grupos = repartir(ADMIN)
  const cargas = grupos.map((g) => g.reduce((s, x) => s + x.peso, 0))
  // La más pesada (pagos, 6) va sola o con muy poco: el resto de grupos queda por debajo de ella.
  assert.equal(Math.max(...cargas), 6)
  assert.deepEqual(grupos[0]!.map((x) => x.correr), ['pagos'])
  // Y la suma de todo no cambia: el reparto mueve las tareas de sitio, no las quita.
  assert.equal(cargas.reduce((s, c) => s + c, 0), ADMIN.reduce((s, x) => s + x.peso, 0))
})

test('es determinista: el mismo conjunto de tareas da siempre los mismos grupos, y los empates mantienen el orden', () => {
  assert.deepEqual(nombres(repartir(ADMIN)), nombres(repartir([...ADMIN])))
  const iguales = [t('a', 1), t('b', 1), t('c', 1)]
  assert.deepEqual(nombres(repartir(iguales, 2)), [['a', 'c'], ['b']])
})

test('con menos tareas que grupos no se abren transacciones vacías; sin tareas, ninguna', () => {
  assert.deepEqual(nombres(repartir([t('x', 1), t('y', 1)])), [['x'], ['y']])
  assert.deepEqual(repartir([]), [])
  // Un rol acotado (Marketing) pide muy poco: no paga transacciones de más.
  assert.equal(repartir([t('riesgo', 1), t('promos', 1), t('seguidores', 1), t('lider', 1)]).length, 4)
})

test('el motor usa el reparto: una transacción por grupo, no una sola para todo', () => {
  const motor = sinComentarios(readFileSync('src/modules/admin/resumen/consultas.ts', 'utf8'))
  assert.match(motor, /repartir\(tareas\)\.map\(\(grupo\) =>\s*conEmpresa\(companyId,/)
  assert.equal((motor.match(/conEmpresa\(/g) ?? []).length, 1, 'una única llamada, dentro del reparto')
  // Cada tarea declara su peso y recibe SU transacción; ninguna usa el `tx` de otra.
  assert.equal((motor.match(/tarea\(\d+, async \(tx\) =>/g) ?? []).length, 13)
  assert.doesNotMatch(motor, /tarea\(async \(\) =>/)
})
