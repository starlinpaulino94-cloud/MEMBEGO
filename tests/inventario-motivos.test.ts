import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLASES_DE_MOTIVO,
  ETIQUETA_CLASE,
  MOTIVOS,
  MOTIVO_DE_CONTEO,
  MOTIVO_OTRO,
  SIN_MOTIVO_CODIFICADO,
  claseDeMovimiento,
  esMotivoDeClase,
  esMotivoDelCatalogo,
  esPerdida,
  etiquetaDeMotivo,
  motivosDeClase,
  resolverMotivo,
  type ClaseDeMotivo,
  type CubetaDeMovimiento,
} from '../src/modules/inventory/motivos'

// ── El catálogo ──────────────────────────────────────────────────────────────

test('el catálogo: códigos únicos con la forma que exige la base, etiquetas que no se repiten y al menos un motivo por clase', () => {
  const codigos = MOTIVOS.map((m) => m.codigo)
  assert.equal(new Set(codigos).size, codigos.length, 'un código repetido')
  for (const c of codigos) assert.match(c, /^[A-Z][A-Z0-9_]{1,39}$/, `«${c}» no tiene la forma de un código (el CHECK de la base lo rechazaría)`)
  const etiquetas = MOTIVOS.map((m) => m.etiqueta)
  assert.equal(new Set(etiquetas).size, etiquetas.length, 'dos motivos con la misma etiqueta no se distinguen en pantalla')
  for (const m of MOTIVOS) {
    assert.ok(m.etiqueta.trim() !== '' && m.ayuda.trim() !== '' && m.clases.length > 0, m.codigo)
    assert.ok(m.etiqueta.length <= 40, `«${m.etiqueta}» es demasiado larga para un selector`)
  }
  for (const clase of CLASES_DE_MOTIVO) {
    assert.ok(motivosDeClase(clase).length >= 3, `${clase} casi no tiene motivos`)
    assert.ok(ETIQUETA_CLASE[clase], clase)
  }
})

test('«Otro» existe en todas las clases y va siempre al final; el motivo del conteo es de faltantes y sobrantes', () => {
  for (const clase of CLASES_DE_MOTIVO) {
    const m = motivosDeClase(clase)
    assert.equal(m.at(-1)?.codigo, MOTIVO_OTRO, `${clase}: «Otro» no va al final`)
  }
  assert.ok(esMotivoDeClase(MOTIVO_DE_CONTEO, 'FALTANTE') && esMotivoDeClase(MOTIVO_DE_CONTEO, 'SOBRANTE'))
  assert.equal(esMotivoDeClase(MOTIVO_DE_CONTEO, 'DANO'), false)
})

test('cada motivo vale solo para lo que explica: un robo no explica un sobrante ni un daño', () => {
  assert.ok(esMotivoDeClase('THEFT', 'FALTANTE'))
  for (const clase of ['SOBRANTE', 'DANO', 'BAJA'] as ClaseDeMotivo[]) assert.equal(esMotivoDeClase('THEFT', clase), false, clase)
  assert.ok(esMotivoDeClase('FOUND', 'SOBRANTE'))
  assert.equal(esMotivoDeClase('FOUND', 'FALTANTE'), false)
  assert.ok(esMotivoDeClase('HANDLING', 'DANO') && esMotivoDeClase('HANDLING', 'BAJA'))
  assert.equal(esMotivoDeClase('HANDLING', 'FALTANTE'), false)
  // Lo que no es un código del catálogo no vale en ninguna clase, venga como venga.
  for (const raro of ['theft', 'THEFT ', 'NO_EXISTE', '', null, undefined, 7, {}, ['THEFT']]) {
    assert.equal(esMotivoDelCatalogo(raro), false, String(raro))
    assert.equal(esMotivoDeClase(raro, 'FALTANTE'), false, String(raro))
  }
})

test('el catálogo por clase: la lista exacta que ven las pantallas, en su orden y con «Otro» al final (no se deduce del propio catálogo)', () => {
  const codigos = (clase: ClaseDeMotivo) => motivosDeClase(clase).map((m) => m.codigo)
  assert.deepEqual(codigos('FALTANTE'), ['EXPIRED', 'THEFT', 'LOST', 'SAMPLE', 'INTERNAL_USE', 'SUPPLIER_RETURN', 'COUNT_DIFFERENCE', 'OTHER'])
  assert.deepEqual(codigos('SOBRANTE'), ['COUNT_DIFFERENCE', 'FOUND', 'ENTRY_ERROR', 'OTHER'])
  assert.deepEqual(codigos('DANO'), ['EXPIRED', 'HANDLING', 'STORAGE', 'TRANSPORT', 'DEFECT', 'OTHER'])
  assert.deepEqual(codigos('BAJA'), ['EXPIRED', 'SUPPLIER_RETURN', 'HANDLING', 'STORAGE', 'TRANSPORT', 'DEFECT', 'OTHER'])
  assert.equal(MOTIVOS.length, 14)
})

test('etiquetaDeMotivo: la del catálogo, el código tal cual si el catálogo ya no lo conoce, y «sin motivo codificado» si no hay', () => {
  assert.equal(etiquetaDeMotivo('EXPIRED'), 'Vencido')
  assert.equal(etiquetaDeMotivo('MOTIVO_RETIRADO'), 'MOTIVO_RETIRADO', 'un código viejo no se esconde')
  for (const nada of [null, undefined, '']) assert.equal(etiquetaDeMotivo(nada), SIN_MOTIVO_CODIFICADO)
})

// ── Qué clase explica cada movimiento ────────────────────────────────────────

const CUBETAS: Array<CubetaDeMovimiento | null> = [null, 'AVAILABLE', 'RESERVED', 'DAMAGED']

test('claseDeMovimiento: ajustes y daños caen en su clase; ventas, entradas, transferencias y reservas no se explican con un motivo', () => {
  assert.equal(claseDeMovimiento({ tipo: 'ADJUSTMENT', origen: null, destino: 'AVAILABLE' }), 'SOBRANTE')
  assert.equal(claseDeMovimiento({ tipo: 'ADJUSTMENT', origen: 'AVAILABLE', destino: null }), 'FALTANTE')
  assert.equal(claseDeMovimiento({ tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: null }), 'BAJA')
  assert.equal(claseDeMovimiento({ tipo: 'ADJUSTMENT', origen: 'DAMAGED', destino: 'AVAILABLE' }), null, 'recuperar lo dañado no es una pérdida')
  assert.equal(claseDeMovimiento({ tipo: 'DAMAGE', origen: 'AVAILABLE', destino: 'DAMAGED' }), 'DANO')
  for (const tipo of ['SALE', 'PURCHASE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESERVATION', 'RESERVATION_RELEASE']) {
    for (const origen of CUBETAS) for (const destino of CUBETAS) assert.equal(claseDeMovimiento({ tipo, origen, destino }), null, `${tipo} ${origen}→${destino}`)
  }
})

test('claseDeMovimiento: todas las combinaciones de cubetas de un ajuste dan una respuesta coherente con lo que entra o sale', () => {
  for (const origen of CUBETAS) {
    for (const destino of CUBETAS) {
      const clase = claseDeMovimiento({ tipo: 'ADJUSTMENT', origen, destino })
      const entraDeFuera = origen === null && destino !== null
      const saleDelInventario = origen !== null && destino === null
      if (entraDeFuera) assert.equal(clase, 'SOBRANTE', `${origen}→${destino}`)
      else if (saleDelInventario) assert.equal(clase, origen === 'DAMAGED' ? 'BAJA' : 'FALTANTE', `${origen}→${destino}`)
      else assert.equal(clase, null, `${origen}→${destino}: no entra ni sale`)
    }
  }
  assert.equal(claseDeMovimiento({ tipo: 'DAMAGE', origen: 'AVAILABLE', destino: null }), null, 'un daño que saliera del inventario no es un daño')
})

test('esPerdida: solo lo que sale del inventario sin venderse; el daño aún está en la sucursal y un sobrante no es pérdida', () => {
  assert.equal(esPerdida('FALTANTE'), true)
  assert.equal(esPerdida('BAJA'), true)
  for (const c of ['SOBRANTE', 'DANO', null] as Array<ClaseDeMotivo | null>) assert.equal(esPerdida(c), false, String(c))
})

// ── Del motivo elegido a lo que se guarda ────────────────────────────────────

test('resolverMotivo con código: se guarda el código y, sin detalle, la etiqueta como texto (el texto nunca queda vacío)', () => {
  assert.deepEqual(resolverMotivo({ clase: 'FALTANTE', codigo: 'EXPIRED', detalle: undefined, textoObligatorio: true }), { ok: true, codigo: 'EXPIRED', texto: 'Vencido' })
  assert.deepEqual(resolverMotivo({ clase: 'FALTANTE', codigo: 'EXPIRED', detalle: '   ', textoObligatorio: true }), { ok: true, codigo: 'EXPIRED', texto: 'Vencido' })
  assert.deepEqual(resolverMotivo({ clase: 'FALTANTE', codigo: 'EXPIRED', detalle: '  lote   12 \n caducó ', textoObligatorio: true }), { ok: true, codigo: 'EXPIRED', texto: 'lote 12 caducó' })
})

test('resolverMotivo: «Otro» exige detalle, un motivo de otra clase o inventado se rechaza, y el detalle largo también', () => {
  const otroSinDetalle = resolverMotivo({ clase: 'DANO', codigo: MOTIVO_OTRO, detalle: '', textoObligatorio: true })
  assert.equal(otroSinDetalle.ok, false)
  assert.match((otroSinDetalle as { error: string }).error, /Otro/)
  assert.deepEqual(resolverMotivo({ clase: 'DANO', codigo: MOTIVO_OTRO, detalle: 'Se mojó con la lluvia', textoObligatorio: true }), { ok: true, codigo: 'OTHER', texto: 'Se mojó con la lluvia' })
  const deOtraClase = resolverMotivo({ clase: 'SOBRANTE', codigo: 'THEFT', textoObligatorio: true })
  assert.equal(deOtraClase.ok, false)
  assert.match((deOtraClase as { error: string }).error, /Robo o hurto.*sobrante/i)
  for (const raro of ['robo', 'NO_EXISTE', 7, {}]) assert.equal(resolverMotivo({ clase: 'FALTANTE', codigo: raro, textoObligatorio: true }).ok, false, String(raro))
  // Un código que el catálogo no conoce se dice como tal (no como «no sirve para esto», que sería explicar algo que no existe).
  for (const raro of ['robo', 'NO_EXISTE', 7, {}]) {
    const r = resolverMotivo({ clase: 'FALTANTE', codigo: raro, textoObligatorio: true })
    assert.deepEqual([r.ok, (r as { codigo: string }).codigo, (r as { error: string }).error], [false, 'MOTIVO_INVALIDO', 'Ese motivo no está en el catálogo.'], String(raro))
  }
  const largo = resolverMotivo({ clase: 'FALTANTE', codigo: 'LOST', detalle: 'x'.repeat(301), textoObligatorio: true })
  assert.equal(largo.ok, false)
  assert.equal(resolverMotivo({ clase: 'FALTANTE', codigo: 'LOST', detalle: 'x'.repeat(300), textoObligatorio: true }).ok, true, '300 caracteres caben')
  assert.equal(resolverMotivo({ clase: 'FALTANTE', codigo: 'LOST', detalle: 12, textoObligatorio: true }).ok, false, 'un detalle que no es texto')
})

test('resolverMotivo sin código: lo exigen las pantallas; los procesos que no eligen siguen con texto libre (obligatorio donde la base lo pide)', () => {
  for (const sinCodigo of [undefined, null, '']) {
    const r = resolverMotivo({ clase: 'FALTANTE', codigo: sinCodigo, detalle: 'algo', exigirCodigo: true, textoObligatorio: true })
    assert.equal(r.ok, false, String(sinCodigo))
    assert.match((r as { error: string }).error, /Elige el motivo/)
  }
  assert.deepEqual(resolverMotivo({ clase: 'FALTANTE', detalle: 'se perdió', textoObligatorio: true }), { ok: true, codigo: null, texto: 'se perdió' })
  const sinNada = resolverMotivo({ clase: 'FALTANTE', textoObligatorio: true })
  assert.equal(sinNada.ok, false)
  assert.equal((sinNada as { codigo: string }).codigo, 'MOTIVO_OBLIGATORIO')
  assert.deepEqual(resolverMotivo({ clase: 'FALTANTE', textoObligatorio: false }), { ok: true, codigo: null, texto: null })
})

test('resolverMotivo: cada motivo del catálogo se acepta en sus clases y se rechaza en las demás', () => {
  for (const m of MOTIVOS) {
    for (const clase of CLASES_DE_MOTIVO) {
      const r = resolverMotivo({ clase, codigo: m.codigo, detalle: 'detalle', textoObligatorio: true })
      assert.equal(r.ok, m.clases.includes(clase), `${m.codigo} en ${clase}`)
    }
  }
})
