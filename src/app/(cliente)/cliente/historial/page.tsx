import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
  History,
  CalendarDays,
  MapPin,
  User,
  Car,
  Hash,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { getClienteVisitas, type HistorialVisitas } from '@/modules/cliente/queries'
import { formatDate } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SinEmpresaTodavia } from '@/components/cliente/SinEmpresaTodavia'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

function fmtDateTime(d: Date) {
  return formatDate(d, undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireRole('CLIENTE')
  // «No autorizado» era falso: quien acaba de registrarse SÍ está autorizado;
  // lo que no tiene todavía es una sola visita. Ver `SinEmpresaTodavia`.
  if (!user.metadata.clienteId) {
    return <SinEmpresaTodavia que="visitas registradas"
      detalle="Cada vez que uses un beneficio en un negocio, la visita queda aquí." />
  }

  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam ?? 1) || 1)

  let result: HistorialVisitas = { total: 0, esteMes: 0, visitas: [], pages: 0 }
  let loadError = false
  try {
    // La PERSONA, no la ficha activa: una visita a un negocio y una a otro son
    // las dos suyas. Filtrando por la ficha, cambiar de empresa le borraba la
    // mitad del historial sin explicación.
    result = await getClienteVisitas(user.supabaseId, page, PAGE_SIZE)
  } catch (e) {
    loadError = true
    console.error('[cliente-historial]', e)
  }
  const { total, esteMes, visitas, pages } = result

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Historial de visitas</h1>
        <p className="text-muted-foreground">Cada uso registrado de tu membresía.</p>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <div className="rounded-lg bg-info/10 p-2">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{total}</p>
              <p className="text-sm text-muted-foreground">Visitas totales</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <div className="rounded-lg bg-primary/10 p-2">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{esteMes}</p>
              <p className="text-sm text-muted-foreground">Este mes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {loadError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-10 text-center">
            <p className="font-medium text-foreground">No pudimos cargar tu historial.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/cliente/historial">Reintentar</Link>
            </Button>
          </CardContent>
        </Card>
      ) : visitas.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin visitas registradas</p>
            <p className="text-sm">
              Tus visitas aparecerán aquí cuando el empleado las confirme.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border/60">
              {visitas.map((v) => (
                <li key={v.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold text-foreground">{v.servicio}</p>
                      <p className="text-sm text-muted-foreground">{fmtDateTime(v.fechaVisita)}</p>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {v.sucursal && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {v.sucursal}
                          </span>
                        )}
                        {v.empleado && (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3 w-3" /> {v.empleado}
                          </span>
                        )}
                        {v.vehiculo && (
                          <span className="inline-flex items-center gap-1">
                            <Car className="h-3 w-3" /> {v.vehiculo.marca} {v.vehiculo.modelo}
                            {v.vehiculo.placa ? ` · ${v.vehiculo.placa}` : ''}
                          </span>
                        )}
                        {v.planNombre && <span>Plan: {v.planNombre}</span>}
                      </div>

                      {/* Fase E4: identificador oficial de la operación */}
                      {v.transaccion && (
                        <p className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                          <Hash className="h-3 w-3" />
                          {v.transaccion.codigo} · {v.transaccion.ticketNumero}
                        </p>
                      )}

                      {v.notas && (
                        <p className="mt-1 text-xs italic text-muted-foreground">“{v.notas}”</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {v.descontado ? (
                        <Badge variant="secondary" className="bg-destructive/10 text-xs text-destructive">
                          −1 uso
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-success/10 text-xs text-success">
                          Sin descuento
                        </Badge>
                      )}
                      {v.transaccion && v.transaccion.estado !== 'APPLIED' && (
                        <Badge variant="secondary" className="bg-warning/15 text-[10px] text-warning">
                          {v.transaccion.estado === 'REVERTED'
                            ? 'Revertida'
                            : v.transaccion.estado === 'CANCELLED'
                              ? 'Cancelada'
                              : v.transaccion.estado}
                        </Badge>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Paginación */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${page - 1}`}>
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${page + 1}`}>
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
