import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { plural } from '@/lib/plural'
import { usoDeSatelites } from '@/modules/plataforma/metricas'
import { TabsIntegracionesPlataforma } from '@/components/superadmin/TabsIntegracionesPlataforma'
import { SateliteUsoCard } from '@/components/superadmin/SateliteUsoCard'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { StatCard } from '@/components/ui/stat-card'
import { Activity, CircleCheck, Plug, TriangleAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Uso de la API por satélite' }

/** Ventanas ofrecidas; cualquier otro `?dias=` cae en 30. */
const VENTANAS = [7, 30, 90] as const

/**
 * USO DE LA API POR SATÉLITE (B-7 · la pieza que faltaba: la vista del superadmin).
 *
 * El agregado por credencial ya se recogía (`origen:'SISTEMA'`) y la lectura de
 * UN satélite existía (`usoDeSistema`); lo que faltaba era la pantalla que los
 * enseña todos. Es la salud vista desde el lado de QUIEN LLAMA —peticiones, tasa
 * de error y endpoints más usados por satélite—, complementaria a la pestaña
 * «Salud», que mira la cola de SALIDA.
 *
 * La señal más útil es la tasa de error: como solo se cuenta el desenlace en el
 * borde de autenticación, un error es «credencial válida, pero sin el scope» —una
 * integración mal configurada golpeando con un permiso que no tiene—.
 */
export default async function UsoApiPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>
}) {
  await requireRole('SUPERADMIN')
  const { dias: diasParam } = await searchParams
  const dias = VENTANAS.includes(Number(diasParam) as (typeof VENTANAS)[number])
    ? Number(diasParam)
    : 30

  const satelites = await usoDeSatelites(dias)
  // De más a menos usado: lo que tiene tráfico —y sus errores— arriba.
  const ordenados = [...satelites].sort((a, b) => b.resumen.total - a.resumen.total)

  const totalLlamadas = satelites.reduce((n, s) => n + s.resumen.total, 0)
  const totalErrores = satelites.reduce((n, s) => n + s.resumen.errores, 0)
  const conTrafico = satelites.filter((s) => s.resumen.total > 0).length
  const tasa = totalLlamadas > 0 ? `${((totalErrores / totalLlamadas) * 100).toFixed(1)}%` : '—'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uso de la API por satélite"
        description="Cuánto llama cada satélite a la API pública, con qué endpoints y con qué tasa de error."
        nav={<TabsIntegracionesPlataforma activa="uso" />}
        action={
          <div className="flex gap-1 rounded-xl border border-border/60 p-0.5">
            {VENTANAS.map((v) => (
              <Link
                key={v}
                href={`/superadmin/integraciones/uso?dias=${v}`}
                className={`rounded-lg px-3 py-1 text-caption transition-colors duration-fast ${
                  v === dias
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {v} d
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Llamadas"
          value={totalLlamadas.toLocaleString('es')}
          sub={`En los últimos ${dias} días`}
          icon={Activity}
          accent="brand"
        />
        <StatCard
          label="Tasa de error"
          value={tasa}
          sub="Credencial sin el scope pedido"
          icon={totalErrores > 0 ? TriangleAlert : CircleCheck}
          accent={totalErrores > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Satélites con tráfico"
          value={conTrafico}
          sub={plural(satelites.length, 'satélite en total', 'satélites en total')}
          icon={Plug}
          accent="brand"
        />
      </div>

      {ordenados.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-6 w-6" aria-hidden />}
          title="No hay satélites con credenciales"
          description="Cuando un sistema satélite tenga una credencial y llame a la API, su uso aparecerá aquí."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {ordenados.map((s) => (
            <SateliteUsoCard key={s.sistemaId} satelite={s} dias={dias} />
          ))}
        </div>
      )}

      <p className="text-caption text-muted-foreground">
        Solo se cuenta lo que se pudo atribuir a una credencial: una petición sin token válido o
        frenada por el límite no llega a contarse. El endpoint se normaliza (los ids se sustituyen
        por <span className="font-mono">{'{id}'}</span>), así que ningún id de cliente entra en esta
        telemetría.
      </p>
    </div>
  )
}
