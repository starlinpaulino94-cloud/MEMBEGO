import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seleccionarNovedadesHero } from '../src/modules/home/novedades'
import type { NovedadHero } from '../src/modules/home/vista'

function promocion(id: number, creadoEn: string): NovedadHero {
  return {
    tipo: 'PROMOCION',
    id: String(id),
    creadoEn,
    titulo: `Oferta ${id}`,
    descripcion: null,
    empresa: 'Negocio',
    colorPrimario: null,
    imagen: null,
    href: `/cliente/promociones/${id}`,
    descuento: null,
    vigenciaHasta: null,
  }
}

test('selecciona solo novedades recientes y las ordena de más nueva a más antigua', () => {
  const ahora = new Date('2026-09-29T12:00:00.000Z')
  const novedades = [
    promocion(1, '2026-09-20T12:00:00.000Z'),
    promocion(2, '2026-09-29T10:00:00.000Z'),
    promocion(3, '2026-09-22T12:00:00.000Z'),
  ]

  assert.deepEqual(
    seleccionarNovedadesHero(novedades, ahora).map(({ id }) => id),
    ['2', '3'],
  )
})

test('cuando no hay novedades en siete días, devuelve las diez más recientes', () => {
  const ahora = new Date('2026-09-29T12:00:00.000Z')
  const novedades = Array.from({ length: 12 }, (_, index) => {
    const diasAtras = 8 + index
    const fecha = new Date(ahora.getTime() - diasAtras * 24 * 60 * 60 * 1000)
    return promocion(index + 1, fecha.toISOString())
  })

  const resultado = seleccionarNovedadesHero(novedades, ahora)

  assert.equal(resultado.length, 10)
  assert.equal(resultado[0]?.id, '1')
  assert.equal(resultado.at(-1)?.id, '10')
})

test('incluye el límite exacto de siete días y excluye fechas futuras', () => {
  const ahora = new Date('2026-09-29T12:00:00.000Z')
  const corte = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000)
  const novedades = [
    promocion(1, corte.toISOString()),
    promocion(2, '2026-09-30T12:00:00.000Z'),
  ]

  assert.deepEqual(
    seleccionarNovedadesHero(novedades, ahora).map(({ id }) => id),
    ['1'],
  )
})
