import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'
import type { BrowserContext } from '@playwright/test'

/**
 * SESIONES FIRMADAS LOCALMENTE para los E2E de Supply.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO PASA POR SUPABASE
 *
 * El recorrido autenticado exige dos personas distintas (quien crea la orden
 * no puede aprobarla) y un entorno de CI sin proyecto de Supabase. La
 * aplicación ya sabe validar una sesión SIN red: `verifyLocalSession()`
 * verifica la firma HS256 del access token con `SUPABASE_JWT_SECRET`, y
 * `getUser()` cae a esa verificación cuando el servidor de auth no responde
 * (docs/SEGURIDAD-AUTH.md). Aquí se firma un token con ese mismo secreto y
 * se guarda en la cookie con el formato que usa `@supabase/ssr`
 * (`base64-` + JSON en base64url).
 *
 * Solo funciona cuando quien corre las pruebas CONOCE el secreto del entorno
 * probado —en CI es un valor de relleno y `NEXT_PUBLIC_SUPABASE_URL` apunta a
 * un puerto sin nadie escuchando—. Contra producción no sirve de nada: el
 * secreto real no está aquí, y una firma inválida se rechaza.
 *
 * Los usuarios se crean en la base con Prisma (los E2E corren en Node), con
 * correos fijos e idempotentes: dos corridas no acumulan cuentas.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface UsuarioE2E {
  id: string
  supabaseId: string
  email: string
  nombre: string
  role: 'SUPERADMIN' | 'CLIENTE' | 'ADMINISTRADOR'
  /** Empresa activa de la sesión (empleados del proveedor). */
  companyId: string | null
}

const USUARIOS = {
  compras: { email: 'e2e.supply2.compras@membego.test', nombre: 'Compras E2E', role: 'SUPERADMIN' },
  finanzas: { email: 'e2e.supply2.finanzas@membego.test', nombre: 'Finanzas E2E', role: 'SUPERADMIN' },
  cliente: { email: 'e2e.supply2.cliente@membego.test', nombre: 'Ana Cliente E2E', role: 'CLIENTE' },
  cliente2: { email: 'e2e.supply2.cliente2@membego.test', nombre: 'Luis Cliente E2E', role: 'CLIENTE' },
  /** Slice 3: quien escanea en el comercio. Necesita `companyId`: ver `asegurarEmpleado`. */
  empleado: { email: 'e2e.supply2.empleado@membego.test', nombre: 'Pedro Encargado E2E', role: 'ADMINISTRADOR' },
  /** Segundo encargado, para que escritorio y móvil corran a la vez sin pisarse la empresa. */
  empleado2: { email: 'e2e.supply2.empleado2@membego.test', nombre: 'Rosa Encargada E2E', role: 'ADMINISTRADOR' },
  /**
   * Slice 9: la cuenta con la que CORRE la integración de pagos externos
   * (`SUPPLY_V2_WEBHOOK_ACTOR_ID`), y con la que no entra nadie al navegador.
   *
   * Es una cuenta aparte a propósito, y no la de finanzas: el bloque 3 prohíbe
   * que quien procesa el aviso de la pasarela sea quien cierra el incidente que
   * ese aviso abrió. Si el arnés reutilizara aquí a `finanzas`, el recorrido de
   * resolución fallaría con `ACTOR_DE_INTEGRACION` —y fallaría con razón—.
   */
  integracion: { email: 'e2e.supply2.integracion@membego.test', nombre: 'Integración Supply E2E', role: 'SUPERADMIN' },
  /**
   * Commerce Core · catálogo (F1): el administrador de una empresa CON la
   * capacidad y el de otra SIN ella. Viven aquí y no en un archivo propio
   * porque firmar la sesión es lo mismo; el nombre del archivo es de origen.
   */
  catalogoConCapacidad: { email: 'e2e.catalogo.con@membego.test', nombre: 'Admin Catálogo E2E', role: 'ADMINISTRADOR' },
  catalogoSinCapacidad: { email: 'e2e.catalogo.sin@membego.test', nombre: 'Admin Sin Catálogo E2E', role: 'ADMINISTRADOR' },
  /** Commerce Core · pedidos (F3): quien atiende los pedidos de una empresa, quien los pide y quien tiene el catálogo pero no los pedidos. */
  pedidosAdmin: { email: 'e2e.pedidos.admin@membego.test', nombre: 'Admin Pedidos E2E', role: 'ADMINISTRADOR' },
  pedidosCliente: { email: 'e2e.pedidos.cliente@membego.test', nombre: 'Marta Pedidos E2E', role: 'CLIENTE' },
  pedidosSinCapacidad: { email: 'e2e.pedidos.sin@membego.test', nombre: 'Admin Sin Pedidos E2E', role: 'ADMINISTRADOR' },
  /** Commerce Core · ofertas con presupuesto (F5): quien las crea y publica, y tres personas que las reclaman. */
  dealsAdmin: { email: 'e2e.deals.admin@membego.test', nombre: 'Admin Ofertas E2E', role: 'ADMINISTRADOR' },
  dealsSinCapacidad: { email: 'e2e.deals.sin@membego.test', nombre: 'Admin Sin Ofertas E2E', role: 'ADMINISTRADOR' },
  dealsCliente: { email: 'e2e.deals.cliente@membego.test', nombre: 'Carla Ofertas E2E', role: 'CLIENTE' },
  dealsCliente2: { email: 'e2e.deals.cliente2@membego.test', nombre: 'Diego Ofertas E2E', role: 'CLIENTE' },
  dealsCliente3: { email: 'e2e.deals.cliente3@membego.test', nombre: 'Elena Ofertas E2E', role: 'CLIENTE' },
  /** Analítica (F6): el administrador de una empresa con pedidos, el de otra con pedidos y el de una con catálogo pero SIN pedidos. */
  analiticaAdmin: { email: 'e2e.analitica.admin@membego.test', nombre: 'Admin Analítica E2E', role: 'ADMINISTRADOR' },
  analiticaOtra: { email: 'e2e.analitica.otra@membego.test', nombre: 'Admin Otra Analítica E2E', role: 'ADMINISTRADOR' },
  analiticaSin: { email: 'e2e.analitica.sin@membego.test', nombre: 'Admin Sin Analítica E2E', role: 'ADMINISTRADOR' },
  /** Caja conectada (F7): quien cobra en una empresa CON el POS conectado y quien cobra en otra SIN él. */
  posAdmin: { email: 'e2e.pos.admin@membego.test', nombre: 'Cajero POS E2E', role: 'ADMINISTRADOR' },
  posSin: { email: 'e2e.pos.sin@membego.test', nombre: 'Cajero Sin POS E2E', role: 'ADMINISTRADOR' },
  /** Checkout del marketplace (F8): quien atiende el pedido del carrito y quien lo hace. */
  carritoAdmin: { email: 'e2e.carrito.admin@membego.test', nombre: 'Admin Carrito E2E', role: 'ADMINISTRADOR' },
  carritoCliente: { email: 'e2e.carrito.cliente@membego.test', nombre: 'Rosa Carrito E2E', role: 'CLIENTE' },
  /** Conciliación y riesgo (F9): quien administra una empresa y no puede entrar a las pantallas de la plataforma. */
  conciliacionAdmin: { email: 'e2e.conciliacion.admin@membego.test', nombre: 'Admin Conciliación E2E', role: 'ADMINISTRADOR' },
  /** Separación landing/app (F1): un cliente SIN pedidos ni empresa, para ver los estados vacíos de la app. */
  separacionCliente: { email: 'e2e.separacion.cliente@membego.test', nombre: 'Lucía Separación E2E', role: 'CLIENTE' },
  /** Commerce Core · Merchant Billing (F4): el superadmin que asienta pagos y ajusta la cuenta de una empresa. */
  facturacionSuperadmin: { email: 'e2e.facturacion.sa@membego.test', nombre: 'Facturación SA E2E', role: 'SUPERADMIN' },
} as const

export type RolE2E = keyof typeof USUARIOS

let prisma: PrismaClient | null = null
function cliente(): PrismaClient {
  prisma ??= new PrismaClient()
  return prisma
}

export async function asegurarUsuario(rol: RolE2E, companyId: string | null = null): Promise<UsuarioE2E> {
  const { email, nombre, role } = USUARIOS[rol]
  const supabaseId = `e2e-supply2-${rol}`
  const u = await cliente().user.upsert({
    where: { email },
    update: { role, supabaseId, companyId },
    create: { email, name: nombre, role, supabaseId, companyId },
    select: { id: true },
  })
  return { id: u.id, supabaseId, email, nombre, role, companyId }
}

/**
 * Slice 3: la empresa del proveedor (registrada en Membego, con la capacidad
 * MEMBEGO_SUPPLIER y una sucursal) y su encargado. En producción la empresa se
 * da de alta desde el panel; aquí la siembra el arnés porque el recorrido
 * empieza en «vincular empresa existente como proveedor».
 */
export async function asegurarEmpresaProveedora(nombre: string, sucursal = 'Bávaro'): Promise<{ id: string; sucursalId: string }> {
  const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const c = await cliente().company.upsert({
    where: { slug },
    update: { name: nombre, capacidades: { overrides: { MEMBEGO_SUPPLIER: true } }, isActive: true },
    create: { name: nombre, slug, type: 'restaurante', capacidades: { overrides: { MEMBEGO_SUPPLIER: true } } },
    select: { id: true },
  })
  const s = await cliente().sucursal.findFirst({ where: { companyId: c.id, nombre: sucursal }, select: { id: true } })
  const sucursalId = s?.id ?? (await cliente().sucursal.create({ data: { companyId: c.id, nombre: sucursal }, select: { id: true } })).id
  return { id: c.id, sucursalId }
}

function nombreCookie(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL para derivar el nombre de la cookie de sesión.')
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
}

export async function cookieDeSesion(u: UsuarioE2E): Promise<{ name: string; value: string }> {
  const secreto = process.env.SUPABASE_JWT_SECRET
  if (!secreto) throw new Error('Falta SUPABASE_JWT_SECRET para firmar la sesión de prueba.')
  const ahora = Math.floor(Date.now() / 1000)
  const exp = ahora + 60 * 60
  const appMetadata = { role: u.role, dbUserId: u.id, clienteId: null, companyId: u.companyId }
  const accessToken = await new SignJWT({ email: u.email, role: 'authenticated', app_metadata: appMetadata, user_metadata: {} })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(u.supabaseId)
    .setAudience('authenticated')
    .setIssuedAt(ahora)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secreto))
  const sesion = {
    access_token: accessToken,
    refresh_token: 'e2e-sin-refresco',
    expires_in: exp - ahora,
    expires_at: exp,
    token_type: 'bearer',
    user: { id: u.supabaseId, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: appMetadata, user_metadata: {} },
  }
  const value = `base64-${Buffer.from(JSON.stringify(sesion), 'utf8').toString('base64url')}`
  return { name: nombreCookie(), value }
}

/** Deja el contexto del navegador con la sesión de ese rol puesta. */
export async function entrarComo(context: BrowserContext, rol: RolE2E, baseURL: string, companyId: string | null = null): Promise<UsuarioE2E> {
  const u = await asegurarUsuario(rol, companyId)
  const c = await cookieDeSesion(u)
  await context.addCookies([{ ...c, url: baseURL, httpOnly: true, sameSite: 'Lax' }])
  return u
}

export async function cerrarPrisma(): Promise<void> {
  await prisma?.$disconnect()
  prisma = null
}

/** Sin secreto o sin base no hay forma de firmar sesiones: las pruebas se saltan. */
export const SESION_LOCAL_DISPONIBLE = Boolean(process.env.SUPABASE_JWT_SECRET && process.env.DATABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL)

/** Acceso directo a la base para el ARNÉS (adelantar un reloj, sembrar una cuenta de cobro). Nunca para lo que la prueba debe hacer por la interfaz. */
export function prismaDeArnes(): PrismaClient {
  return cliente()
}
