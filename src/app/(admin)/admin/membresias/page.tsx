import Form from 'next/form'
import { conEmpresaOTodas } from '@/lib/tenant'
import Link from 'next/link'
import { Download, Search } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import {
  ESTADOS_MEMBRESIA,
  USOS_OPCIONES,
  hayFiltrosMembresias,
  leerFiltrosMembresias,
  whereMembresias,
} from '@/modules/admin/membresiasFiltro'
import {
  DIAS_PARA_VENCER,
  DIAS_SIN_VISITAS,
  urlConFiltros,
} from '@/modules/admin/filtrosComunes'
import { FiltrosChips, type GrupoFiltro } from '@/components/admin/FiltrosChips'
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

  const f = leerFiltrosMembresias(sp)

  // El filtro vive en `modules/admin/membresiasFiltro`: la exportación usa el
  // MISMO, para que el CSV no pueda separarse de lo que se ve.
  const where = whereMembresias(companyId, sp)

  let memberships: MembershipRow[] = []
  let planes: PlanOption[] = []
  let categorias: { id: string; nombre: string }[] = []
  let total = 0
  let fallo = false
  try {
    const [data, planesData, cuenta, tipos] = await conEmpresaOTodas(
      companyId,
      'membresias: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => Promise.all([
        tx.membership.findMany({
          where,
          include: { plan: true, cliente: true },
          // Lo que vence antes, primero: con el filtro de vencimiento puesto,
          // el orden por fecha de creación enterraba lo urgente.
          orderBy: f.vence
            ? [{ fechaVencimiento: 'asc' }]
            : [{ createdAt: 'desc' }],
          skip: pag.saltar,
          take: pag.tomar,
        }),
        // Planes activos de la empresa para el cambio de plan directo por el
        // admin (política: el cliente no puede cambiar su plan desde la app).
        tx.plan.findMany({
          where: { ...(companyId ? { companyId } : {}), activo: true },
          orderBy: [{ orden: 'asc' }, { precio: 'asc' }],
          select: { id: true, nombre: true, precio: true },
        }),
        tx.membership.count({ where }),
        // Categorías de vehículo: solo se ofrece el filtro si el negocio las usa.
        tx.tipoVehiculo
          .findMany({
            where: { ...(companyId ? { companyId } : {}), activo: true },
            orderBy: { nivelTarifario: 'asc' },
            select: { id: true, nombre: true },
          })
          .catch(() => []),
      ])
    )
    memberships = data as unknown as MembershipRow[]
    total = cuenta
    categorias = tipos
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

  const grupos: GrupoFiltro[] = [
    {
      clave: 'estado',
      titulo: 'Estado',
      activo: f.estado,
      opciones: ESTADOS_MEMBRESIA.map((e) => ({ valor: e.clave, label: e.label })),
    },
    {
      clave: 'vence',
      titulo: 'Vence en',
      activo: f.vence ? String(f.vence) : undefined,
      opciones: DIAS_PARA_VENCER.map((d) => ({ valor: String(d), label: `${d} días` })),
    },
    {
      clave: 'usos',
      titulo: 'Usos',
      activo: f.usos,
      opciones: USOS_OPCIONES.map((u) => ({ valor: u.clave, label: u.label })),
    },
    {
      clave: 'sinVisitas',
      titulo: 'Sin venir',
      activo: f.sinVisitas ? String(f.sinVisitas) : undefined,
      opciones: DIAS_SIN_VISITAS.map((d) => ({ valor: String(d), label: `+${d} días` })),
    },
    ...(planes.length > 1
      ? [
          {
            clave: 'plan',
            titulo: 'Plan',
            activo: f.plan,
            opciones: planes.map((p) => ({ valor: p.id, label: p.nombre })),
          },
        ]
      : []),
    ...(categorias.length > 0
      ? [
          {
            clave: 'vehiculo',
            titulo: 'Categoría',
            activo: f.vehiculo,
            opciones: categorias.map((c) => ({ valor: c.id, label: c.nombre })),
          },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clientes"
        title="Membresías"
        description={
          fallo
            ? 'No se pudieron cargar las membresías.'
            : total === 0
              ? 'Ninguna membresía coincide con lo que buscas.'
              : `Quién tiene qué. ${desde}–${hasta} de ${total}`
        }
        action={
          <Button asChild variant="outline">
            <Link href="/admin/planes">Ver planes</Link>
          </Button>
        }
      />

      <FiltrosChips
        base="/admin/membresias"
        params={sp}
        grupos={grupos}
        hayFiltros={hayFiltrosMembresias(f)}
      />

      {/* `next/form` navega sin JavaScript: el buscador sigue funcionando con
          mala conexión o antes de que cargue el bundle. Los filtros activos
          viajan ocultos para que buscar no los borre. */}
      <Form action="/admin/membresias" className="flex max-w-2xl gap-2">
        {(['estado', 'vence', 'usos', 'sinVisitas', 'plan', 'vehiculo'] as const).map((k) =>
          sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null
        )}
        <Input
          name="q"
          aria-label="Buscar membresías"
          defaultValue={busqueda}
          placeholder="Buscar por cliente, correo, teléfono o plan…"
          className="min-h-10"
          autoComplete="off"
        />
        <Button type="submit" variant="outline" className="shrink-0">
          <Search className="h-4 w-4" />
        </Button>
        {/* Enlace al servidor: se lleva TODO el filtro, no la página visible. */}
        <Button asChild variant="outline" className="shrink-0">
          <a href={urlConFiltros('/admin/membresias/export', sp, {})}>
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
