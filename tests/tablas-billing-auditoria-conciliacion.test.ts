import './support/sin-server-only'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TablaDeAsientos, TablaDeCortes } from '../src/components/billing/LibroDeCuenta'
import { BitacoraTabla } from '../src/components/auditoria/BitacoraTabla'
import { ConciliacionVista } from '../src/components/conciliacion/ConciliacionVista'

/**
 * BILLING, AUDITORÍA Y CONCILIACIÓN EN LA `Tabla` DEL SISTEMA (auditoría admin · fase 7, tarea 7.1).
 *
 * Cuatro `<table>` a mano más, las que vivían dentro de componentes: el libro de la cuenta y los estados de cuenta (billing, que ya
 * tenían título y `scope`), la bitácora de actividad (que no tenía ninguno de los dos) y la muestra de casos de cada regla de
 * conciliación (que se imprime con el reporte).
 */

const html = (n: unknown) => renderToStaticMarkup(n as never)
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('ninguno de los tres componentes pinta ya una tabla HTML a mano', () => {
  for (const f of ['src/components/billing/LibroDeCuenta.tsx', 'src/components/auditoria/BitacoraTabla.tsx', 'src/components/conciliacion/ConciliacionVista.tsx']) {
    assert.equal(/<table\b/.test(sinComentarios(readFileSync(f, 'utf8'))), false, f)
  }
})

// ── Billing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const asiento = (p: Record<string, unknown> = {}) => ({
  id: 'a1',
  seq: 1,
  type: 'ORDER_FEE',
  amount: '150.00',
  balance: '150.00',
  currency: 'DOP',
  reason: null,
  referenceType: 'ORDER',
  referenceId: 'o1',
  createdAt: new Date('2026-10-01T15:30:00Z'),
  pedidoId: 'p1',
  pedidoCodigo: 'PED-0001',
  ...p,
})

test('libro de la cuenta · título, el movimiento como identificador, enlace al pedido solo con destino, y el signo en color', () => {
  const out = html(h(TablaDeAsientos, { filas: [asiento(), asiento({ id: 'a2', amount: '-40.00', balance: '110.00', type: 'REFUND', reason: 'devolución parcial' })] as never, pedidoHref: (id: string) => `/ped/${id}` }))
  assert.match(out, /<caption[^>]*>Movimientos de la cuenta, del más reciente al más antiguo</)
  assert.match(out, /<th[^>]*scope="row"[^>]*>[\s\S]*?Comisión por pedido/)
  assert.match(out, /<a [^>]*href="\/ped\/p1"[^>]*>PED-0001/)
  assert.match(out, /text-success[^>]*>−RD\$ 40\.00/, 'un monto a favor se ve en verde')
  assert.match(out, /text-foreground[^>]*>RD\$ 150\.00/)
  assert.match(out, /devolución parcial/)
  const sinEnlace = html(h(TablaDeAsientos, { filas: [asiento()] as never }))
  assert.doesNotMatch(sinEnlace, /<a /)
  assert.match(sinEnlace, /PED-0001/)
  assert.match(html(h(TablaDeAsientos, { filas: [] })), /Todavía no hay movimientos en la cuenta\./)
})

test('estados de cuenta · «Al día» solo con saldo cero, lo que abrió y las cifras, sin ocultar columnas', () => {
  const corte = (p: Record<string, unknown> = {}) => ({
    id: 'c1',
    period: '2026-09',
    periodStart: new Date('2026-09-01T04:00:00Z'),
    periodEnd: new Date('2026-10-01T04:00:00Z'),
    billingCycle: 'MONTHLY',
    currency: 'DOP',
    openingBalance: '200.00',
    totalOrders: 12,
    totalGmv: '10000.00',
    totalCommissions: '500.00',
    reversals: '-50.00',
    adjustments: '0',
    credits: '100.00',
    payments: '300.00',
    closingBalance: '250.00',
    amountDue: '250.00',
    generatedAt: new Date('2026-10-01T05:00:00Z'),
    ...p,
  })
  const out = html(h(TablaDeCortes, { cortes: [corte(), corte({ id: 'c2', amountDue: '0', openingBalance: '0' })] as never }))
  assert.match(out, /<caption[^>]*>Estados de cuenta por periodo</)
  assert.equal((out.match(/<th[^>]*scope="col"/g) ?? []).length, 6)
  assert.match(out, /Abrió con RD\$ 200\.00/)
  assert.equal((out.match(/Abrió con/g) ?? []).length, 1, 'sin saldo de apertura no se dice')
  assert.equal((out.match(/Al día/g) ?? []).length, 1)
  assert.match(out, /title="Comisiones menos reversos más ajustes">RD\$ 450\.00/, 'comisiones 500 − 50 + 0')
  assert.match(out, /text-success">RD\$ 400\.00/, 'pagos 300 + créditos 100')
  assert.doesNotMatch(out, /max-(md|lg):hidden/)
  assert.match(html(h(TablaDeCortes, { cortes: [] })), /Todavía no hay estados de cuenta/)
})

// ── Bitácora ────────────────────────────────────────────────────────────────────────────────────────────────────────

const item = (p: Record<string, unknown> = {}) => ({
  id: 'i1',
  fecha: new Date('2026-10-01T15:30:45Z'),
  accion: 'PLAN_CREADO',
  accionLabel: 'Plan creado',
  detalle: 'Plan Oro',
  entidadTipo: 'Plan',
  entidadId: 'pl_123',
  usuario: 'Ana',
  usuarioEmail: 'ana@x.com',
  empresa: 'AquaShine',
  ip: '10.0.0.1',
  payload: {},
  ...p,
})

test('bitácora · título, la fecha exacta como identificador, quién (o «Sistema») con su IP y la empresa solo en la vista global', () => {
  const out = html(h(BitacoraTabla, { items: [item(), item({ id: 'i2', usuario: null, usuarioEmail: null, ip: null, detalle: null })] as never, timeZone: 'America/Santo_Domingo' }))
  assert.match(out, /<caption[^>]*>Bitácora de actividad</)
  assert.match(out, /<th[^>]*scope="row"[^>]*><span class="whitespace-nowrap tabular-nums">[^<]*:\d\d[^<]*</, 'la hora llega hasta el segundo')
  assert.match(out, /Plan creado/)
  assert.match(out, />Ana</)
  assert.match(out, /ana@x\.com/)
  assert.match(out, /IP 10\.0\.0\.1/)
  assert.match(out, />Sistema</)
  assert.match(out, /font-mono[^>]*>pl_123</)
  assert.doesNotMatch(out, />Empresa</, 'sin la columna de empresa')
  const global = html(h(BitacoraTabla, { items: [item()] as never, timeZone: 'America/Santo_Domingo', mostrarEmpresa: true }))
  assert.match(global, /<th[^>]*>Empresa<\/th>/)
  assert.match(global, />AquaShine</)
})

test('bitácora · en estrecho solo se ocultan detalle, empresa y «Sobre»; cuándo, qué y quién siguen a la vista', () => {
  const out = html(h(BitacoraTabla, { items: [item()] as never, timeZone: 'UTC', mostrarEmpresa: true }))
  const th = (t: string) => out.match(new RegExp(`<th[^>]*>${t}</th>`))?.[0] ?? ''
  for (const siempre of ['Fecha y hora', 'Acción', 'Quién']) assert.doesNotMatch(th(siempre), /hidden/, siempre)
  assert.match(th('Detalle'), /max-md:hidden/)
  assert.match(th('Empresa'), /max-md:hidden/)
  assert.match(th('Sobre'), /max-lg:hidden/)
})

// ── Conciliación ────────────────────────────────────────────────────────────────────────────────────────────────────

test('conciliación · la muestra de casos de una regla es una Tabla con título, y sin columnas ocultas porque se imprime', () => {
  const regla = { codigo: 'PED-01', grupo: 'PEDIDOS_Y_COMISIONES', severidad: 'ALTA', titulo: 'Pedido sin comisión', queEs: 'Cada pedido cobrado tiene su comisión.', queHacer: 'Mira el asiento.' }
  const hallazgo = {
    regla,
    total: 3,
    muestra: [
      { companyId: 'c1', empresa: 'AquaShine', referencia: 'PED-0001', detalle: 'falta el asiento' },
      { companyId: 'c1', empresa: 'AquaShine', referencia: 'PED-0001', detalle: 'se repite la referencia' },
    ],
  }
  const out = html(h(ConciliacionVista, { hallazgos: [hallazgo] as never, generadoEn: '2026-10-22T12:00:00Z' }))
  assert.match(out, /<caption[^>]*>Casos de la regla PED-01</)
  assert.match(out, /<th[^>]*scope="row"[^>]*><span class="font-mono">PED-0001/)
  assert.match(out, /falta el asiento/)
  assert.equal((out.match(/se repite la referencia/g) ?? []).length, 1, 'dos filas con la misma referencia no chocan')
  assert.doesNotMatch(out, /max-(md|lg):hidden/)
  assert.match(out, /data-testid="regla-PED-01"/, 'el testid de la regla se conserva')
  assert.match(out, /data-testid="grupo-PEDIDOS_Y_COMISIONES"/)
  assert.match(out, /Se enseñan los 2 más recientes de 3/)
})

// ── Un defecto que apareció al mirar la bitácora en el navegador ─────────────────────────────────────────────────────

test('la bitácora no escribe «[object Object]» cuando el antes y el después son el saldo de un producto', async () => {
  const { describir } = await import('../src/modules/auditoria/queries')
  assert.equal(describir({ antes: { onHand: 10, reserved: 2, damaged: 0 }, despues: { onHand: 8, reserved: 2, damaged: 1 } }), '10 en existencia, 2 apartadas → 8 en existencia, 2 apartadas, 1 dañadas')
  assert.equal(describir({ antes: 5, despues: 7 }), '5 → 7')
  assert.equal(describir({ antes: '2.50', despues: '3.10', motivo: 'proveedor nuevo' }), 'proveedor nuevo · 2.50 → 3.10')
  // Un objeto que no se sabe decir en una línea se omite: mejor nada que «[object Object]».
  assert.equal(describir({ antes: { a: 1 }, despues: { a: 2 } }), null)
  assert.doesNotMatch(describir({ tipo: 'COSTO', antes: { x: 1 }, despues: { x: 2 } }) ?? '', /object/)
  assert.equal(describir({}), null)
})

test('la bitácora dice los estados de Supply en español y con el género de lo que cambió', async () => {
  const { describir } = await import('../src/modules/auditoria/queries')
  // Una oferta queda «activa»; un lote, «activo».
  assert.equal(describir({ antes: 'DRAFT', despues: 'ACTIVE' }, 'SupplyV2Offer'), 'Borrador → Activa')
  assert.equal(describir({ antes: 'DRAFT', despues: 'ACTIVE' }, 'SupplyV2Lot'), 'Borrador → Activo')
  assert.equal(describir({ antes: 'PENDING_APPROVAL', despues: 'PARTIALLY_RECEIVED' }, 'SupplyV2PurchaseOrder'), 'Pendiente de aprobación → Recibida parcialmente')
  assert.equal(describir({ de: 'PAUSED', a: 'ACTIVE' }, 'SupplyV2Benefit'), 'Pausado → Activo')
  // Sin entidad se dice en femenino (la mayoría); lo que no es un estado conocido no se toca.
  assert.equal(describir({ antes: 'APPROVED', despues: 'PAID' }), 'Aprobada → Pagada')
  assert.equal(describir({ antes: 'CODIGO_RARO', despues: '2.50' }, 'SupplyV2Offer'), 'CODIGO_RARO → 2.50')
  // Un estado ya en español no cambia.
  assert.equal(describir({ antes: 'PENDIENTE', despues: 'ACTIVA' }), 'PENDIENTE → ACTIVA')
})
