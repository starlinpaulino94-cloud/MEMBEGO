import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_SECTIONS, seccionPermitida, type AdminSection } from '../src/lib/auth/permissions'
import { MAX_BLOQUES_HOY, MAX_CIFRAS_MES, bloquesDelResumen } from '../src/modules/admin/resumen/bloques'
import { calendarioDelResumen, etiquetaTramo, serieDe14 } from '../src/modules/admin/resumen/calendario'
import type { AppRole } from '../src/types'

/**
 * EL RESUMEN SE COMPONE POR LO QUE LA PERSONA PUEDE VER (auditoría admin · fase 5, tarea 5.1).
 *
 * `bloquesDelResumen` es pura: se alimenta con la regla REAL de secciones de cada rol (`seccionPermitida`), así que si mañana
 * se le da o se le quita un módulo a un rol, esta prueba lo dice. Y el calendario del Resumen se prueba con un reloj fijo.
 */

const como = (role: AppRole, conFinanzas: boolean, conEmpleados = false) =>
  bloquesDelResumen({ puede: (s: AdminSection) => seccionPermitida(role, s, null), conFinanzas, conEmpleados })

test('el administrador ve pagos, vencimientos y mostrador; ingresos, membresías, canjes y clientes nuevos', () => {
  const b = como('ADMINISTRADOR', true, true)
  assert.deepEqual(b.hoy, ['pagos', 'vencen', 'mostrador'])
  assert.deepEqual(b.mes, ['ingresos', 'membresias', 'canjes', 'clientesNuevos'])
  assert.equal(b.grafica, 'canjes')
  assert.deepEqual(b.mostrador, { canjes: true, citas: true })
})

test('el supervisor trae reportes: ve el dinero y, si no se le niega, lo mismo que el administrador', () => {
  const b = como('SUPERVISOR', true)
  assert.deepEqual(b.hoy, ['pagos', 'vencen', 'mostrador'])
  assert.deepEqual(b.mes, ['ingresos', 'membresias', 'canjes', 'clientesNuevos'])
})

test('Marketing no tiene pagos, canjes ni dinero: ni el bloque ni la cifra existen (no hay un hueco que diga «Sin permiso»)', () => {
  const b = como('MARKETING', false)
  assert.deepEqual(b.hoy, ['riesgo', 'promosVencen'])
  assert.deepEqual(b.mes, ['registros', 'seguidores', 'beneficioLider', 'interacciones'])
  assert.equal(b.grafica, 'registros')
  assert.deepEqual(b.mostrador, { canjes: false, citas: false })
  for (const prohibido of ['pagos', 'ingresos', 'canjes', 'membresias', 'clientesNuevos', 'mostrador', 'vencen']) {
    assert.ok(![...b.hoy, ...b.mes].includes(prohibido as never), `Marketing no debe ver «${prohibido}»`)
  }
})

test('el cajero ve pagos y mostrador, y NO ve ingresos (no trae reportes)', () => {
  const b = como('CAJERO', false)
  assert.deepEqual(b.hoy, ['pagos', 'mostrador'])
  assert.deepEqual(b.mes, ['membresias', 'canjes', 'clientesNuevos'])
  assert.ok(!b.mes.includes('ingresos'))
})

test('a quien se le niega ver_financieros se le quita la cifra de ingresos y nada más', () => {
  const con = como('ADMINISTRADOR', true)
  const sin = como('ADMINISTRADOR', false)
  assert.deepEqual(sin.hoy, con.hoy)
  assert.deepEqual(sin.mes, ['membresias', 'canjes', 'clientesNuevos'])
})

test('nunca más de 3 bloques de acción ni de 4 cifras, aunque se tengan todas las secciones', () => {
  for (const role of ['ADMINISTRADOR', 'GERENTE', 'SUPERVISOR', 'MARKETING', 'CAJERO'] as AppRole[]) {
    const b = como(role, true, true)
    assert.ok(b.hoy.length <= MAX_BLOQUES_HOY, `${role}: ${b.hoy.length} bloques`)
    assert.ok(b.mes.length <= MAX_CIFRAS_MES, `${role}: ${b.mes.length} cifras`)
  }
  const todo = bloquesDelResumen({ puede: () => true, conFinanzas: true, conEmpleados: true })
  assert.ok(todo.hoy.length <= MAX_BLOQUES_HOY && todo.mes.length <= MAX_CIFRAS_MES)
})

test('quien no puede abrir ninguna sección recibe un Resumen vacío, no uno a medias', () => {
  const b = bloquesDelResumen({ puede: () => false, conFinanzas: false, conEmpleados: false })
  assert.deepEqual(b, { hoy: [], mes: [], grafica: null, mostrador: { canjes: false, citas: false } })
})

test('toda sección que usa un bloque existe en el catálogo del panel', () => {
  // Si alguien renombra una sección, el bloque se quedaría sin permiso en silencio.
  const usadas = ['pagos', 'riesgo', 'clientes', 'scanner', 'citas', 'promociones', 'membresias', 'audiencia']
  for (const s of usadas) assert.ok((ADMIN_SECTIONS as readonly string[]).includes(s), s)
})

// ── El calendario del Resumen ─────────────────────────────────────────────────────────────────────────────────────

test('el 20 de octubre: ventana «1–20 oct 2026» y el MISMO tramo del mes anterior, «1–20 sep»', () => {
  const c = calendarioDelResumen(new Date('2026-10-20T15:00:00Z'), 'America/Santo_Domingo')
  assert.equal(c.ventanaMes, '1–20 oct 2026')
  assert.equal(c.ventanaAnterior, '1–20 sep')
  assert.equal(c.inicioMes.toISOString(), '2026-10-01T04:00:00.000Z')
  assert.equal(c.inicioMesAnterior.toISOString(), '2026-09-01T04:00:00.000Z')
  // Fin EXCLUSIVO: la medianoche local que cierra el 20 de septiembre.
  assert.equal(c.finTramoAnterior.toISOString(), '2026-09-21T04:00:00.000Z')
  assert.equal(c.inicioHoy.toISOString(), '2026-10-20T04:00:00.000Z')
})

test('el día 1 la ventana es un solo día; en enero el tramo anterior cruza de año', () => {
  assert.equal(calendarioDelResumen(new Date('2026-10-01T15:00:00Z'), 'America/Santo_Domingo').ventanaMes, '1 oct 2026')
  const enero = calendarioDelResumen(new Date('2026-01-15T15:00:00Z'), 'America/Santo_Domingo')
  assert.equal(enero.ventanaAnterior, '1–15 dic 2025')
  assert.equal(enero.inicioMesAnterior.toISOString(), '2025-12-01T04:00:00.000Z')
})

test('el 31 de marzo el tramo anterior se acota a febrero (28 días), sin salirse del mes', () => {
  const c = calendarioDelResumen(new Date('2026-03-31T15:00:00Z'), 'America/Santo_Domingo')
  assert.equal(c.ventanaAnterior, '1–28 feb')
  assert.equal(c.finTramoAnterior.toISOString(), '2026-03-01T04:00:00.000Z')
})

test('a las 10 de la noche en Santo Domingo todavía es el día de ayer (no el de UTC)', () => {
  // 02:00 UTC del 21 = 22:00 del 20 en Santo Domingo.
  const c = calendarioDelResumen(new Date('2026-10-21T02:00:00Z'), 'America/Santo_Domingo')
  assert.equal(c.hoyDia, '2026-10-20')
  assert.equal(c.ventanaMes, '1–20 oct 2026')
})

test('la serie de 14 días rellena con ceros los días sin movimiento y termina hoy', () => {
  const c = calendarioDelResumen(new Date('2026-10-20T15:00:00Z'), 'America/Santo_Domingo')
  const s = serieDe14(c.primerDiaSerie, new Map([['2026-10-20', 12], ['2026-10-10', 3]]))
  assert.equal(s.length, 14)
  assert.equal(s[0]!.fecha, '2026-10-07')
  assert.equal(s[13]!.fecha, '2026-10-20')
  assert.equal(s[13]!.total, 12)
  assert.equal(s.find((d) => d.fecha === '2026-10-10')!.total, 3)
  assert.equal(s.filter((d) => d.total === 0).length, 12)
})

test('etiquetaTramo escribe el año salvo que se pida lo contrario', () => {
  assert.equal(etiquetaTramo(2026, 9, 20), '1–20 sep 2026')
  assert.equal(etiquetaTramo(2026, 9, 20, true), '1–20 sep')
  assert.equal(etiquetaTramo(2026, 9, 1), '1 sep 2026')
})
