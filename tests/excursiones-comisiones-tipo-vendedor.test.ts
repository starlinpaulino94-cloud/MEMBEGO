import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validarRegla,
  reglaAplicable,
  calcularComision,
  type ReglaComision,
  type ContextoVenta,
} from '../src/modules/excursiones/comisiones/nucleo'

test('validarRegla: acepta ámbito TIPO_VENDEDOR con tipoVendedor válido', () => {
  const r = validarRegla({
    ambito: 'TIPO_VENDEDOR',
    tipoCalculo: 'PORCENTAJE',
    valor: '25',
    tipoVendedor: 'Touroperador',
  })

  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.datos.ambito, 'TIPO_VENDEDOR')
    assert.equal(r.datos.tipoVendedor, 'Touroperador')
    assert.equal(r.datos.valor, 25)
  }
})

test('validarRegla: rechaza TIPO_VENDEDOR si no se especifica el tipo', () => {
  const r = validarRegla({
    ambito: 'TIPO_VENDEDOR',
    tipoCalculo: 'PORCENTAJE',
    valor: '25',
    tipoVendedor: '',
  })

  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.match(r.error, /Elige el tipo de vendedor/i)
  }
})

test('Jerarquía de Reglas: Regla TIPO_VENDEDOR prevalece sobre regla GENERAL', () => {
  const reglaGeneral: ReglaComision = {
    id: 'regla-general',
    ambito: 'GENERAL',
    tipoCalculo: 'PORCENTAJE',
    valor: 10, // 10% para todos en general
    activa: true,
    createdAt: new Date('2026-01-01'),
  }

  const reglaTouroperador: ReglaComision = {
    id: 'regla-to',
    ambito: 'TIPO_VENDEDOR',
    tipoVendedor: 'Touroperador',
    tipoCalculo: 'PORCENTAJE',
    valor: 25, // 25% para Touroperadores
    activa: true,
    createdAt: new Date('2026-01-02'),
  }

  const reglaHotel: ReglaComision = {
    id: 'regla-hotel',
    ambito: 'TIPO_VENDEDOR',
    tipoVendedor: 'Hotel',
    tipoCalculo: 'PORCENTAJE',
    valor: 15, // 15% para Hoteles
    activa: true,
    createdAt: new Date('2026-01-02'),
  }

  const reglas = [reglaGeneral, reglaTouroperador, reglaHotel]

  // Venta hecha por un Touroperador
  const ctxTO: ContextoVenta = {
    vendedorId: 'vend-to-1',
    tipoVendedor: 'Touroperador',
    excursionId: 'exc-1',
    total: 200,
    baseComisionable: 200,
    adultos: 2,
    ninos: 0,
    fecha: new Date(),
  }

  const aplicableTO = reglaAplicable(reglas, ctxTO)
  assert.equal(aplicableTO?.id, 'regla-to')
  const comisionTO = calcularComision(aplicableTO!, ctxTO)
  assert.equal(comisionTO.monto, 50) // 25% de 200 = 50

  // Venta hecha por un Hotel
  const ctxHotel: ContextoVenta = {
    vendedorId: 'vend-hotel-1',
    tipoVendedor: 'Hotel',
    excursionId: 'exc-1',
    total: 200,
    baseComisionable: 200,
    adultos: 3,
    ninos: 0,
    fecha: new Date(),
  }

  const aplicableHotel = reglaAplicable(reglas, ctxHotel)
  assert.equal(aplicableHotel?.id, 'regla-hotel')
  const comisionHotel = calcularComision(aplicableHotel!, ctxHotel)
  assert.equal(comisionHotel.monto, 30) // 15% de 200 = 30

  // Venta hecha por un Empleado (sin regla de tipo de vendedor, cae a GENERAL)
  const ctxEmpleado: ContextoVenta = {
    vendedorId: 'vend-emp-1',
    tipoVendedor: 'Empleado',
    excursionId: 'exc-1',
    total: 200,
    baseComisionable: 200,
    adultos: 2,
    ninos: 0,
    fecha: new Date(),
  }

  const aplicableEmpleado = reglaAplicable(reglas, ctxEmpleado)
  assert.equal(aplicableEmpleado?.id, 'regla-general')
  const comisionEmpleado = calcularComision(aplicableEmpleado!, ctxEmpleado)
  assert.equal(comisionEmpleado.monto, 20) // 10% de 200 = 20
})

test('Jerarquía de Reglas: Regla VENDEDOR individual tiene mayor prioridad que TIPO_VENDEDOR', () => {
  const reglaTouroperador: ReglaComision = {
    id: 'regla-to-general',
    ambito: 'TIPO_VENDEDOR',
    tipoVendedor: 'Touroperador',
    tipoCalculo: 'PORCENTAJE',
    valor: 20,
    activa: true,
    createdAt: new Date('2026-01-01'),
  }

  const reglaNexusVIP: ReglaComision = {
    id: 'regla-nexus-vip',
    ambito: 'VENDEDOR',
    vendedorId: 'nexus-vip-id',
    tipoCalculo: 'PORCENTAJE',
    valor: 30, // Nexus Tours VIP negoció 30%
    activa: true,
    createdAt: new Date('2026-01-02'),
  }

  const reglas = [reglaTouroperador, reglaNexusVIP]

  const ctxNexus: ContextoVenta = {
    vendedorId: 'nexus-vip-id',
    tipoVendedor: 'Touroperador',
    excursionId: 'exc-1',
    total: 1000,
    baseComisionable: 1000,
    adultos: 10,
    ninos: 0,
    fecha: new Date(),
  }

  const aplicable = reglaAplicable(reglas, ctxNexus)
  assert.equal(aplicable?.id, 'regla-nexus-vip')
  const comision = calcularComision(aplicable!, ctxNexus)
  assert.equal(comision.monto, 300) // 30% de 1000 = 300
})
