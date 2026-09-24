import Link from 'next/link'
import { ArrowLeft, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { conEmpresa } from '@/lib/tenant'
import {
  ADMIN_SECTIONS,
  ROLES_CON_PERMISOS,
  puedeEditarPermisos,
  resolverPermisosUsuario,
  type AdminSection,
} from '@/lib/auth/permissions'
import { SECCION_LABELS } from '@/lib/auth/funciones'
import { filtroDeCapacidades } from '@/modules/capacidades/resolver'
import {
  accesoASeccion,
  accesosDeEmpleado,
  explicarAcceso,
  loQueTraeElRol,
  resumirAccesos,
  type AccesoSeccion,
} from '@/modules/permisos/accesos'
import { roleLabel } from '@/components/layout/nav-config'
import { INVITABLE_ROLES, type AppRole } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBanner } from '@/components/ui/status-banner'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Qué ve cada empleado' }

const TEAM_ROLES: AppRole[] = [...INVITABLE_ROLES, 'ADMIN_EMPRESA']

/**
 * QUÉ VE CADA EMPLEADO — el mapa de accesos del equipo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREGUNTA QUE CONTESTA
 *
 * La ficha de Permisos responde «¿qué le doy a esta persona?». Esta pantalla
 * responde las dos que se hacen DESPUÉS, y que hasta ahora se contestaban
 * abriendo fichas una por una:
 *
 *   · «¿por qué esta persona no ve Campañas?» — y la respuesta puede estar en
 *     tres sitios: su rol no lo trae, alguien se lo quitó, o el módulo está
 *     apagado para la empresa entera.
 *   · «¿quién ve Campañas?» — la vuelta, que es la que de verdad se hace
 *     cuando lo que preocupa es que algo se esté viendo de más.
 *
 * NO concede ni quita nada: para eso está la ficha de cada quien, a un clic.
 * Es una pantalla de lectura, y por eso la abre la misma gente que puede
 * editar permisos (`puedeEditarPermisos` decide después a quién de la lista
 * puede tocar). Un gerente entra a Empleados a ver a su equipo; el mapa de
 * quién alcanza qué es otra cosa.
 */
export default async function AccesosDelEquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ empleado?: string; modulo?: string }>
}) {
  const user = await requireRole(ROLES_CON_PERMISOS)
  const companyId = await requireCompanyContext(user)
  const { empleado: empleadoId, modulo } = await searchParams

  // Una sola lectura del equipo y una sola de las capacidades: el mapa entero
  // se calcula en memoria a partir de ahí.
  const equipo = await conEmpresa(companyId, (tx) =>
    tx.user.findMany({
      where: { role: { in: TEAM_ROLES }, ...(companyId ? { companyId } : {}) },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true, email: true, role: true, permisos: true },
    })
  )
  const seccionEncendida = await filtroDeCapacidades(companyId)

  const gente = equipo.map((m) => {
    const permisos = resolverPermisosUsuario(m.permisos)
    const accesos = accesosDeEmpleado(m.role, permisos, seccionEncendida)
    return {
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      permisos,
      accesos,
      resumen: resumirAccesos(accesos),
      editable: puedeEditarPermisos(user.metadata.role, m.role) && m.id !== user.metadata.dbUserId,
    }
  })

  const seccion = (ADMIN_SECTIONS as readonly string[]).includes(modulo ?? '')
    ? (modulo as AdminSection)
    : null
  const ficha = empleadoId ? gente.find((g) => g.id === empleadoId) : undefined

  const volverAlMapa = (
    <Button asChild variant="outline">
      <Link href="/admin/empleados/accesos">
        <ArrowLeft className="mr-2 h-4 w-4" /> Todo el equipo
      </Link>
    </Button>
  )

  // ── Vista 1 · UNA PERSONA: su mapa entero, agrupado por el porqué ─────────
  if (ficha) {
    const visibles = ficha.accesos.filter((a) => a.puede)
    const ocultas = ficha.accesos.filter((a) => !a.puede)
    const deSerie = loQueTraeElRol(ficha.role).length
    return (
      <div className="space-y-6">
        <PageHeader
          title={ficha.name}
          eyebrow={<Link href="/admin/empleados/accesos">Qué ve cada empleado</Link>}
          description={`${ficha.email} · ${roleLabel(ficha.role)} — su rol trae ${deSerie} módulo${deSerie !== 1 ? 's' : ''} de serie. Hoy ve ${ficha.resumen.visibles} de ${ficha.resumen.total}.`}
          action={
            <>
              {volverAlMapa}
              {ficha.editable && (
                <Button asChild>
                  <Link
                    href={`/admin/empleados/${ficha.id}/permisos?volver=${encodeURIComponent(
                      `/admin/empleados/accesos?empleado=${ficha.id}`
                    )}`}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" /> Cambiar permisos
                  </Link>
                </Button>
              )}
            </>
          }
        />

        <ListaDeAccesos titulo={`Ve ${visibles.length}`} icono="ve" lista={visibles} />
        <ListaDeAccesos titulo={`No ve ${ocultas.length}`} icono="no-ve" lista={ocultas} />
      </div>
    )
  }

  // ── Vista 2 · UN MÓDULO: quién lo alcanza y quién no ──────────────────────
  if (seccion) {
    const apagadoEnLaEmpresa = !seccionEncendida(seccion)
    // El acceso se resuelve UNA vez por persona y viaja con ella: partir la
    // lista y luego volver a preguntar por cada fila deja dos sitios donde la
    // respuesta se calcula, que es donde se separan.
    const conMotivo = gente.map((g) => ({
      ...g,
      acceso: accesoASeccion(g.role, g.permisos, seccion, seccionEncendida),
    }))
    const conAcceso = conMotivo.filter((g) => g.acceso.puede)
    const sinAcceso = conMotivo.filter((g) => !g.acceso.puede)
    return (
      <div className="space-y-6">
        <PageHeader
          title={`Quién ve ${SECCION_LABELS[seccion]}`}
          eyebrow={<Link href="/admin/empleados/accesos">Qué ve cada empleado</Link>}
          description={`${conAcceso.length} de ${gente.length} miembro${gente.length !== 1 ? 's' : ''} del equipo puede abrir este módulo.`}
          action={volverAlMapa}
        />

        {apagadoEnLaEmpresa && (
          <StatusBanner variant="warning" title="Este módulo está apagado para la empresa">
            No lo ve nadie, tengan el permiso que tengan. Se enciende en las capacidades de
            la empresa, no en la ficha de cada persona.
          </StatusBanner>
        )}

        <SelectorDeModulo actual={seccion} />

        <QuienesConMotivo titulo="Lo ve" gente={conAcceso} />
        <QuienesConMotivo titulo="No lo ve" gente={sinAcceso} />
      </div>
    )
  }

  // ── Vista 3 · TODO EL EQUIPO ──────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Qué ve cada empleado"
        eyebrow={<Link href="/admin/empleados">Equipo</Link>}
        description="El rol da el punto de partida y los permisos lo ajustan encima. Aquí se ve el resultado: cuántos módulos alcanza cada quien, qué se le concedió a mano y qué se le quitó."
        action={
          <Button asChild variant="outline">
            <Link href="/admin/empleados">
              <ArrowLeft className="mr-2 h-4 w-4" /> Equipo
            </Link>
          </Button>
        }
      />

      <SelectorDeModulo actual={null} />

      {gente.length === 0 ? (
        <EmptyState
          variant="card"
          title="Todavía no hay equipo"
          description="Invita a alguien desde Equipo y aquí aparecerá qué alcanza a ver."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {gente.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/admin/empleados/accesos?empleado=${g.id}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {g.name}
                </Link>
                <p className="truncate text-caption text-muted-foreground">
                  {g.email} · {roleLabel(g.role)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">
                  Ve {g.resumen.visibles} de {g.resumen.total}
                </Badge>
                {g.resumen.concedidos.length > 0 && (
                  <Badge variant="success">+{g.resumen.concedidos.length} concedido{g.resumen.concedidos.length !== 1 ? 's' : ''}</Badge>
                )}
                {g.resumen.negados.length > 0 && (
                  <Badge variant="destructive">−{g.resumen.negados.length} quitado{g.resumen.negados.length !== 1 ? 's' : ''}</Badge>
                )}
                {g.resumen.funcionesNegadas > 0 && (
                  <Badge variant="warning">
                    {g.resumen.funcionesNegadas} función{g.resumen.funcionesNegadas !== 1 ? 'es' : ''} negada{g.resumen.funcionesNegadas !== 1 ? 's' : ''}
                  </Badge>
                )}
                {g.resumen.visibles === 0 && <Badge variant="outline">Sin panel</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * La vuelta de la pregunta. Va en un `form` con `method="get"` y su botón: un
 * `select` que navega solo necesita JavaScript en el cliente, y esta pantalla
 * no tiene ninguna otra razón para pedirlo.
 */
function SelectorDeModulo({ actual }: { actual: AdminSection | null }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">¿Quién ve un módulo?</CardTitle>
      </CardHeader>
      <CardContent>
        <form method="get" action="/admin/empleados/accesos" className="flex flex-wrap items-center gap-2">
          <label htmlFor="modulo" className="sr-only">
            Módulo
          </label>
          <select
            id="modulo"
            name="modulo"
            defaultValue={actual ?? ''}
            className="h-10 min-w-56 flex-1 rounded-lg border border-border bg-background px-3 text-small text-foreground"
          >
            <option value="">Elige un módulo…</option>
            {ADMIN_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECCION_LABELS[s]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            Ver quién lo ve
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ListaDeAccesos({
  titulo,
  icono,
  lista,
}: {
  titulo: string
  icono: 've' | 'no-ve'
  lista: AccesoSeccion[]
}) {
  if (lista.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icono === 've' ? (
            <Eye className="h-4 w-4 text-success" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          )}
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border border-t border-border">
          {lista.map((a) => (
            <li key={a.section} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <Link
                  href={`/admin/empleados/accesos?modulo=${a.section}`}
                  className="text-small font-medium text-foreground hover:underline"
                >
                  {a.label}
                </Link>
                {a.puede && a.funcionesNegadas.length > 0 && (
                  <p className="text-caption text-warning">
                    Sin: {a.funcionesNegadas.join(' · ')}
                  </p>
                )}
              </div>
              <Badge variant={insignia(a)}>{explicarAcceso(a)}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function QuienesConMotivo({
  titulo,
  gente,
}: {
  titulo: string
  gente: { id: string; name: string; email: string; role: AppRole; acceso: AccesoSeccion }[]
}) {
  if (gente.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {titulo} ({gente.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border border-t border-border">
          {gente.map((g) => {
            const a = g.acceso
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <Link
                    href={`/admin/empleados/accesos?empleado=${g.id}`}
                    className="text-small font-medium text-primary hover:underline"
                  >
                    {g.name}
                  </Link>
                  <p className="truncate text-caption text-muted-foreground">
                    {g.email} · {roleLabel(g.role)}
                  </p>
                </div>
                <Badge variant={insignia(a)}>{explicarAcceso(a)}</Badge>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function insignia(a: AccesoSeccion): 'success' | 'secondary' | 'destructive' | 'warning' | 'outline' {
  if (a.puede) return a.origen === 'concedido' ? 'success' : 'secondary'
  if (a.motivo === 'negado') return 'destructive'
  if (a.motivo === 'capacidad') return 'warning'
  return 'outline'
}
