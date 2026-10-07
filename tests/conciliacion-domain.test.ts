import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ETIQUETA_GRUPO, ETIQUETA_SEVERIDAD, ORDEN_DE_GRUPOS, REGLAS, ordenarHallazgos, resumirConciliacion, type Hallazgo, type Regla } from '../src/modules/conciliacion/domain'

/** CONCILIACIÓN · el catálogo de reglas y su resumen son puros (Fase 9). Lo que cada regla encuentra en la base está en `tests/postgres/conciliacion.db.test.ts`. */

const regla = (codigo: string, severidad: Regla['severidad']): Regla => ({ codigo, grupo: 'PAGOS', severidad, titulo: codigo, queEs: '', queHacer: '' })
const h = (codigo: string, severidad: Regla['severidad'], total: number): Hallazgo => ({ regla: regla(codigo, severidad), total, muestra: [] })

test('cada regla tiene un código único, un grupo conocido, una severidad válida y explica qué es y qué hacer', () => {
  assert.equal(new Set(REGLAS.map((r) => r.codigo)).size, REGLAS.length)
  for (const r of REGLAS) {
    assert.match(r.codigo, /^[A-Z]\d{2}$/, r.codigo)
    assert.ok(r.grupo in ETIQUETA_GRUPO, r.codigo)
    assert.ok(r.severidad in ETIQUETA_SEVERIDAD, r.codigo)
    assert.ok(r.titulo.length > 10 && r.queEs.length > 30 && r.queHacer.length > 10, `${r.codigo} sin explicación`)
  }
})

test('el orden de los grupos los cubre todos, una vez, y todas las reglas caen en un grupo que se enseña', () => {
  assert.deepEqual([...ORDEN_DE_GRUPOS].sort(), Object.keys(ETIQUETA_GRUPO).sort())
  for (const r of REGLAS) assert.ok(ORDEN_DE_GRUPOS.includes(r.grupo), r.codigo)
})

test('el código de una regla empieza con la letra de su grupo (se lee de un vistazo)', () => {
  const letra: Record<string, string> = { PEDIDOS_Y_COMISIONES: 'C', PAGOS: 'P', RENGLONES: 'L', EXISTENCIAS: 'I', LIBRO: 'G', OFERTAS: 'O' }
  for (const r of REGLAS) assert.equal(r.codigo[0], letra[r.grupo], r.codigo)
})

test('el resumen cuenta reglas con hallazgos, casos y casos por severidad', () => {
  const r = resumirConciliacion([h('A01', 'ALTA', 3), h('A02', 'ALTA', 0), h('M01', 'MEDIA', 2), h('B01', 'BAJA', 1)])
  assert.deepEqual(r, { reglas: 4, reglasConHallazgos: 3, casos: 6, porSeveridad: { ALTA: 3, MEDIA: 2, BAJA: 1 } })
  assert.deepEqual(resumirConciliacion([]), { reglas: 0, reglasConHallazgos: 0, casos: 0, porSeveridad: { ALTA: 0, MEDIA: 0, BAJA: 0 } })
})

test('los hallazgos se ordenan por gravedad, luego por casos, luego por código; sin tocar la lista original', () => {
  const original = [h('B01', 'BAJA', 9), h('M01', 'MEDIA', 1), h('A02', 'ALTA', 1), h('A01', 'ALTA', 5), h('A03', 'ALTA', 1)]
  const copia = [...original]
  assert.deepEqual(ordenarHallazgos(original).map((x) => x.regla.codigo), ['A01', 'A02', 'A03', 'M01', 'B01'])
  assert.deepEqual(original, copia)
})
