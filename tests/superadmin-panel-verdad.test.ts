import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hrefFiltro } from '../src/modules/membresias/filtros'

/**
 * EL CENTRO DE CONTROL DICE LA VERDAD Y LLEVA A DONDE DICE (auditoría admin · D-04 y D-05).
 *
 * D-04: «Activas» contaba `estado = 'ACTIVA'` sin mirar el vencimiento, mientras
 *       «Vigentes hoy» de Membresías —en la misma plataforma— sí lo miraba.
 * D-05: «Pagos por validar» y «N pagos pendientes» de cada empresa llevaban a
 *       Operaciones, que es la cobertura de configuración y no tiene ningún pago.
 */

const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const panel = sinComentarios(readFileSync('src/modules/superadmin/panel.ts', 'utf8'))
const pagina = sinComentarios(readFileSync('src/app/(superadmin)/superadmin/dashboard/page.tsx', 'utf8'))

test('D-04 · «Activas» del panel son las vigentes, no las que dicen ACTIVA', () => {
  assert.match(panel, /membresiaVigente\(/)
  assert.doesNotMatch(panel, /estado:\s*\{\s*in:\s*\[\s*'ACTIVA'/, 'agrupar por estado ACTIVA a secas ignora el vencimiento')
})

test('D-05 · ningún aviso de pagos lleva a Operaciones', () => {
  assert.doesNotMatch(pagina, /href=["']\/superadmin\/operaciones["']/)
  assert.match(pagina, /hrefFiltro\(/)
})

test('D-05 · el enlace por empresa cae en las pendientes de ESA empresa', () => {
  const url = hrefFiltro({ estado: 'PENDIENTE_PAGO', empresa: 'emp_1', ambito: 'reales' }, '/superadmin/membresias')
  assert.equal(url, '/superadmin/membresias?estado=PENDIENTE_PAGO&empresa=emp_1')
  // Las de práctica no se ven con el ámbito por defecto: el enlace de una demo lo pide.
  const demo = hrefFiltro({ estado: 'PENDIENTE_PAGO', empresa: 'emp_2', ambito: 'practica' }, '/superadmin/membresias')
  assert.match(demo, /ambito=practica/)
})
