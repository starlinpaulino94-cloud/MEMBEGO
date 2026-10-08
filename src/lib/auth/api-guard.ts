import { createAdminClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/auth'
import { repararContextoCliente } from '@/lib/auth/reparar-contexto'
import type { SessionUser, AppMetadata } from '@/types'

/**
 * Obtiene el usuario autenticado para API Route Handlers.
 * Admite tanto cabecera `Authorization: Bearer <jwt>` (móvil y web API)
 * como cookies de sesión de Supabase (navegador web).
 */
export async function getApiClientUser(request: Request): Promise<SessionUser | null> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim()
    if (!token) return null
    try {
      const supabaseAdmin = createAdminClient()
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !user) return null

      const metadata = (user.app_metadata ?? {}) as Partial<AppMetadata>
      const role = metadata.role ?? 'CLIENTE'
      const sessionUser: SessionUser = {
        supabaseId: user.id,
        email: user.email ?? '',
        metadata: {
          role,
          dbUserId: metadata.dbUserId ?? '',
          clienteId: metadata.clienteId ?? null,
          companyId: metadata.companyId ?? null,
        },
      }

      if (role === 'CLIENTE') {
        return await repararContextoCliente(sessionUser)
      }
      return sessionUser
    } catch (e) {
      console.error('[api-guard] error validando Bearer token:', e)
      return null
    }
  }

  // Fallback: cookies de sesión estándar
  try {
    return await getUser()
  } catch {
    return null
  }
}

export function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function handleCorsPreflight(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  })
}
