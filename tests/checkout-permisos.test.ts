import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** CHECKOUT · guardias y separación (Fase 8). El comportamiento contra la base está en `tests/postgres/checkout.db.test.ts`. */

const limpio = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const acciones = limpio('src/modules/checkout/actions.ts')
const servicio = limpio('src/modules/checkout/service.ts')
const cuerpo = (nombre: string) => acciones.slice(acciones.indexOf(`export async function ${nombre}(`))

test('el archivo de acciones exporta solo dos funciones: leer el carrito (pública) y pagarlo (cliente)', () => {
  const exportadas = [...acciones.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(exportadas.sort(), ['hacerCheckout', 'resumirCarrito'])
})

test('pagar exige sesión de CLIENTE y un límite de envíos ANTES de tocar la base', () => {
  const c = cuerpo('hacerCheckout')
  assert.match(c, /getUser\(\)/)
  assert.match(c, /role !== 'CLIENTE'/)
  assert.ok(c.indexOf("role !== 'CLIENTE'") < c.indexOf('sinEmpresa('))
  assert.ok(c.indexOf('formSubmitLimiter(') > 0 && c.indexOf('formSubmitLimiter(') < c.indexOf('sinEmpresa('))
  assert.ok(c.indexOf('formSubmitLimiter(') < c.indexOf('conEmpresa('))
})

test('la empresa sale de las variantes del carrito (todas de la misma) y nunca de un campo del navegador', () => {
  const c = cuerpo('hacerCheckout')
  assert.match(c, /empresas\.size !== 1/)
  assert.doesNotMatch(c, /entrada\.(companyId|empresaId|companySlug|customerId|clienteId)/)
  // La ficha de cliente es la de la sesión en esa empresa.
  assert.match(c, /asegurarClienteEnEmpresa\(user\.supabaseId/)
})

test('ningún precio, descuento, total ni nivel de verificación cruza desde el navegador al servicio', () => {
  assert.doesNotMatch(acciones, /entrada\.(precio|price|total|descuento|discount|nivel|verificationLevel|status|estado)/)
  const llamada = servicio.slice(servicio.indexOf('await crearPedidoEnTx('))
  assert.match(llamada, /lineas: e\.lineas\.map\(\(l\) => \(\{ varianteId: l\.varianteId, cantidad: l\.cantidad \}\)\)/)
  assert.match(llamada, /origin: 'MARKETPLACE'/)
  assert.doesNotMatch(llamada, /precioUnitario|descuento/)
})

test('el canal del pedido sale de una lista cerrada y no se puede declarar QR ni cupón', () => {
  assert.match(servicio, /CANALES_DE_CHECKOUT/)
  assert.doesNotMatch(servicio, /channel: e\.canal/)
})

test('resumir el carrito es solo lectura, pública con límite por IP, y solo de negocios publicados que reciben pedidos', () => {
  const resto = cuerpo('resumirCarrito')
  const solo = resto.slice(0, resto.indexOf('export async function hacerCheckout'))
  assert.match(solo, /getClientIdentifier/)
  assert.match(solo, /isPublished: true, isActive: true, esDemo: false/)
  assert.match(solo, /empresaRecibePedidos\(/)
  assert.doesNotMatch(solo, /\.(create|update|updateMany|delete|deleteMany|upsert)\(/)
  // La sesión (si hay) solo decide cuánto detalle de existencias se enseña: nunca se exige ni corta la respuesta.
  assert.match(solo, /conSesionDeCliente = \(await getUser\(\)\)\?\.metadata\.role === 'CLIENTE'/)
  assert.doesNotMatch(solo, /if \(!user\)|sinSesion/)
})

test('el servicio del carrito no escribe pedidos por su cuenta ni importa Supply', () => {
  for (const f of readdirSync('src/modules/checkout').filter((x) => x.endsWith('.ts'))) {
    const t = limpio(join('src/modules/checkout', f))
    for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.doesNotMatch(m[1], /supply/i, `${f} importa ${m[1]}`)
    assert.doesNotMatch(t, /\btx\.(membegoOrder|membegoOrderLine|inventoryLevel|inventoryReservation)\.(create|update|updateMany|delete|deleteMany|upsert)\(/, `${f} escribe directo`)
  }
})

test('la parte pura del carrito no importa nada del servidor (la usan componentes de cliente)', () => {
  const t = limpio('src/modules/checkout/domain.ts')
  for (const m of t.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^@prisma\/client$/)
  assert.doesNotMatch(t, /import(?!\s+type)[^;\n]*@prisma\/client/)
})

test('pagar reutiliza el único camino para crear pedidos y no cobra: la transferencia solo queda anotada como intención', () => {
  assert.match(servicio, /crearPedidoEnTx\(/)
  assert.doesNotMatch(servicio, /registrarPagoEnTx|completarPorQrEnTx|cerrarPedidoExternoEnTx|marcarListoEnTx/)
})

test('la lectura pública del carrito no devuelve el número exacto de existencias', () => {
  const resto = cuerpo('resumirCarrito')
  const solo = resto.slice(0, resto.indexOf('export async function hacerCheckout'))
  assert.match(solo, /aResumenPublico\(resumen, \{ conSesionDeCliente \}\)/)
})

test('pagar no afilia a nadie por un pedido que ya se sabe que va a fallar (auditoría F5–F9, M7)', () => {
  const c = cuerpo('hacerCheckout')
  const previa = c.indexOf('problemaDelPedidoEnTx(')
  assert.ok(previa > 0, 'comprueba método, sucursal y carrito antes')
  assert.ok(previa < c.indexOf('asegurarClienteEnEmpresa('), 'y lo hace ANTES de crear la ficha, el seguimiento y el regalo de bienvenida')
  assert.match(servicio, /export async function problemaDelPedidoEnTx/)
  // Solo lee.
  const fn = servicio.slice(servicio.indexOf('export async function problemaDelPedidoEnTx'), servicio.indexOf('export async function crearPedidoDelCarritoEnTx'))
  assert.doesNotMatch(fn, /\.(create|update|updateMany|delete|deleteMany|upsert)\(/)
})

test('la lectura pública no enseña el nombre ni el precio de lo que no se puede comprar, ni «solo quedan N» sin sesión (auditoría F5–F9, M8)', () => {
  assert.match(servicio, /Producto no disponible/)
  assert.match(servicio, /No hay suficientes en esta sucursal\./)
  assert.match(servicio, /conSesionDeCliente/)
})
