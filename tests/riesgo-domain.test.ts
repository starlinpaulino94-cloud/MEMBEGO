import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UMBRALES, evaluarCliente, evaluarEmpresa, ordenarSenales, resumirRiesgo, type MetricasDeCliente, type MetricasDeEmpresa } from '../src/modules/riesgo-comercio/domain'

/** RIESGO · umbrales y señales puros (Fase 9). Lo que miden las consultas contra la base está en `tests/postgres/riesgo.db.test.ts`. */

const empresa = (o: Partial<MetricasDeEmpresa> = {}): MetricasDeEmpresa => ({
  companyId: 'e1', empresa: 'Empresa Uno', pedidos: 0, cancelados: 0, completados: 0, reembolsados: 0, sinAtender: 0, conAjusteGrande: 0, saldo: null, limiteDeCredito: null, estadoDeCuenta: null, ...o,
})
const cliente = (o: Partial<MetricasDeCliente> = {}): MetricasDeCliente => ({ clave: 'c1', nombre: 'Ana', correo: 'ana@x.test', empresas: 1, pedidos: 0, cancelados: 0, cuponesVencidos: 0, pedidosEnUnDia: 0, ...o })
const tipos = (s: { tipo: string; severidad: string }[]) => s.map((x) => `${x.tipo}:${x.severidad}`)

test('una empresa sin nada raro no da señales', () => {
  assert.deepEqual(evaluarEmpresa(empresa()), [])
  assert.deepEqual(evaluarEmpresa(empresa({ pedidos: 40, completados: 36, cancelados: 3, reembolsados: 1 })), [])
})

test('las cancelaciones: media desde el 30 %, alta desde el 50 %, y SOLO con el mínimo de pedidos', () => {
  const n = UMBRALES.minimoDePedidos
  assert.deepEqual(evaluarEmpresa(empresa({ pedidos: n - 1, cancelados: n - 1 })), [], 'con menos del mínimo no hay tasa')
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ pedidos: 10, cancelados: 3 }))), ['EMPRESA_CANCELA_MUCHO:MEDIA'])
  assert.deepEqual(evaluarEmpresa(empresa({ pedidos: 10, cancelados: 2 })), [])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ pedidos: 10, cancelados: 5 }))), ['EMPRESA_CANCELA_MUCHO:ALTA'])
})

test('los reembolsos se miden sobre lo cerrado: media desde el 10 %, alta desde el 20 %', () => {
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ completados: 9, reembolsados: 1 }))), ['EMPRESA_REEMBOLSA_MUCHO:MEDIA'])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ completados: 8, reembolsados: 2 }))), ['EMPRESA_REEMBOLSA_MUCHO:ALTA'])
  assert.deepEqual(evaluarEmpresa(empresa({ completados: 3, reembolsados: 1 })), [], 'cuatro cerrados no son una tasa')
  assert.deepEqual(evaluarEmpresa(empresa({ completados: 19, reembolsados: 1 })), [], '5 % es normal')
})

test('los pedidos sin atender no necesitan mínimo: 3 es media, 8 es alta', () => {
  assert.deepEqual(evaluarEmpresa(empresa({ sinAtender: 2 })), [])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ sinAtender: 3 }))), ['EMPRESA_NO_RESPONDE:MEDIA'])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ sinAtender: 8 }))), ['EMPRESA_NO_RESPONDE:ALTA'])
})

test('los ajustes grandes: media desde el 20 % de los pedidos, alta desde el 40 %, con el mínimo', () => {
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ pedidos: 10, conAjusteGrande: 2 }))), ['EMPRESA_AJUSTA_MUCHO:MEDIA'])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ pedidos: 10, conAjusteGrande: 4 }))), ['EMPRESA_AJUSTA_MUCHO:ALTA'])
  assert.deepEqual(evaluarEmpresa(empresa({ pedidos: 4, conAjusteGrande: 4 })), [])
  assert.deepEqual(evaluarEmpresa(empresa({ pedidos: 10, conAjusteGrande: 1 })), [])
})

test('el crédito: media desde el 80 % del límite, alta al 100 %; sin deuda o sin límite no hay señal', () => {
  assert.deepEqual(evaluarEmpresa(empresa({ saldo: 700, limiteDeCredito: 1000 })), [])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ saldo: 800, limiteDeCredito: 1000 }))), ['EMPRESA_CREDITO_AL_LIMITE:MEDIA'])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ saldo: 1000, limiteDeCredito: 1000 }))), ['EMPRESA_CREDITO_AL_LIMITE:ALTA'])
  assert.deepEqual(evaluarEmpresa(empresa({ saldo: -500, limiteDeCredito: 1000 })), [], 'un saldo a favor no es riesgo')
  assert.deepEqual(evaluarEmpresa(empresa({ saldo: 500, limiteDeCredito: 0 })), [], 'sin límite no se divide')
  assert.deepEqual(evaluarEmpresa(empresa({ saldo: null, limiteDeCredito: null })), [])
})

test('una cuenta en gracia o suspendida es señal alta, una activa no', () => {
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ estadoDeCuenta: 'GRACE_PERIOD' }))), ['EMPRESA_CUENTA_RESTRINGIDA:ALTA'])
  assert.deepEqual(tipos(evaluarEmpresa(empresa({ estadoDeCuenta: 'SUSPENDED' }))), ['EMPRESA_CUENTA_RESTRINGIDA:ALTA'])
  assert.deepEqual(evaluarEmpresa(empresa({ estadoDeCuenta: 'ACTIVE' })), [])
})

test('cada señal dice quién es, qué midió y contra qué umbral, para poder discutirla', () => {
  const [s] = evaluarEmpresa(empresa({ pedidos: 10, cancelados: 6 }))
  assert.equal(s.sujeto.tipo, 'EMPRESA')
  assert.equal(s.sujeto.nombre, 'Empresa Uno')
  assert.equal(s.valor, 0.6)
  assert.equal(s.umbral, UMBRALES.cancelacion.alta)
  assert.match(s.detalle, /6 de 10 pedidos.*60 %/)
})

test('un cliente: cancelaciones (5 / 10), cupones vencidos (3 / 6) y ráfaga (10 / 20 en un día)', () => {
  assert.deepEqual(evaluarCliente(cliente({ cancelados: 4, cuponesVencidos: 2, pedidosEnUnDia: 9 })), [])
  assert.deepEqual(tipos(evaluarCliente(cliente({ cancelados: 5 }))), ['CLIENTE_CANCELA_MUCHO:MEDIA'])
  assert.deepEqual(tipos(evaluarCliente(cliente({ cancelados: 10 }))), ['CLIENTE_CANCELA_MUCHO:ALTA'])
  assert.deepEqual(tipos(evaluarCliente(cliente({ cuponesVencidos: 3 }))), ['CLIENTE_CUPONES_VENCIDOS:MEDIA'])
  assert.deepEqual(tipos(evaluarCliente(cliente({ cuponesVencidos: 6 }))), ['CLIENTE_CUPONES_VENCIDOS:ALTA'])
  assert.deepEqual(tipos(evaluarCliente(cliente({ pedidosEnUnDia: 10 }))), ['CLIENTE_RAFAGA:MEDIA'])
  assert.deepEqual(tipos(evaluarCliente(cliente({ pedidosEnUnDia: 20 }))), ['CLIENTE_RAFAGA:ALTA'])
  const [s] = evaluarCliente(cliente({ cancelados: 5, empresas: 2, pedidos: 7 }))
  assert.equal(s.sujeto.contacto, 'ana@x.test')
  assert.match(s.detalle, /2 empresas/)
})

test('las señales se ordenan por gravedad y por cuánto pasaron el umbral, sin tocar la lista original', () => {
  const todas = [
    ...evaluarEmpresa(empresa({ companyId: 'a', empresa: 'A', sinAtender: 3 })),
    ...evaluarEmpresa(empresa({ companyId: 'b', empresa: 'B', pedidos: 10, cancelados: 9 })),
    ...evaluarEmpresa(empresa({ companyId: 'c', empresa: 'C', pedidos: 10, cancelados: 5 })),
  ]
  const copia = [...todas]
  assert.deepEqual(ordenarSenales(todas).map((s) => s.sujeto.nombre), ['B', 'C', 'A'])
  assert.deepEqual(todas, copia)
})

test('el resumen cuenta empresas y clientes distintos y señales por severidad', () => {
  const s = [...evaluarEmpresa(empresa({ pedidos: 10, cancelados: 5, sinAtender: 3 })), ...evaluarCliente(cliente({ cancelados: 5 }))]
  assert.deepEqual(resumirRiesgo(s), { empresas: 1, clientes: 1, porSeveridad: { ALTA: 1, MEDIA: 2 } })
  assert.deepEqual(resumirRiesgo([]), { empresas: 0, clientes: 0, porSeveridad: { ALTA: 0, MEDIA: 0 } })
})
