import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reglasAplicables,
  reglaAplicable,
  calcularComision,
  type ReglaComision,
  type ContextoVenta,
} from '../src/modules/excursiones/comisiones/nucleo'
import {
  comisionesDelPeriodo,
  type ComisionLiquidable,
} from '../src/modules/excursiones/liquidaciones/nucleo'

const AHORA = new Date('2026-08-20T12:00:00Z')

const ctx: ContextoVenta = {
  vendedorId: 'juan',
  excursionId: 'saona',
  categoria: 'PLAYA',
  tipoVendedor: 'PROMOTOR',
  total: 5000,
  baseComisionable: 4000,
  adultos: 2,
  ninos: 0,
  fecha: AHORA,
  excursionNombre: 'Saona VIP',
  excursionPrecio: 2000,
  ventasPreviasExcursion: 4, // 5ta venta -> cumple meta paquete
}

const regla = (p: Partial<ReglaComision> & { id: string }): ReglaComision => ({
  ambito: 'GENERAL',
  tipoCalculo: 'PORCENTAJE',
  valor: 10,
  activa: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...p,
})

test('reglasAplicables retorna todas las reglas que aplican a la venta y al vendedor', () => {
  const reglas = [
    regla({ id: 'r-general', ambito: 'GENERAL', tipoCalculo: 'PORCENTAJE', valor: 5 }),
    regla({ id: 'r-tipo', ambito: 'TIPO_VENDEDOR', tipoVendedor: 'PROMOTOR', tipoCalculo: 'FIJO_VENTA', valor: 200 }),
    regla({ id: 'r-excursion', ambito: 'EXCURSION', excursionId: 'saona', tipoCalculo: 'PORCENTAJE', valor: 10 }),
    regla({ id: 'r-paquete', ambito: 'EXCURSION', excursionId: 'saona', tipoCalculo: 'PAQUETE_REGALO', valor: 5 }),
    regla({ id: 'r-otra-exc', ambito: 'EXCURSION', excursionId: 'buggy', tipoCalculo: 'PORCENTAJE', valor: 20 }), // no aplica
    regla({ id: 'r-otro-vend', ambito: 'VENDEDOR', vendedorId: 'pedro', tipoCalculo: 'PORCENTAJE', valor: 15 }), // no aplica
  ]

  const aplicables = reglasAplicables(reglas, ctx)
  const ids = aplicables.map((r) => r.id)

  assert.equal(aplicables.length, 4)
  assert.ok(ids.includes('r-general'))
  assert.ok(ids.includes('r-tipo'))
  assert.ok(ids.includes('r-excursion'))
  assert.ok(ids.includes('r-paquete'))
  assert.ok(!ids.includes('r-otra-exc'))
  assert.ok(!ids.includes('r-otro-vend'))
})

test('reglasAplicables deduplica reglas idénticas en ámbito y tipo quedándose con la más reciente', () => {
  const vieja = regla({
    id: 'vieja',
    ambito: 'EXCURSION',
    excursionId: 'saona',
    tipoCalculo: 'PORCENTAJE',
    valor: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
  const nueva = regla({
    id: 'nueva',
    ambito: 'EXCURSION',
    excursionId: 'saona',
    tipoCalculo: 'PORCENTAJE',
    valor: 15,
    createdAt: new Date('2026-05-01T00:00:00Z'),
  })

  const aplicables = reglasAplicables([vieja, nueva], ctx)
  assert.equal(aplicables.length, 1)
  assert.equal(aplicables[0].id, 'nueva')
  assert.equal(aplicables[0].valor, 15)
})

test('reglaAplicable mantiene compatibilidad retornando la de mayor peso jerárquico', () => {
  const reglas = [
    regla({ id: 'r-general', ambito: 'GENERAL', tipoCalculo: 'PORCENTAJE', valor: 5 }),
    regla({ id: 'r-excursion', ambito: 'EXCURSION', excursionId: 'saona', tipoCalculo: 'PORCENTAJE', valor: 10 }),
  ]
  const preferida = reglaAplicable(reglas, ctx)
  assert.equal(preferida?.id, 'r-excursion')
})

test('comisionesDelPeriodo incluye comisiones aprobadas de PAQUETE_REGALO aunque su neto sea 0', () => {
  const comisiones: ComisionLiquidable[] = [
    {
      id: 'c-cash',
      vendedorId: 'juan',
      estado: 'APROBADA',
      neto: 400,
      createdAt: new Date('2026-08-15T10:00:00Z'),
      liquidacionId: null,
      tipoCalculo: 'PORCENTAJE',
    },
    {
      id: 'c-paquete-progreso',
      vendedorId: 'juan',
      estado: 'APROBADA',
      neto: 0, // Venta 1 de 5 (progreso hacia paquete)
      createdAt: new Date('2026-08-16T10:00:00Z'),
      liquidacionId: null,
      tipoCalculo: 'PAQUETE_REGALO',
    },
    {
      id: 'c-paquete-otorgado',
      vendedorId: 'juan',
      estado: 'APROBADA',
      neto: 2000, // Meta cumplida
      createdAt: new Date('2026-08-17T10:00:00Z'),
      liquidacionId: null,
      tipoCalculo: 'PAQUETE_REGALO',
    },
  ]

  const seleccionadas = comisionesDelPeriodo(comisiones, {
    vendedorId: 'juan',
    desde: new Date('2026-08-01T00:00:00Z'),
    hasta: new Date('2026-08-31T23:59:59Z'),
  })

  assert.equal(seleccionadas.length, 3)
  const ids = seleccionadas.map((c) => c.id)
  assert.ok(ids.includes('c-cash'))
  assert.ok(ids.includes('c-paquete-progreso'))
  assert.ok(ids.includes('c-paquete-otorgado'))
})
