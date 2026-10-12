import { createClient } from '@supabase/supabase-js'
import { diagnosticarLlaveServicio } from '@/lib/supabase/llave-servicio'

/**
 * Admin client using the service role key. Server-only. Bypasses RLS and can
 * manage users (create, update app_metadata). Never import in client code.
 *
 * Uses an explicit `global.fetch` and disables realtime to avoid the
 * WebSocket/Realtime initialization error seen in some serverless environments.
 */
let cached: ReturnType<typeof createClient> | null = null

export function createAdminClient() {
  // Memoizado a nivel de módulo: es stateless (sin sesión) y se invocaba
  // desde 11 call sites creando un cliente nuevo por llamada.
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase admin env vars')

  // Una llave que no es de servicio NO rompe el arranque (el resto de la app no la necesita), pero deja sin funcionar toda
  // la administración de usuarios con un 403 que cada llamada se traga. Se avisa UNA vez, fuerte y sin imprimir la llave.
  const diagnostico = diagnosticarLlaveServicio(key, url)
  if (!diagnostico.ok) {
    console.error(`[supabase-admin] ${diagnostico.detalle} Corrígela en las variables de entorno del despliegue.`)
  }

  cached = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch },
    realtime: { params: { eventsPerSecond: -1 } },
  })
  return cached
}
