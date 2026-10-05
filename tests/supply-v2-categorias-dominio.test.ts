import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  casarCategoria,
  esDesajusteDeConfiguracion,
  ORIGEN_CATEGORIA_LABEL,
  type CategoriaDePlataforma,
  type OrigenCategoria,
} from '../src/modules/supply-v2/core/categorias'

/** El catálogo de plataforma tal como lo deja la semilla. */
const CATALOGO: CategoriaDePlataforma[] = [
  { id: 'c1', code: 'SEDAN', nombre: 'Sedán', nivelTarifario: 1, activo: true },
  { id: 'c2', code: 'SUV', nombre: 'SUV', nivelTarifario: 2, activo: true },
  { id: 'c3', code: 'PICKUP', nombre: 'Pickup', nivelTarifario: 3, activo: true },
  { id: 'c4', code: 'COMERCIAL', nombre: 'Comercial', nivelTarifario: 4, activo: true },
]

test('casarCategoria · un nivel que existe resuelve a su categoría', () => {
  for (const c of CATALOGO) {
    const r = casarCategoria(CATALOGO, c.nivelTarifario)
    assert.equal(r.origen, 'EXACTA')
    assert.equal(r.categoria?.code, c.code)
  }
})

test('casarCategoria · GANA EL NIVEL, aunque los nombres digan lo contrario', () => {
  // Esta es la prueba que justifica todo el diseño. Las empresas nombran sus
  // categorías como quieren: una llama «Sedán» a lo que pone en nivel 3 y
  // «Camión» a lo que pone en nivel 1. Si se comparara el nombre, el camión
  // cobraría como sedán. Se compara el número, y el número manda.
  const alReves: CategoriaDePlataforma[] = [
    { id: 'x1', code: 'SEDAN', nombre: 'Camión', nivelTarifario: 1, activo: true },
    { id: 'x2', code: 'SUV', nombre: 'Sedán', nivelTarifario: 2, activo: true },
  ]
  // El vehículo de la empresa está en nivel 2. Le toca la fila de nivel 2,
  // que se llama «Sedán» pero es la del código SUV. El nombre es decoración.
  const r = casarCategoria(alReves, 2)
  assert.equal(r.origen, 'EXACTA')
  assert.equal(r.categoria?.code, 'SUV', 'resuelve por nivel, no por el nombre «Sedán»')
  assert.equal(r.categoria?.nombre, 'Sedán')
})

test('casarCategoria · sin nivel se distingue POR QUÉ no lo hay', () => {
  // Los dos casos devuelven el precio base, pero no son el mismo problema: uno
  // se arregla pidiéndole el carro al cliente, el otro asignando categoría a un
  // vehículo que ya existe. Colapsarlos perdería esa diferencia.
  assert.deepEqual(casarCategoria(CATALOGO, null), { categoria: null, origen: 'SIN_VEHICULO' })
  assert.deepEqual(casarCategoria(CATALOGO, null, 'SIN_CATEGORIA'), { categoria: null, origen: 'SIN_CATEGORIA' })
})

test('casarCategoria · un nivel sin correspondencia NO redondea: cae al base y lo dice', () => {
  // Nivel 7 no está en el catálogo. Redondear a 4 (hacia abajo) cobraría de
  // menos en silencio; redondear hacia arriba sorprendería al cliente con un
  // precio que nadie configuró para su vehículo. Se cae al base, que es el
  // precio que la oferta publicó, y queda el motivo para arreglarlo.
  const r = casarCategoria(CATALOGO, 7)
  assert.equal(r.categoria, null)
  assert.equal(r.origen, 'SIN_CORRESPONDENCIA')

  // Y tampoco se parece al vecino por debajo aunque exista.
  assert.equal(casarCategoria(CATALOGO, 5).categoria, null)
  // El 0 y los negativos son datos corruptos, no «antes del sedán».
  assert.equal(casarCategoria(CATALOGO, 0).origen, 'SIN_CORRESPONDENCIA')
  assert.equal(casarCategoria(CATALOGO, -1).origen, 'SIN_CORRESPONDENCIA')
})

test('casarCategoria · una categoría desactivada no cobra, ni siquiera por su nivel', () => {
  // Dar de baja una categoría tiene que dejar de cobrar por ella. Si siguiera
  // resolviendo, desactivarla no serviría de nada y el precio saldría de una
  // fila que el operador creía retirada.
  const conBaja: CategoriaDePlataforma[] = [
    { id: 'c1', code: 'SEDAN', nombre: 'Sedán', nivelTarifario: 1, activo: true },
    { id: 'c2', code: 'SUV', nombre: 'SUV', nivelTarifario: 2, activo: false },
  ]
  const r = casarCategoria(conBaja, 2)
  assert.equal(r.categoria, null)
  assert.equal(r.origen, 'SIN_CORRESPONDENCIA', 'desactivada cuenta como que ese nivel no está mapeado')
  // La activa del mismo catálogo sigue funcionando.
  assert.equal(casarCategoria(conBaja, 1).categoria?.code, 'SEDAN')
})

test('casarCategoria · un catálogo vacío no explota: todo cae al base', () => {
  // Es el estado del día 1, antes de la semilla, y el de una base recién
  // migrada. Nada debe reventar: toda oferta cobra como hoy.
  assert.deepEqual(casarCategoria([], 2), { categoria: null, origen: 'SIN_CORRESPONDENCIA' })
  assert.deepEqual(casarCategoria([], null), { categoria: null, origen: 'SIN_VEHICULO' })
})

test('esDesajusteDeConfiguracion · solo SIN_CORRESPONDENCIA señala algo que arreglar', () => {
  // Comprar sin habernos dicho qué carro tienes es normal y frecuente, y nunca
  // debe impedir una compra; tratarlo como una alarma llenaría el informe de
  // ruido y escondería el caso que sí importa.
  assert.equal(esDesajusteDeConfiguracion('SIN_CORRESPONDENCIA'), true)
  assert.equal(esDesajusteDeConfiguracion('SIN_VEHICULO'), false)
  assert.equal(esDesajusteDeConfiguracion('SIN_CATEGORIA'), false)
  assert.equal(esDesajusteDeConfiguracion('EXACTA'), false)
})

test('ORIGEN_CATEGORIA_LABEL · todo origen tiene texto, incluido uno que se añada mañana', () => {
  // Mismo guardia que la bitácora: un origen sin etiqueta sale en la pantalla
  // como un enum crudo, y nadie sabe qué significa «SIN_CORRESPONDENCIA».
  const origenes: OrigenCategoria[] = ['EXACTA', 'SIN_VEHICULO', 'SIN_CATEGORIA', 'SIN_CORRESPONDENCIA']
  for (const o of origenes) {
    const etiqueta = ORIGEN_CATEGORIA_LABEL[o]
    assert.ok(etiqueta && etiqueta.trim().length > 0, `${o} necesita etiqueta`)
    assert.notEqual(etiqueta, o, `${o} tiene el enum como etiqueta`)
  }
  assert.equal(Object.keys(ORIGEN_CATEGORIA_LABEL).length, origenes.length, 'hay un origen sin probar')
})
