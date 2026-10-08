import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CAPACIDADES, CAPACIDADES_BASE } from '../src/modules/capacidades/catalogo'
import { FUNCIONES_EMPRESA } from '../src/modules/plataforma/conceptos'
import { ORIGENES_COMISIONABLES } from '../src/modules/billing/domain'

/** POS CONECTADO · capacidad, guardias y separación (Fase 7). El comportamiento contra la base está en `tests/postgres/pos.db.test.ts`. */

const leer = (f: string) => readFileSync(f, 'utf8')
const limpio = (f: string) => leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('la capacidad POS_MEMBEGO existe, es una función de empresa y está apagada de serie en todas las categorías', () => {
  assert.ok((CAPACIDADES as readonly string[]).includes('POS_MEMBEGO'))
  assert.ok((FUNCIONES_EMPRESA as readonly string[]).includes('POS_MEMBEGO'))
  for (const [categoria, base] of Object.entries(CAPACIDADES_BASE)) assert.ok(!(base as readonly string[]).includes('POS_MEMBEGO'), `${categoria} la enciende de serie`)
})

test('cobrar pedidos exige caja + POS conectado + pedidos; vender exige caja + POS conectado + catálogo', () => {
  const c = limpio('src/modules/pos/capacidades.ts')
  for (const cap of ['POS_CAJA', 'POS_MEMBEGO', 'PEDIDOS_MEMBEGO', 'CATALOGO_UNIFICADO']) assert.match(c, new RegExp(`tieneCapacidad\\(companyId, '${cap}'\\)`))
  assert.match(c, /cobrarPedidos: caja && pos && pedidos/)
  assert.match(c, /venderEnMostrador: caja && pos && catalogo/)
})

const acciones = limpio('src/modules/pos/actions.ts')

test('toda acción de la caja autoriza con el rol de staff y la capacidad ANTES de tocar la base, y saca la empresa de la sesión', () => {
  assert.match(acciones, /requireRole\(SCANNER_ROLES\)/)
  assert.match(acciones, /user\.metadata\.companyId/)
  const exportadas = [...acciones.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
  assert.equal(exportadas.length, 5)
  for (const [, nombre] of exportadas) {
    const cuerpo = acciones.slice(acciones.indexOf(`export async function ${nombre}(`))
    const i = cuerpo.indexOf('await cajero(')
    const j = cuerpo.indexOf('conEmpresa(')
    assert.ok(i > 0 && (j < 0 || i < j), `${nombre} no autoriza antes de tocar la base`)
  }
  // Nada que cruce al servicio puede traer la empresa, el precio ni el nivel del navegador.
  assert.doesNotMatch(acciones, /entrada\.(companyId|empresaId|precio|price|total|descuento|nivel|verificationLevel)/)
  assert.match(acciones, /formSubmitLimiter\(/)
})

test('las acciones que cobran piden además un límite de envíos', () => {
  for (const n of ['cobrarPedidoMembego', 'venderEnMostrador']) {
    const cuerpo = acciones.slice(acciones.indexOf(`export async function ${n}(`))
    assert.ok(cuerpo.indexOf('formSubmitLimiter(') > 0 && cuerpo.indexOf('formSubmitLimiter(') < cuerpo.indexOf('conEmpresa('), n)
  }
})

test('DECISIÓN: la venta de mostrador pura no comisiona — solo el marketplace comisiona, y el servicio de la caja nunca cobra comisión por su cuenta', () => {
  assert.deepEqual([...ORIGENES_COMISIONABLES], ['MARKETPLACE'])
  const s = limpio('src/modules/pos/service.ts')
  assert.doesNotMatch(s, /registrarComisionDePedidoEnTx|cobrarComision|from '@\/modules\/billing/)
})

test('un pedido de la vitrina se cobra en la caja SOLO con su QR, y la venta de mostrador es la única que cierra sin QR', () => {
  const s = limpio('src/modules/pos/service.ts')
  // El cobro de un pedido existente pasa por el cierre con QR.
  const cobrar = s.slice(s.indexOf('export async function cobrarPedidoEnCajaEnTx'), s.indexOf('export interface EntradaDeVenta'))
  assert.match(cobrar, /completarPorQrEnTx\(/)
  assert.doesNotMatch(cobrar, /cerrarPedidoExternoEnTx/)
  // La venta de mostrador crea su propio pedido POS y lo cierra sin QR.
  const venta = s.slice(s.indexOf('export async function venderEnMostradorEnTx'))
  assert.match(venta, /origin: 'POS'/)
  assert.match(venta, /cerrarPedidoExternoEnTx\(/)
  assert.doesNotMatch(venta, /completarPorQrEnTx/)
  // Y la venta nunca afirma que el cliente confirmó nada.
  assert.match(venta, /confirmadoPorCliente: false/)
})

test('el POS no importa Supply ni escribe las tablas de pedidos por su cuenta', () => {
  for (const f of readdirSync('src/modules/pos').filter((x) => x.endsWith('.ts'))) {
    const t = limpio(join('src/modules/pos', f))
    for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.doesNotMatch(m[1], /supply/i, `${f} importa ${m[1]}`)
    assert.doesNotMatch(t, /\btx\.membegoOrder\.(create|update|updateMany|delete)\(/, `${f} escribe pedidos directo`)
  }
})

test('la pantalla de la caja enseña los dos bloques solo si el servidor lo permite', () => {
  const p = limpio('src/app/(empleado)/empleado/caja/page.tsx')
  assert.match(p, /await posPermitido\(companyId\)/)
  assert.match(p, /pos\.cobrarPedidos && <CobrarPedidoMembego/)
  assert.match(p, /pos\.venderEnMostrador && <VentaMostrador/)
})

test('cobrar un pedido bloquea la fila ANTES de leerla y nunca sustituye un pago que el pedido ya tiene (auditoría F5–F9, A1 y M6)', () => {
  const s = limpio('src/modules/pos/service.ts')
  const cobrar = s.slice(s.indexOf('export async function cobrarPedidoEnCajaEnTx'), s.indexOf('export interface EntradaDeVenta'))
  const bloqueo = cobrar.indexOf('bloquearPedidoEnTx(')
  assert.ok(bloqueo > 0, 'toma el candado del pedido')
  assert.ok(bloqueo < cobrar.indexOf('registrarPagoEnTx('), 'el candado va antes de registrar el pago')
  assert.ok(bloqueo < cobrar.indexOf('validarCobroPos('), 'y antes de validar el cobro contra el total')
  assert.match(cobrar, /PEDIDO_YA_PAGADO/)
  assert.match(cobrar, /SIN_PAGO_REGISTRADO/)
  // Entregar sin cobrar cierra con el QR y no escribe nada en la caja.
  const entrega = cobrar.slice(cobrar.indexOf('if (entregarSinCobrar)'), cobrar.indexOf('if (p.payment)'))
  assert.match(entrega, /completarPorQrEnTx\(/)
  assert.doesNotMatch(entrega, /registrarPagoEnTx|registrarCobroEnCajaEnTx/)
})

test('la caja cuenta en pesos: ni el catálogo, ni la vista previa, ni la venta aceptan otra moneda', () => {
  const s = limpio('src/modules/pos/service.ts')
  assert.match(s, /export const MONEDA_DE_CAJA = 'DOP'/)
  assert.match(s, /currency: MONEDA_DE_CAJA/)
  assert.match(s, /MONEDA_NO_SOPORTADA/)
})

test('buscar clientes en la caja (nombre y teléfono) tiene límite de envíos: el directorio no se vacía a golpe de búsquedas (auditoría F5–F9)', () => {
  const cuerpo = acciones.slice(acciones.indexOf('export async function buscarClientesCaja('))
  const fin = cuerpo.indexOf('export async function', 10)
  const b = cuerpo.slice(0, fin)
  assert.ok(b.indexOf('formSubmitLimiter(') > 0 && b.indexOf('formSubmitLimiter(') < b.indexOf('conEmpresa('))
})
