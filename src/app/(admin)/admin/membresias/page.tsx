import Form from 'next/form'
import Link from 'next/link'
import { Download, Search } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import {
  ESTADOS_MEMBRESIA,
  estadoValido,
  whereMembresias,
} from '@/modules/admin/membresiasFiltro'
import { MembresíasTable, type MembershipRow } from '@/components/admin/MembresíasTable'
import type { PlanOption } from '@/components/admin/CambiarPlanDialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/format'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

/**
 * Membresías — CON TOTAL REAL, PAGINADA Y BUSCADA EN EL SERVIDOR
 * (auditoría 2026-08 · A-5 y B-10).
 *
 * QUÉ ESTABA MAL. `take: 200` sin `skip` y sin `count`, y el encabezado
 * imprimía `memberships.length`. Con 51 membresías coincidía por casualidad;
 * a partir de la 201 la pantalla habría dicho «200 membresías compradas» para
 * siempre, y las demás habrían sido inalcanzables — esta pantalla no tenía
 * paginación. El buscador, además, filtraba en el navegador sobre esas 200
 * filas: buscar a un cliente antiguo no lo encontraba nunca.
 *
 * Es exactamente el mismo fallo (M-07) que `/admin/clientes` ya había
 * corregido, y que aquí seguía vivo. La corrección es la misma: contar,
 * paginar y buscar en el servidor.
 *
 * ADEMÁS: el chip «Activas» ahora significa VIGENTE (activa y sin vencer). Nada
 * vencía las membresías solas —ver `modules/membresia/vigencia.ts`— así que
 * este filtro enseñaba como activas membresías que el escáner ya rechazaba.
 * Y entran los dos estados que faltaban: una membresía con el pago rechazado no
 * aparecía bajo NINGUNA pestaña.
 */

function FilterLink({
  label,
  href,
  active,
}: {
  label: string
  href: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground'
          : 'rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted'
      }
    >
      {label}
    </Link>
  )
}

export default async function MembresiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const sp = await searchParams
  const companyId = companyFilter(user)
  const pag = leerPaginacion(sp, POR_PAGINA)
  const busqueda = (sp.q ?? '').trim()

  const estadoFilter = estadoValido(sp.estado)

  // El filtro vive en `modules/admin/membresiasFiltro`: la exportación usa el
  // MISMO, para que el CSV no pueda separarse de lo que se ve.
  const where = whereMembresias(companyId, { estado: estadoFilter, q: busqueda })

  let memberships: MembershipRow[] = []
  let planes: PlanOption[] = []
  let total = 0
  let fallo = false
  try {
    const [data, planesData, cuenta] = await Promise.all([
      prisma.membership.findMany({
        where,
        include: { plan: true, cliente: true },
        orderBy: { createdAt: 'desc' },
        skip: pag.saltar,
        take: pag.tomar,
      }),
      // Planes activos de la empresa para el cambio de plan directo por el
      // admin (política: el cliente no puede cambiar su plan desde la app).
      prisma.plan.findMany({
        where: { ...(companyId ? { companyId } : {}), activo: true },
        orderBy: [{ orden: 'asc' }, { precio: 'asc' }],
        select: { id: true, nombre: true, precio: true },
      }),
      prisma.membership.count({ where }),
    ])
    memberships = data as unknown as MembershipRow[]
    total = cuenta
    planes = planesData.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precioLabel: formatMoney(Number(p.precio)),
    }))
  } catch (e) {
    fallo = true
    console.error('[admin-membresias]', e)
  }

  const desde = total === 0 ? 0 : pag.saltar + 1
  const hasta = Math.min(pag.saltar + pag.tomar, total)
  const filtro = estadoFilter ? ESTADOS_MEMBRESIA.find((e) => e.clave === estadoFilter)!.label : null

  const enlace = (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams()
    if (params.estado) qs.set('estado', params.estado)
    if (params.q) qs.set('q', params.q)
    const s = qs.toString()
    return `/admin/membresias${s ? `?${s}` : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clientes"
        title="Membresías"
        description={
          fallo
            ? 'No se pudieron cargar las membresías.'
            : total === 0
              ? busqueda
                ? `Ninguna membresía coincide con "${busqueda}".`
                : 'Todavía no hay membresías.'
              : `Quién tiene qué. ${desde}–${hasta} de ${total}${
                  filtro ? ` · ${filtro}` : ''
                }${busqueda ? ` para "${busqueda}"` : ''}`
        }
        action={
          <Button asChild variant="outline">
            <Link href="/admin/planes">Ver planes</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <FilterLink label="Todas" href={enlace({ q: busqueda })} active={!estadoFilter} />
        {ESTADOS_MEMBRESIA.map((e) => (
          <FilterLink
            key={e.clave}
            label={e.label}
            href={enlace({ estado: e.clave, q: busqueda })}
            active={estadoFilter === e.clave}
          />
        ))}
      </div>

      {/* `next/form` navega sin JavaScript: el buscador sigue funcionando con
          mala conexión o antes de que cargue el bundle. */}
      <Form action="/admin/membresias" className="flex max-w-md gap-2">
        {estadoFilter && <input type="hidden" name="estado" value={estadoFilter} />}
        <Input
          name="q"
          aria-label="Buscar membresías"
          defaultValue={busqueda}
          placeholder="Buscar por cliente, correo o plan…"
          className="min-h-10"
          autoComplete="off"
        />
        <Button type="submit" variant="outline" className="shrink-0">
          <Search className="h-4 w-4" />
        </Button>
        {/* Enlace al servidor: se lleva TODO el filtro, no la página visible. */}
        <Button asChild variant="outline" className="shrink-0">
          <a href={`/admin/membresias/export${enlace({ estado: estadoFilter, q: busqueda }).replace('/admin/membresias', '')}`}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </a>
        </Button>
      </Form>

      <MembresíasTable data={memberships} planes={planes} />

      <TablaPaginacion
        paginacion={pag}
        total={total}
        params={sp}
        etiqueta="membresías"
      />
    </div>
  )
}
