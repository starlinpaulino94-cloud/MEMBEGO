import { PrismaClient } from '@prisma/client'
import { SignJWT } from 'jose'
import type { BrowserContext } from '@playwright/test'

/**
 * SESIONES FIRMADAS LOCALMENTE para los E2E de Supply 2.0.
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
  role: 'SUPERADMIN' | 'CLIENTE'
}

const USUARIOS = {
  compras: { email: 'e2e.supply2.compras@membego.test', nombre: 'Compras E2E', role: 'SUPERADMIN' },
  finanzas: { email: 'e2e.supply2.finanzas@membego.test', nombre: 'Finanzas E2E', role: 'SUPERADMIN' },
  cliente: { email: 'e2e.supply2.cliente@membego.test', nombre: 'Ana Cliente E2E', role: 'CLIENTE' },
  cliente2: { email: 'e2e.supply2.cliente2@membego.test', nombre: 'Luis Cliente E2E', role: 'CLIENTE' },
} as const

export type RolE2E = keyof typeof USUARIOS

let prisma: PrismaClient | null = null
function cliente(): PrismaClient {
  prisma ??= new PrismaClient()
  return prisma
}

export async function asegurarUsuario(rol: RolE2E): Promise<UsuarioE2E> {
  const { email, nombre, role } = USUARIOS[rol]
  const supabaseId = `e2e-supply2-${rol}`
  const u = await cliente().user.upsert({
    where: { email },
    update: { role, supabaseId },
    create: { email, name: nombre, role, supabaseId },
    select: { id: true },
  })
  return { id: u.id, supabaseId, email, nombre, role }
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
  const appMetadata = { role: u.role, dbUserId: u.id, clienteId: null, companyId: null }
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
export async function entrarComo(context: BrowserContext, rol: RolE2E, baseURL: string): Promise<UsuarioE2E> {
  const u = await asegurarUsuario(rol)
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
