import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UserCog, Users, Pencil } from 'lucide-react'
import { ROL_STAFF_LABEL } from '@/types'
import { EntrarComoCard } from '@/components/superadmin/EntrarComoCard'
import { SuperadminToggle } from '@/components/superadmin/SuperadminToggle'

export const dynamic = 'force-dynamic'

const ROL_LABEL: Record<string, string> = {
  ...ROL_STAFF_LABEL,
  ADMIN_EMPRESA: 'Administrador (legacy)',
  SUPERADMIN: 'Superadmin',
}

export default async function UsuariosStaffPage() {
  const sesion = await requireRole('SUPERADMIN')

  let usuarios: {
    id: string
    name: string
    email: string
    role: string
    companyId: string | null
    company: { name: string } | null
    empresasAcceso: { company: { name: string } }[]
  }[] = []
  try {
    usuarios = await prisma.user.findMany({
      // Staff Y superadmins: los superadmins aparecen para poder otorgar o
      // retirar el rango desde aquí (los clientes siguen fuera).
      where: { role: { notIn: ['CLIENTE'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        company: { select: { name: true } },
        empresasAcceso: { select: { company: { select: { name: true } } } },
      },
    })
  } catch (e) {
    console.error('[superadmin-usuarios]', e)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Usuarios de staff</h1>
        <p className="text-muted-foreground">
          Administradores y equipo de las empresas. Edita su rol, sus datos y
          las empresas que puede gestionar cada uno.
        </p>
      </div>

      <EntrarComoCard />

      {usuarios.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin usuarios de staff</p>
            <p className="text-sm">
              Crea una empresa con su administrador desde el panel de empresas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {usuarios.map((u) => {
            // Empresas visibles: la activa + los accesos extra (sin duplicar).
            const acceso = u.empresasAcceso.map((a) => a.company.name)
            const activa = u.company?.name
            const todas = [
              ...(activa ? [activa] : []),
              ...acceso.filter((n) => n !== activa),
            ]
            return (
              <Card key={u.id}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-lg bg-info/15 p-2">
                        <UserCog className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {u.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {u.role !== 'SUPERADMIN' && (
                        <Link href={`/superadmin/usuarios/${u.id}`}>
                          <Button size="icon" variant="ghost" aria-label="Editar usuario">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      <SuperadminToggle
                        userId={u.id}
                        nombre={u.name}
                        esSuperadmin={u.role === 'SUPERADMIN'}
                        esYo={u.id === sesion.metadata.dbUserId}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-xs">
                      {ROL_LABEL[u.role] ?? u.role}
                    </Badge>
                    {todas.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Sin empresa asignada</span>
                    ) : (
                      todas.map((n) => (
                        <Badge
                          key={n}
                          variant="outline"
                          className={
                            n === activa
                              ? 'border-info/30 bg-info/10 text-xs text-info'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          {n}
                          {n === activa && todas.length > 1 ? ' · activa' : ''}
                        </Badge>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
