import { Clock, CheckCircle2 } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function startOfTodaySantoDomingo(): Date {
  // República Dominicana no usa horario de verano: UTC-4 fijo.
  const now = new Date()
  const local = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() + 4 * 60 * 60 * 1000)
}

const fmtHora = new Intl.DateTimeFormat('es-DO', {
  timeZone: 'America/Santo_Domingo',
  timeStyle: 'short',
})

/**
 * Vista "Hoy" del escáner (server component): las visitas registradas hoy,
 * con contexto de quién atiende. Para el empleado muestra SOLO las suyas;
 * para el panel admin, las de toda la empresa.
 */
export async function VisitasDeHoy({
  companyId,
  empleadoId,
}: {
  companyId: string
  /** Si se indica, filtra a las visitas registradas por este usuario. */
  empleadoId?: string
}) {
  let visitas: {
    id: string
    servicio: string
    fechaVisita: Date
    cliente: { nombre: string }
    sucursal: { nombre: string } | null
  }[] = []
  let total = 0

  try {
    const where = {
      membership: { companyId },
      fechaVisita: { gte: startOfTodaySantoDomingo() },
      ...(empleadoId ? { empleadoId } : {}),
    }
    const [rows, count] = await Promise.all([
      prisma.visit.findMany({
        where,
        orderBy: { fechaVisita: 'desc' },
        take: 8,
        select: {
          id: true,
          servicio: true,
          fechaVisita: true,
          cliente: { select: { nombre: true } },
          sucursal: { select: { nombre: true } },
        },
      }),
      prisma.visit.count({ where }),
    ])
    visitas = rows
    total = count
  } catch (e) {
    console.error('[scanner] visitas de hoy:', e)
    return null
  }

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {empleadoId ? 'Mis visitas de hoy' : 'Visitas de hoy'}
        </p>
        <Badge variant={total > 0 ? 'success' : 'secondary'}>
          {total} registrada{total !== 1 ? 's' : ''}
        </Badge>
      </div>

      {visitas.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Aún no hay visitas registradas hoy. Al confirmar la primera aparecerá aquí.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/50">
          {visitas.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {v.cliente.nombre}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  {v.servicio}
                  {v.sucursal ? ` · ${v.sucursal.nombre}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {fmtHora.format(v.fechaVisita)}
              </span>
            </li>
          ))}
        </ul>
      )}
      </CardContent>
    </Card>
  )
}
