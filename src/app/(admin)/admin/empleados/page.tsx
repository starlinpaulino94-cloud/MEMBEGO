import Link from 'next/link'
import { conEmpresaOTodas } from '@/lib/tenant'
import { ADMIN_ROLES, FULL_ADMIN_ROLES } from '@/types'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ROLES_EXENTOS_PERMISOS } from '@/lib/auth/permissions'
import { companyFilter } from '@/modules/admin/queries'
import { listInvitacionesPendientes } from '@/modules/admin/invitacionActions'
import { Button } from '@/components/ui/button'
import { EmpleadosTable, type EmpleadoRow } from '@/components/admin/EmpleadosTable'
import { InvitarEquipo } from '@/components/admin/InvitarEquipo'
import { CancelarInvitacionButton } from '@/components/admin/CancelarInvitacionButton'
import { roleLabel } from '@/components/layout/nav-config'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'
import { INVITABLE_ROLES, type AppRole } from '@/types'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// Todos los roles de equipo (para listar el equipo completo, no solo empleados).
const TEAM_ROLES: AppRole[] = [...INVITABLE_ROLES, 'ADMIN_EMPRESA']

export const dynamic = 'force-dynamic'

export default async function EmpleadosPage() {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  // Solo los administradores plenos con empresa pueden invitar equipo.
  const puedeInvitar = !!user.metadata.companyId && FULL_ADMIN_ROLES.includes(user.metadata.role)

  let miembros: EmpleadoRow[] = []
  // `caducada` lo resuelve `listInvitacionesPendientes`: `Date.now()` dentro
  // del render es impuro y el compilador de React lo rechaza.
  let invitacionesPendientes: {
    id: string
    email: string
    rol: AppRole
    expiraEn: Date
    caducada: boolean
  }[] = []
  let loadError = false
  try {
    // Las invitaciones van FUERA de la transacción de abajo:
    // `listInvitacionesPendientes` abre la suya, y pedirla desde dentro de otra
    // ya abierta consume dos conexiones del pool a la vez por cada carga.
    const invs = user.metadata.companyId
      ? await listInvitacionesPendientes(user.metadata.companyId).catch(() => [])
      : []

    const team = await conEmpresaOTodas(
      companyId,
      'empleados: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => tx.user.findMany({
        where: { role: { in: TEAM_ROLES }, ...(companyId ? { companyId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })
    )
    miembros = team.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      rol: roleLabel(m.role),
      esEmpleado: m.role === 'EMPLEADO',
      // Módulo de Permisos: editable para todo el equipo salvo administradores
      // (los roles exentos no se restringen) y salvo uno mismo.
      permisosEditables:
        !ROLES_EXENTOS_PERMISOS.includes(m.role) && m.id !== user.metadata.dbUserId,
      createdAt: m.createdAt,
    }))
    invitacionesPendientes = invs
  } catch (e) {
    console.error('[admin-empleados]', e)
    loadError = true
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipo"
        description={`${miembros.length} miembro${miembros.length !== 1 ? 's' : ''} · Invita por correo para que elijan su contraseña; crea manualmente si necesitas acceso inmediato.`}
        action={
          <Button asChild>
            <Link href="/admin/empleados/nuevo">
              <Plus className="mr-2 h-4 w-4" />
              Nuevo empleado
            </Link>
          </Button>
        }
      />

      {loadError && (
        <StatusBanner variant="destructive" title="No pudimos cargar el equipo">
          La lista de miembros e invitaciones puede estar incompleta. Recarga la página
          para intentarlo de nuevo.
        </StatusBanner>
      )}

      {/* Invitar al equipo (paso 7 del onboarding) */}
      {puedeInvitar && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Invitar al equipo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InvitarEquipo />

            {invitacionesPendientes.length > 0 && (
              <div className="space-y-2">
                <p className="text-overline">Invitaciones pendientes</p>
                {/* `expiraEn` se consultaba y no se enseñaba. Una invitación
                    que caduca sin avisar se convierte en "no me llegó nada":
                    el admin no tenía forma de saber si tocaba reenviarla. */}
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {invitacionesPendientes.map((inv) => {
                    const { caducada } = inv
                    return (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-small font-medium text-foreground">
                            {inv.email}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-caption',
                              caducada ? 'text-destructive' : 'text-muted-foreground'
                            )}
                          >
                            {roleLabel(inv.rol)} ·{' '}
                            {caducada
                              ? 'Caducada — vuelve a invitar'
                              : `Vence el ${formatDate(inv.expiraEn)}`}
                          </span>
                        </span>
                        <CancelarInvitacionButton id={inv.id} />
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <EmpleadosTable data={miembros} />
    </div>
  )
}
