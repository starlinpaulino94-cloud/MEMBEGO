import { NextRequest, NextResponse } from 'next/server'
import { sinEmpresa } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Público: devuelve solo un estado agregado (`ok` | `degraded`) apto para
 * monitores de uptime. NO expone hostnames, nombres de BD, conteos ni mensajes
 * de error, para no dar información de reconocimiento a un atacante.
 *
 * Diagnóstico detallado (checks + diagnostics): solo si se envía el header
 * `x-health-secret` igual a BOOTSTRAP_SECRET. Pensado para depuración puntual.
 */
export async function GET(req: NextRequest) {
  return sinEmpresa('health-check', async (tx) => {
    const envOk =
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
      !!process.env.DATABASE_URL

    let dbOk = false
    let dbError: string | null = null
    let dbLatencyMs: number | null = null
    try {
      const t0 = Date.now()
      await tx.$queryRaw`SELECT 1`
      dbLatencyMs = Date.now() - t0
      dbOk = true
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e)
    }

    const status = envOk && dbOk ? 'ok' : 'degraded'

    // Respuesta pública mínima.
    const secret = process.env.BOOTSTRAP_SECRET
    const authorized = !!secret && req.headers.get('x-health-secret') === secret
    if (!authorized) {
      return NextResponse.json({ status })
    }

    // Respuesta detallada (solo autorizada).
    const checks: Record<string, string> = {
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'ok' : 'MISSING',
      supabase_anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'ok' : 'MISSING',
      service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'ok' : 'MISSING',
      database_url: process.env.DATABASE_URL ? 'ok' : 'MISSING',
      direct_url: process.env.DIRECT_URL ? 'ok' : 'MISSING',
      database: dbOk ? 'ok' : 'error',
    }

    const diagnostics: Record<string, unknown> = {}
    if (process.env.DATABASE_URL) {
      try {
        const url = new URL(process.env.DATABASE_URL)
        diagnostics.db_host = url.hostname
        diagnostics.db_port = url.port
        diagnostics.db_name = url.pathname.replace('/', '')
        diagnostics.db_has_pgbouncer = url.searchParams.has('pgbouncer')
      } catch {
        diagnostics.db_url_parse = 'invalid URL format'
      }
    }
    if (dbError) diagnostics.raw_query_error = dbError
    // Latencia BD: >150 ms sostenido = región lejana o pool saturado (P2024).
    // Segunda medición ya con conexión caliente (la primera paga el handshake).
    if (dbLatencyMs != null) {
      diagnostics.db_latency_first_ms = dbLatencyMs
      try {
        const t0 = Date.now()
        await tx.$queryRaw`SELECT 1`
        diagnostics.db_latency_warm_ms = Date.now() - t0
      } catch {
        /* ya reportado arriba */
      }
    }

    try {
      diagnostics.companies = await tx.company.count()
      diagnostics.users = await tx.user.count()
      diagnostics.clientes = await tx.cliente.count()
      checks.orm = 'ok'
    } catch (e) {
      checks.orm = 'error'
      diagnostics.orm_error = e instanceof Error ? e.message : String(e)
    }

    // Centinelas de schema drift: una columna/tabla representativa de cada
    // tanda reciente de migraciones manuales. Si alguna sale FALTA, el deploy
    // va adelantado a la BD → correr `npm run db:doctor` para el detalle total.
    try {
      const centinelas = await tx.$queryRaw<{ objeto: string; ok: boolean }[]>`
        SELECT 'clientes.ciudad' AS objeto, EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'clientes' AND column_name = 'ciudad') AS ok
        UNION ALL SELECT 'transactions.esquema', to_regclass('public.transactions') IS NOT NULL
        UNION ALL SELECT 'caja_sesiones.esquema', to_regclass('public.caja_sesiones') IS NOT NULL
        UNION ALL SELECT 'movimientos_caja.esquema', to_regclass('public.movimientos_caja') IS NOT NULL
        UNION ALL SELECT 'ofertas_privadas.esquema', to_regclass('public.ofertas_privadas') IS NOT NULL
        UNION ALL SELECT 'citas.esquema', to_regclass('public.citas') IS NOT NULL`
      const faltantes = centinelas.filter((c) => !c.ok).map((c) => c.objeto)
      checks.schema = faltantes.length === 0 ? 'ok' : 'DRIFT'
      if (faltantes.length > 0) {
        diagnostics.schema_drift = faltantes
        diagnostics.schema_remedio =
          'La BD no tiene objetos que este deploy espera. Corre `npm run db:doctor` (detalle completo) y aplica las migraciones pendientes en Supabase.'
      }
    } catch (e) {
      checks.schema = 'error'
      diagnostics.schema_error = e instanceof Error ? e.message : String(e)
    }

    return NextResponse.json({ status, checks, diagnostics })
  })
}
