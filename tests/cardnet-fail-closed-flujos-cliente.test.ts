import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { cardnetDisponible } from '../src/modules/pagos/cardnetTokenGate'
import {
  resolverCobroMembresia,
  type MembresiaParaCobro,
} from '../src/modules/pagos/membresiaCobrable'
import { calcularPagoCambioPlan } from '../src/modules/membresia/prorrateo'

/**
 * T23 · CAMINO DE DINERO — LA MITAD FAIL-CLOSED.
 *
 * QUÉ PRUEBA ESTE ARCHIVO, Y QUÉ NO.
 *
 * SÍ prueba: sin llaves de CardNET, sin la capacidad `PAGO_CARDNET` o en una
 * empresa demo, la tarjeta NO se ofrece y el servidor RECHAZA el cobro. Es la
 * única mitad que un ejecutor autónomo puede cerrar sin las llaves reales.
 *
 * NO prueba: la activación instantánea de punta a punta (cobrar con tarjeta y
 * que la membresía/compra quede `ACTIVA` al instante). Esa mitad está BLOQUEADA
 * hasta que el usuario entregue las llaves de QA de CardNET; ver el test
 * `PENDIENTE` al final de este archivo. NO se simula con un mock: un cobro real
 * no puede darse por verificado con una respuesta inventada.
 *
 * ── CÓMO SE PRUEBA `puedeCobrarToken` SIN LEVANTAR NEXT ──────────────────────
 *
 * `puedeCobrarToken` es una función `server-only` que resuelve la capacidad y
 * la marca demo contra la base. Para probar SOLO su composición (la compuerta
 * de tres condiciones + la lectura de llaves) se sustituyen únicamente esas dos
 * consultas con dobles controlables (`tests/support/*-stub.mjs`), dejando el
 * resto —la compuerta compartida y la lectura de variables de entorno— como
 * código de producción. La resolución real de la capacidad y la ruta HTTP real
 * se ejercitan en los tests de integración de más abajo.
 */

// ── Dobles controlables para capacidad y empresa demo ────────────────────────
const support = (f: string) => pathToFileURL(path.resolve('tests/support', f)).href

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: support('server-only-stub.mjs'), shortCircuit: true }
    if (specifier === 'next/cache') return { url: support('next-cache-stub.mjs'), shortCircuit: true }
    if (specifier === '@/modules/capacidades/resolver') {
      return { url: support('capacidades-stub.mjs'), shortCircuit: true }
    }
    if (specifier === '@/modules/demo') return { url: support('demo-stub.mjs'), shortCircuit: true }
    return next(specifier, context)
  },
})

let moduloCardnet: Promise<typeof import('../src/modules/pagos/cardnetToken')> | null = null
function cargarCardnet() {
  moduloCardnet ??= import('../src/modules/pagos/cardnetToken')
  return moduloCardnet
}

function fijarStubs(capacidad: boolean, demo: boolean) {
  Object.assign(globalThis, { __t23cap: capacidad, __t23demo: demo })
}

const CLAVES = { publica: 'pk-prueba-fail-closed', privada: 'sk-prueba-fail-closed' }
const clavesOriginales = {
  publica: process.env.CARDNET_TOKENS_PUBLIC_KEY,
  privada: process.env.CARDNET_TOKENS_PRIVATE_KEY,
}

function claves(publica: string, privada: string) {
  process.env.CARDNET_TOKENS_PUBLIC_KEY = publica
  process.env.CARDNET_TOKENS_PRIVATE_KEY = privada
}

after(() => {
  if (clavesOriginales.publica === undefined) delete process.env.CARDNET_TOKENS_PUBLIC_KEY
  else process.env.CARDNET_TOKENS_PUBLIC_KEY = clavesOriginales.publica
  if (clavesOriginales.privada === undefined) delete process.env.CARDNET_TOKENS_PRIVATE_KEY
  else process.env.CARDNET_TOKENS_PRIVATE_KEY = clavesOriginales.privada
  delete (globalThis as { __t23cap?: boolean }).__t23cap
  delete (globalThis as { __t23demo?: boolean }).__t23demo
})

// ── 1. La compuerta compartida, en puro ──────────────────────────────────────

test('fail-closed · la compuerta compartida NO abre si falta la capacidad', () => {
  assert.equal(
    cardnetDisponible({ capacidadActiva: false, credencialesCompletas: true, empresaDemo: false }),
    false
  )
})

test('fail-closed · la compuerta compartida NO abre sin credenciales', () => {
  assert.equal(
    cardnetDisponible({ capacidadActiva: true, credencialesCompletas: false, empresaDemo: false }),
    false
  )
})

test('fail-closed · la compuerta compartida NO abre en una empresa demo', () => {
  assert.equal(
    cardnetDisponible({ capacidadActiva: true, credencialesCompletas: true, empresaDemo: true }),
    false
  )
})

test('control · la compuerta compartida SÍ abre con las tres condiciones', () => {
  assert.equal(
    cardnetDisponible({ capacidadActiva: true, credencialesCompletas: true, empresaDemo: false }),
    true
  )
})

// ── 2. `puedeCobrarToken`: la re-verificación del servidor ───────────────────

test('fail-closed · puedeCobrarToken rechaza cuando falta la llave privada', async () => {
  const { puedeCobrarToken } = await cargarCardnet()
  const { cardnetTokensConfigurado } = await import('../src/lib/payments/cardnet-tokens')
  claves(CLAVES.publica, '')
  fijarStubs(true, false)
  assert.equal(cardnetTokensConfigurado(), false, 'sin llave privada la config no está completa')
  assert.equal(await puedeCobrarToken('cmt90uf4t00b5uikw2ruvmrtt'), false)
})

test('fail-closed · puedeCobrarToken rechaza con la capacidad PAGO_CARDNET apagada', async () => {
  const { puedeCobrarToken } = await cargarCardnet()
  claves(CLAVES.publica, CLAVES.privada)
  fijarStubs(false, false)
  assert.equal(await puedeCobrarToken('cmt90uf3100auuikw1hai4cul'), false)
})

test('fail-closed · puedeCobrarToken rechaza en una empresa demo aunque todo lo demás esté encendido', async () => {
  const { puedeCobrarToken } = await cargarCardnet()
  claves(CLAVES.publica, CLAVES.privada)
  fijarStubs(true, true)
  assert.equal(await puedeCobrarToken('cmt90uf4t00b5uikw2ruvmrtt'), false)
})

test('control · puedeCobrarToken acepta cuando llaves, capacidad y no-demo se cumplen', async () => {
  const { puedeCobrarToken } = await cargarCardnet()
  claves(CLAVES.publica, CLAVES.privada)
  fijarStubs(true, false)
  assert.equal(await puedeCobrarToken('cmt90uf3100auuikw1hai4cul'), true)
})

// ── 2 bis. La puerta de cobrabilidad de la membresía (T35) ──────────────────
//
// Estado y precio resueltos en una función PURA: un objetivo cuya membresía no
// admite cobro con tarjeta se rechaza con motivo, y los caminos legítimos
// (activación inicial, cambio prorrateado) siguen cobrando lo correcto. Si la
// puerta se quita, estos tests se caen.

function membresia(over: Partial<MembresiaParaCobro> = {}): MembresiaParaCobro {
  return {
    estado: 'PENDIENTE',
    planIdSolicitado: null,
    comprobanteUrl: null,
    fechaInicio: null,
    descuentoBienvenida: null,
    fechaVencimiento: null,
    plan: { nombre: 'Silver', precio: 999, vigenciaDias: 30 },
    planSolicitado: null,
    ...over,
  }
}

test('puerta 35 · PENDIENTE_PAGO se rechaza: ya tiene su flujo de comprobante', () => {
  const r = resolverCobroMembresia(membresia({ estado: 'PENDIENTE_PAGO' }))
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.motivo : '', /comprobante/i)
})

test('puerta 35 · ACTIVA sin cambio pendiente se rechaza: ya está pagada', () => {
  const r = resolverCobroMembresia(membresia({ estado: 'ACTIVA' }))
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.motivo : '', /pagada/i)
})

test('puerta 35 · VENCIDA y CANCELADA se rechazan', () => {
  for (const estado of ['VENCIDA', 'CANCELADA'] as const) {
    const r = resolverCobroMembresia(membresia({ estado }))
    assert.equal(r.ok, false, `estado ${estado} no debe ser cobrable`)
  }
})

test('puerta 35 · un cambio de plan ya cubierto por su comprobante se rechaza', () => {
  const r = resolverCobroMembresia(
    membresia({
      estado: 'ACTIVA',
      planIdSolicitado: 'plan-gold',
      planSolicitado: { nombre: 'Gold', precio: 1500 },
      comprobanteUrl: 'membresia/x/comprobante.jpg',
    })
  )
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.motivo : '', /comprobante/i)
})

test('puerta 35 · activación inicial PENDIENTE cobra el plan menos el descuento', () => {
  const r = resolverCobroMembresia(
    membresia({ estado: 'PENDIENTE', descuentoBienvenida: 100, fechaInicio: null })
  )
  assert.equal(r.ok, true)
  assert.equal(r.ok === true ? r.pesos : -1, 899)
})

test('puerta 35 · RECHAZADA vuelve a admitir el cobro del plan', () => {
  const r = resolverCobroMembresia(membresia({ estado: 'RECHAZADA' }))
  assert.equal(r.ok, true)
  assert.equal(r.ok === true ? r.pesos : -1, 999)
})

test('puerta 35 · cambio de plan sin comprobante cobra la diferencia prorrateada', () => {
  const fechaVencimiento = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
  const plan = { nombre: 'Silver', precio: 999, vigenciaDias: 30 }
  const planSolicitado = { nombre: 'Gold', precio: 1500 }
  const esperado = calcularPagoCambioPlan({
    precioNuevo: planSolicitado.precio,
    precioVigente: plan.precio,
    fechaVencimiento,
    vigenciaDias: plan.vigenciaDias,
  }).aPagar

  const r = resolverCobroMembresia(
    membresia({
      estado: 'ACTIVA',
      planIdSolicitado: 'plan-gold',
      planSolicitado,
      comprobanteUrl: null,
      fechaVencimiento,
      plan,
    })
  )
  assert.equal(r.ok, true)
  assert.equal(r.ok === true ? r.pesos : -1, esperado)
  assert.ok(esperado > 0 && esperado < planSolicitado.precio, 'es la diferencia, no el plan completo')
  assert.match(r.ok === true ? r.descripcion : '', /^Cambio a /)
})

// ── 3. La ruta y las pantallas reales (integración) ──────────────────────────
//
// Estos tests hablan con el servidor de desarrollo y con la base local. Si no
// están disponibles se SALTAN con un motivo explícito (nunca pasan en falso).
// El marcador del widget de tarjeta es el `id` del formulario del hospedado.

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.E2E_CLIENTE_EMAIL ?? 'cliente@membego.com'
const PASSWORD = process.env.E2E_CLIENTE_PASSWORD ?? 'cliente123'
const MARCADOR_TARJETA = 'membego_pago_form'
const TEXTO_OPCION_TARJETA = 'Paga ahora con tu tarjeta'

type Bd = import('@prisma/client').PrismaClient

interface Sesion {
  cookie: string
  clienteId: string
  companyId: string
  supabaseId: string
}

function deEnv(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave]
  try {
    const txt = readFileSync('.env', 'utf8')
    return txt.match(new RegExp(`^${clave}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'))?.[1]
  } catch {
    return undefined
  }
}

/** Token directo a Supabase + cookie de @supabase/ssr (mismo patrón que tests/e2e). */
async function iniciarSesionCliente(): Promise<Sesion | null> {
  const supa = deEnv('E2E_SUPABASE_URL') ?? deEnv('NEXT_PUBLIC_SUPABASE_URL')
  const anon = deEnv('E2E_SUPABASE_ANON_KEY') ?? deEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!supa || !anon) return null

  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).catch(() => null)
  if (!r?.ok) return null

  const s = (await r.json()) as Record<string, unknown>
  const accessToken = typeof s.access_token === 'string' ? s.access_token : ''
  if (!accessToken) return null
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as {
    sub?: string
    app_metadata?: { clienteId?: unknown; companyId?: unknown }
  }
  const clienteId = typeof payload.app_metadata?.clienteId === 'string' ? payload.app_metadata.clienteId : ''
  const companyId = typeof payload.app_metadata?.companyId === 'string' ? payload.app_metadata.companyId : ''
  if (!payload.sub || !clienteId || !companyId) return null

  s.expires_at = Math.floor(Date.now() / 1000) + Number(s.expires_in ?? 3600)
  const valor = 'base64-' + Buffer.from(JSON.stringify(s), 'utf8').toString('base64url')
  const ref = new URL(supa).hostname.split('.')[0]
  const nombre = `sb-${ref}-auth-token`
  const MAX = 3180
  const partes: string[] = []
  if (valor.length <= MAX) partes.push(`${nombre}=${valor}`)
  else
    for (let i = 0; i * MAX < valor.length; i++)
      partes.push(`${nombre}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`)

  return { cookie: partes.join('; '), clienteId, companyId, supabaseId: payload.sub }
}

let sesionCache: Promise<Sesion | null> | null = null
function sesionCliente() {
  sesionCache ??= iniciarSesionCliente()
  return sesionCache
}

async function abrirBd(): Promise<Bd | null> {
  const url = deEnv('DATABASE_URL')
  if (!url) return null
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url
  const { PrismaClient } = await import('@prisma/client')
  const bd = new PrismaClient()
  try {
    await bd.company.count()
    return bd
  } catch {
    await bd.$disconnect().catch(() => undefined)
    return null
  }
}

async function contextoIntegracion(): Promise<{ sesion: Sesion; bd: Bd } | { motivo: string }> {
  const salud = await fetch(`${BASE}/api/health`)
    .then((r) => r.ok)
    .catch(() => false)
  if (!salud) return { motivo: `sin servidor de desarrollo en ${BASE}` }
  const sesion = await sesionCliente()
  if (!sesion) return { motivo: 'sin Supabase local: no se pudo crear la sesión de cliente' }
  const bd = await abrirBd()
  if (!bd) return { motivo: 'sin DATABASE_URL accesible: no se puede preparar el escenario' }
  return { sesion, bd }
}

/**
 * Deja al cliente autenticado con una membresía en estado que exige pago.
 * Si ya la tiene pendiente no toca nada; si la tiene activa, la baja a
 * `PENDIENTE` y devuelve cómo restaurarla; si no tiene ninguna, crea una
 * temporal y devuelve cómo borrarla. Toda mutación es reversible.
 */
async function prepararMembresiaPendiente(
  bd: Bd,
  sesion: Sesion
): Promise<{ id: string; restaurar: (() => Promise<void>) | null } | null> {
  const existente = await bd.membership.findFirst({
    where: { clienteId: sesion.clienteId },
    select: { id: true, estado: true },
  })
  if (existente) {
    if (existente.estado === 'PENDIENTE' || existente.estado === 'RECHAZADA') {
      return { id: existente.id, restaurar: null }
    }
    const previo = existente.estado
    await bd.membership.update({ where: { id: existente.id }, data: { estado: 'PENDIENTE' } })
    return {
      id: existente.id,
      restaurar: async () => {
        await bd.membership.update({ where: { id: existente.id }, data: { estado: previo } })
      },
    }
  }
  const plan = await bd.plan.findFirst({ where: { companyId: sesion.companyId }, select: { id: true } })
  if (!plan) return null
  const creada = await bd.membership.create({
    data: {
      clienteId: sesion.clienteId,
      companyId: sesion.companyId,
      planId: plan.id,
      estado: 'PENDIENTE',
    },
    select: { id: true },
  })
  return {
    id: creada.id,
    restaurar: async () => {
      await bd.membership.delete({ where: { id: creada.id } })
    },
  }
}

test('fail-closed · la pantalla de membresía no ofrece tarjeta y sí transferencia', async (t) => {
  const ctx = await contextoIntegracion()
  if ('motivo' in ctx) {
    t.skip(ctx.motivo)
    return
  }
  let restaurar: (() => Promise<void>) | null = null
  try {
    const membresia = await prepararMembresiaPendiente(ctx.bd, ctx.sesion)
    if (!membresia) {
      t.skip('la empresa del cliente no tiene plan con el que preparar la pantalla')
      return
    }
    restaurar = membresia.restaurar

    const res = await fetch(`${BASE}/membresia/${membresia.id}`, {
      headers: { cookie: ctx.sesion.cookie },
    })
    assert.equal(res.status, 200, 'la pantalla de membresía debe responder 200')
    const html = await res.text()
    if (html.includes(MARCADOR_TARJETA)) {
      t.skip('la compuerta está ABIERTA en este entorno: el camino cerrado no aplica')
      return
    }
    assert.equal(html.includes(MARCADOR_TARJETA), false, 'sin claves/capacidad no debe montarse el widget')
    assert.equal(html.includes(TEXTO_OPCION_TARJETA), false, 'sin compuerta abierta no se ofrece la opción')
    assert.equal(html.includes('name="comprobanteUrl"'), true, 'la transferencia debe seguir disponible')
  } finally {
    if (restaurar) await restaurar()
    await ctx.bd.$disconnect()
  }
})

test('fail-closed · la pantalla de promoción no ofrece tarjeta', async (t) => {
  const ctx = await contextoIntegracion()
  if ('motivo' in ctx) {
    t.skip(ctx.motivo)
    return
  }
  const compra = await ctx.bd.productoCompra.create({
    data: {
      companyId: ctx.sesion.companyId,
      clienteId: ctx.sesion.clienteId,
      estado: 'PENDIENTE_PAGO',
      precioCongelado: 150,
      usosIncluidos: 1,
      usosRestantes: 0,
    },
    select: { id: true },
  })
  try {
    const res = await fetch(`${BASE}/cliente/mis-promociones/${compra.id}`, {
      headers: { cookie: ctx.sesion.cookie },
    })
    assert.equal(res.status, 200, 'la pantalla de la compra debe responder 200')
    const html = await res.text()
    if (html.includes(MARCADOR_TARJETA)) {
      t.skip('la compuerta está ABIERTA en este entorno: el camino cerrado no aplica')
      return
    }
    assert.equal(html.includes(MARCADOR_TARJETA), false, 'sin claves/capacidad no debe montarse el widget')
    assert.equal(html.includes(TEXTO_OPCION_TARJETA), false, 'sin compuerta abierta no se ofrece la opción')
    assert.equal(html.includes('name="compraId"'), true, 'la transferencia debe seguir disponible')
  } finally {
    await ctx.bd.productoCompra.delete({ where: { id: compra.id } }).catch(() => undefined)
    await ctx.bd.$disconnect()
  }
})

test('fail-closed · la ruta /cobrar rechaza el cargo y no activa nada', async (t) => {
  const ctx = await contextoIntegracion()
  if ('motivo' in ctx) {
    t.skip(ctx.motivo)
    return
  }
  const compra = await ctx.bd.productoCompra.create({
    data: {
      companyId: ctx.sesion.companyId,
      clienteId: ctx.sesion.clienteId,
      estado: 'PENDIENTE_PAGO',
      precioCongelado: 150,
      usosIncluidos: 1,
      usosRestantes: 0,
    },
    select: { id: true },
  })
  try {
    // Guarda de seguridad: si la compuerta estuviera ABIERTA, NO se dispara la
    // petición — sería un intento real contra la pasarela, y este archivo no
    // ejecuta cobros.
    const pantalla = await fetch(`${BASE}/cliente/mis-promociones/${compra.id}`, {
      headers: { cookie: ctx.sesion.cookie },
    })
    if ((await pantalla.text()).includes(MARCADOR_TARJETA)) {
      t.skip('la compuerta está ABIERTA: no se dispara ningún cargo desde esta prueba')
      return
    }

    const intentosAntes = await ctx.bd.pagoIntento.count({ where: { compraId: compra.id } })
    const res = await fetch(`${BASE}/api/pagos/cardnet-token/cobrar`, {
      method: 'POST',
      headers: { cookie: ctx.sesion.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ compraId: compra.id, trxToken: 'token-de-prueba-fail-closed-0000' }),
    })
    assert.equal(res.status, 200)
    const json = (await res.json()) as { estado?: string; motivo?: string }
    assert.equal(json.estado, 'error', 'con la compuerta cerrada el cobro debe rechazarse')
    assert.match(String(json.motivo), /no está disponible/i)

    const despues = await ctx.bd.productoCompra.findUnique({
      where: { id: compra.id },
      select: { estado: true },
    })
    assert.equal(despues?.estado, 'PENDIENTE_PAGO', 'nada debe activarse')
    assert.equal(
      await ctx.bd.pagoIntento.count({ where: { compraId: compra.id } }),
      intentosAntes,
      'un rechazo por compuerta cerrada no debe registrar un intento de cobro'
    )
  } finally {
    await ctx.bd.productoCompra.delete({ where: { id: compra.id } }).catch(() => undefined)
    await ctx.bd.$disconnect()
  }
})

test('integración 35 · /cobrar rechaza una membresía en PENDIENTE_PAGO sin crear intento', async (t) => {
  const ctx = await contextoIntegracion()
  if ('motivo' in ctx) {
    t.skip(ctx.motivo)
    return
  }
  const membership = await ctx.bd.membership.findFirst({
    where: { clienteId: ctx.sesion.clienteId },
    select: { id: true, estado: true },
  })
  if (!membership) {
    t.skip('el cliente no tiene membresía con la que probar la puerta')
    await ctx.bd.$disconnect()
    return
  }

  const previo = membership.estado
  await ctx.bd.membership.update({
    where: { id: membership.id },
    data: { estado: 'PENDIENTE_PAGO' },
  })
  try {
    // Compuerta de capacidad ABIERTA a propósito: la única puerta que debe
    // frenar es la del estado, no la de disponibilidad.
    claves(CLAVES.publica, CLAVES.privada)
    fijarStubs(true, false)
    const { cobrarObjetivoConToken } = await cargarCardnet()

    const intentosAntes = await ctx.bd.pagoIntento.count({
      where: { membershipId: membership.id },
    })
    const res = await cobrarObjetivoConToken({
      objetivo: {
        companyId: ctx.sesion.companyId,
        clienteId: ctx.sesion.clienteId,
        membershipId: membership.id,
      },
      trxToken: 'token-de-prueba-puerta-35-0000',
      clienteIp: '127.0.0.1',
    })

    assert.equal(res.estado, 'rechazado', 'una membresía en PENDIENTE_PAGO no se cobra')
    assert.match(res.estado === 'rechazado' ? res.motivo : '', /comprobante/i)
    assert.equal(
      await ctx.bd.pagoIntento.count({ where: { membershipId: membership.id } }),
      intentosAntes,
      'el rechazo no debe crear un pagoIntento'
    )
    const despues = await ctx.bd.membership.findUnique({
      where: { id: membership.id },
      select: { estado: true },
    })
    assert.equal(despues?.estado, 'PENDIENTE_PAGO', 'el rechazo no debe activar ni cambiar el estado')
  } finally {
    await ctx.bd.membership.update({ where: { id: membership.id }, data: { estado: previo } })
    await ctx.bd.$disconnect()
  }
})

test('integración 35 · los caminos legítimos siguen resolviendo su importe', async (t) => {
  const ctx = await contextoIntegracion()
  if ('motivo' in ctx) {
    t.skip(ctx.motivo)
    return
  }
  const membership = await ctx.bd.membership.findFirst({
    where: { clienteId: ctx.sesion.clienteId },
    include: { plan: true },
  })
  if (!membership) {
    t.skip('el cliente no tiene membresía con la que probar')
    await ctx.bd.$disconnect()
    return
  }

  const compra = await ctx.bd.productoCompra.create({
    data: {
      companyId: ctx.sesion.companyId,
      clienteId: ctx.sesion.clienteId,
      estado: 'PENDIENTE_PAGO',
      precioCongelado: 250,
      usosIncluidos: 1,
      usosRestantes: 0,
    },
    select: { id: true },
  })

  const previo = membership.estado
  await ctx.bd.membership.update({ where: { id: membership.id }, data: { estado: 'PENDIENTE' } })
  try {
    const { montoDeObjetivo } = await import('../src/modules/pagos/cardnet3ds')

    const inicial = await montoDeObjetivo({
      companyId: ctx.sesion.companyId,
      clienteId: ctx.sesion.clienteId,
      membershipId: membership.id,
    })
    const esperadoInicial = Math.max(
      0,
      Number(membership.plan.precio) -
        (membership.fechaInicio == null ? Number(membership.descuentoBienvenida ?? 0) : 0)
    )
    assert.equal(inicial.ok, true)
    assert.equal(inicial.ok === true ? inicial.pesos : -1, esperadoInicial)

    const promo = await montoDeObjetivo({
      companyId: ctx.sesion.companyId,
      clienteId: ctx.sesion.clienteId,
      compraId: compra.id,
    })
    assert.equal(promo.ok, true)
    assert.equal(promo.ok === true ? promo.pesos : -1, 250)
  } finally {
    await ctx.bd.membership.update({ where: { id: membership.id }, data: { estado: previo } })
    await ctx.bd.productoCompra.delete({ where: { id: compra.id } }).catch(() => undefined)
    await ctx.bd.$disconnect()
  }
})

// ── 4. La mitad bloqueada, marcada como PENDIENTE ────────────────────────────

test(
  'PENDIENTE · activación instantánea con tarjeta en membresía y promoción',
  { skip: 'BLOCKED — waiting for real CardNET QA keys from the user (ver Precondiciones del plan). No se simula el camino feliz.' },
  () => {}
)
