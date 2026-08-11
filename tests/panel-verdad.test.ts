/**
 * Bloque 1 de la auditoría · LAS PIEZAS QUE HACEN QUE LOS NÚMEROS SEAN VERDAD.
 * Ejecutar: npm test
 *
 * Contexto: docs/auditoria-clientes-membresias.md. De los 14 números del
 * Resumen, 6 no eran verdad, y ninguno fallaba por un error de cálculo:
 * fallaban porque el mismo concepto estaba definido dos veces en dos sitios
 * que nunca se pusieron de acuerdo. Lo que se prueba aquí es justamente eso:
 * que ahora hay UNA definición, y que dice lo que creemos que dice.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { membresiaVigente, membresiaCaducada } from '../src/modules/membresia/vigencia'
import {
  whereTransferencias,
  whereCambiosDePlan,
  whereComprasEnValidacion,
  whereMembresiasEnSucursal,
  whereMembresiasSinCompletar,
  whereComprasSinCompletar,
} from '../src/modules/pagos/colas'
import { whereClientes } from '../src/modules/admin/clientesFiltro'
import {
  ESTADOS_MEMBRESIA,
  estadoValido,
  whereMembresias,
} from '../src/modules/admin/membresiasFiltro'
import { armarCsv, celdaCsv, fechaCsv } from '../src/lib/csv'

const AHORA = new Date('2026-08-11T15:00:00Z')

// ── Vigencia ────────────────────────────────────────────────────────────────

test('vigente es activa Y sin vencer, y las dos condiciones van juntas', () => {
  const w = membresiaVigente(AHORA) as {
    AND: [{ estado: string }, { OR: Array<Record<string, unknown>> }]
  }
  // Envuelto en AND a propósito: el fragmento necesita su propio OR, y suelto
  // lo pisaría cualquier consulta que ya tuviera uno.
  assert.ok(Array.isArray(w.AND), 'debe ir dentro de AND para poder componerse')
  assert.deepEqual(w.AND[0], { estado: 'ACTIVA' })
  assert.equal(w.AND.length, 2)
})

test('una membresía SIN fecha de vencimiento sigue contando como vigente', () => {
  // Es la trampa que motivó no escribirlo como `NOT: { fechaVencimiento: { lt } }`:
  // en SQL, NOT (NULL < x) es NULL, no TRUE, y las perpetuas desaparecerían.
  const w = membresiaVigente(AHORA) as { AND: [unknown, { OR: Array<Record<string, unknown>> }] }
  const opciones = w.AND[1].OR
  assert.ok(
    opciones.some((o) => o.fechaVencimiento === null),
    'la rama de fechaVencimiento null tiene que estar'
  )
  assert.ok(
    opciones.some((o) => {
      const f = o.fechaVencimiento as { gte?: Date } | null
      return f?.gte === AHORA
    }),
    'y la rama de "todavía no ha vencido"'
  )
})

test('caducada es exactamente lo contrario que barre el job', () => {
  const w = membresiaCaducada(AHORA) as {
    estado: string
    fechaVencimiento: { lt: Date }
  }
  assert.equal(w.estado, 'ACTIVA', 'solo se vencen las que la base cree activas')
  assert.deepEqual(w.fechaVencimiento, { lt: AHORA })
})

test('vigente y caducada no pueden solaparse: la fecha las separa', () => {
  const vig = membresiaVigente(AHORA) as { AND: [unknown, { OR: Array<Record<string, unknown>> }] }
  const cad = membresiaCaducada(AHORA) as { fechaVencimiento: { lt: Date } }
  const rama = vig.AND[1].OR.find((o) => o.fechaVencimiento != null) as {
    fechaVencimiento: { gte: Date }
  }
  assert.equal(rama.fechaVencimiento.gte.getTime(), cad.fechaVencimiento.lt.getTime())
})

// ── Colas de pago ───────────────────────────────────────────────────────────

test('«por validar» NO incluye a quien nunca pagó', () => {
  // El origen del «7 pagos por validar» que llevaba a una pantalla con 0: el
  // Resumen contaba PENDIENTE, que es «pidió el plan y no pagó». Ahí no hay
  // nada que validar — hay alguien a quien llamar, y eso es otra cola.
  const transferencias = whereTransferencias('c1') as { estado: string }
  assert.equal(transferencias.estado, 'PENDIENTE_PAGO')
  assert.notEqual(transferencias.estado, 'PENDIENTE')

  const sinCompletar = whereMembresiasSinCompletar('c1') as {
    OR: Array<{ estado?: unknown }>
  }
  const estados = sinCompletar.OR.map((o) => o.estado)
  assert.ok(estados.includes('RECHAZADA'), 'un rechazo sin reintento es seguimiento')
  assert.ok(estados.includes('PENDIENTE'), 'y una solicitud sin pagar, también')
})

test('un cobro en sucursal se reconoce por referencia, sucursal o método', () => {
  const w = whereMembresiasEnSucursal('c1') as {
    estado: string
    OR: Array<Record<string, unknown>>
  }
  assert.equal(w.estado, 'PENDIENTE')
  assert.equal(w.OR.length, 3, 'las tres señales, y en la BASE (antes era en memoria)')
  assert.ok(w.OR.some((o) => 'referencia' in o))
  assert.ok(w.OR.some((o) => 'sucursalPagoId' in o))
  assert.ok(w.OR.some((o) => 'metodoPago' in o))
})

test('sucursal y seguimiento son complementarios: nadie cae en las dos', () => {
  const sucursal = whereMembresiasEnSucursal('c1') as { OR: unknown[] }
  const seguimiento = whereMembresiasSinCompletar('c1') as {
    OR: Array<{ estado?: unknown; NOT?: { OR: unknown[] } }>
  }
  const ramaPendiente = seguimiento.OR.find((o) => o.estado === 'PENDIENTE')
  assert.ok(ramaPendiente?.NOT, 'la rama PENDIENTE de seguimiento excluye lo presencial')
  assert.equal(
    JSON.stringify(ramaPendiente!.NOT!.OR),
    JSON.stringify(sucursal.OR),
    'y lo excluye con la MISMA condición, no con una copia que pueda divergir'
  )
})

test('las compras siguen el mismo reparto que las membresías', () => {
  const enValidacion = whereComprasEnValidacion('c1') as { estado: string }
  assert.equal(enValidacion.estado, 'EN_VALIDACION')
  const sinCompletar = whereComprasSinCompletar('c1') as { OR: Array<{ estado?: unknown }> }
  assert.ok(sinCompletar.OR.some((o) => o.estado === 'RECHAZADA'))
})

test('sin empresa (superadmin) no se inventa un filtro de empresa', () => {
  for (const w of [
    whereTransferencias(null),
    whereCambiosDePlan(undefined),
    whereComprasEnValidacion(null),
  ]) {
    assert.equal('companyId' in (w as object), false)
  }
  assert.equal((whereTransferencias('c1') as { companyId?: string }).companyId, 'c1')
})

// ── Filtros compartidos entre pantalla y exportación ────────────────────────

test('el chip «Vigentes» no es un estado guardado: es estado + fecha', () => {
  const vigentes = whereMembresias('c1', { estado: 'ACTIVA' }) as { AND?: unknown }
  assert.ok(vigentes.AND, 'ACTIVA se traduce a vigente, no a `estado: ACTIVA`')

  const vencidas = whereMembresias('c1', { estado: 'VENCIDA' }) as { estado?: string }
  assert.equal(vencidas.estado, 'VENCIDA', 'los demás estados sí son literales')
})

test('los estados que faltaban ya tienen pestaña', () => {
  // Una membresía con el pago rechazado no aparecía bajo NINGUNA pestaña.
  const claves = ESTADOS_MEMBRESIA.map((e) => e.clave)
  assert.ok(claves.includes('PENDIENTE_PAGO'))
  assert.ok(claves.includes('RECHAZADA'))
})

test('un estado inventado en la URL se ignora, no rompe ni filtra de más', () => {
  assert.equal(estadoValido('PANADERIA'), undefined)
  assert.equal(estadoValido(undefined), undefined)
  assert.equal(estadoValido('VENCIDA'), 'VENCIDA')
  const w = whereMembresias('c1', { estado: 'PANADERIA' }) as { estado?: string }
  assert.equal(w.estado, undefined)
})

test('la empresa manda siempre, aunque la búsqueda venga vacía o sucia', () => {
  for (const q of ['', '   ', undefined as unknown as string]) {
    const w = whereClientes('c1', q) as { companyId?: string; OR?: unknown }
    assert.equal(w.companyId, 'c1')
    assert.equal(w.OR, undefined, 'una búsqueda vacía no debe añadir condiciones')
  }
  const conTexto = whereClientes('c1', ' ramón ') as { companyId?: string; OR: unknown[] }
  assert.equal(conTexto.companyId, 'c1')
  assert.equal(conTexto.OR.length, 3, 'nombre, correo y teléfono')
})

// ── CSV ─────────────────────────────────────────────────────────────────────

test('una celda con coma, comilla, salto o punto y coma no parte la fila', () => {
  assert.equal(celdaCsv('simple'), 'simple')
  assert.equal(celdaCsv('a,b'), '"a,b"')
  assert.equal(celdaCsv('di "hola"'), '"di ""hola"""')
  assert.equal(celdaCsv('linea1\nlinea2'), '"linea1\nlinea2"')
  // El punto y coma importa: Excel en español lo usa como separador, y una
  // dirección con `;` partiría la fila en dos columnas.
  assert.equal(celdaCsv('Calle 1; Local 2'), '"Calle 1; Local 2"')
  assert.equal(celdaCsv(null), '')
  assert.equal(celdaCsv(undefined), '')
})

test('el CSV lleva BOM: sin él, Excel rompe los acentos', () => {
  const csv = armarCsv(['Nombre'], [['Ramón']])
  assert.ok(csv.startsWith('﻿'), 'falta el BOM y «Ramón» llegaría como «RamÃ³n»')
  assert.equal(csv, '﻿Nombre\nRamón')
})

test('las fechas del CSV van en la zona horaria del negocio', () => {
  // 03:00 UTC del día 12 es todavía el día 11 en Santo Domingo (UTC−4).
  const medianoche = new Date('2026-08-12T03:00:00Z')
  assert.equal(fechaCsv(medianoche, 'America/Santo_Domingo'), '11/8/26')
  assert.equal(fechaCsv(null, 'America/Santo_Domingo'), '')
})
