import Form from 'next/form'
import { conEmpresaOTodas } from '@/lib/tenant'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ClientesTable, type ClienteRow } from '@/components/admin/ClientesTable'
import {
  MEMBRESIA_OPCIONES,
  hayFiltrosClientes,
  leerFiltrosClientes,
  whereClientes,
} from '@/modules/admin/clientesFiltro'
import { DIAS_SIN_VISITAS, urlConFiltros } from '@/modules/admin/filtrosComunes'
import { semaforoDeFila } from '@/modules/riesgo/clasificar'
import { getUmbralesRetencion } from '@/modules/riesgo/umbrales'
import { resolverUmbrales } from '@/modules/riesgo/semaforo'
import { FiltrosChips, type GrupoFiltro } from '@/components/admin/FiltrosChips'
import { BotonExportar } from '@/components/ui/boton-exportar'

export const dynamic = 'force-dynamic'

/**
 * Listado de clientes de la empresa — PAGINADO EN EL SERVIDOR
 * (auditoría de producción · M-07).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * `take: 200` sin desplazamiento y sin total. Dos consecuencias:
 *
 *  1. Con más de 200 clientes, el resto era INVISIBLE. No había forma de
 *     llegar a ellos desde esta pantalla — y el encabezado decía
 *     "200 registros", que además era mentira: eran los 200 más recientes.
 *  2. El buscador filtraba solo esas 200 filas ya cargadas. Buscar a un
 *     cliente antiguo por su nombre no lo encontraba nunca, y la pantalla no
 *     daba ninguna pista de por qué.
 *
 * Con 100.000 clientes por empresa, además, traer 200 filas con sus membresías
 * y sus planes anidados en cada carga es trabajo que nadie pidió.
 *
 * CÓMO QUEDA
 *
 * La búsqueda y la paginación van al servidor: se busca sobre TODOS los
 * clientes de la empresa y se traen 50 por página. El buscador de la tabla se
 * retira a propósito (`searchKey` no se pasa) — dos buscadores con alcances
 * distintos en la misma pantalla es peor que uno solo que funciona.
 * ────────────────────────────────────────────────────────────────────────────
 */

const POR_PAGINA = 50

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const sp = await searchParams

  const busqueda = (sp.q ?? '').trim()
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1)
  const f = leerFiltrosClientes(sp)

  // El filtro vive en `modules/admin/clientesFiltro`: la exportación usa el
  // MISMO, para que el CSV no pueda separarse nunca de lo que se ve.
  const where = whereClientes(companyId, sp)
  const umbrales = await getUmbralesRetencion(companyId ?? '__none__').catch(() =>
    resolverUmbrales(null)
  )

  let clientes: ClienteRow[] = []
  let categorias: { id: string; nombre: string }[] = []
  let total = 0
  let fallo = false
  try {
    const [filas, cuenta, tipos] = await conEmpresaOTodas(
      companyId,
      'clientes: sin empresa activa es el superadmin, que cruza empresas a propósito',
      (tx) => Promise.all([
        tx.cliente.findMany({
          where,
          include: {
            memberships: {
              include: { plan: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            // La última visita: es la mitad del semáforo, y sin ella la columna
            // «Estado» tendría que adivinarse desde la fecha de vencimiento.
            visits: {
              select: { fechaVisita: true },
              orderBy: { fechaVisita: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (pagina - 1) * POR_PAGINA,
          take: POR_PAGINA,
        }),
        tx.cliente.count({ where }),
        // Categorías de vehículo: el filtro solo se ofrece si el negocio las usa.
        tx.tipoVehiculo
          .findMany({
            where: { ...(companyId ? { companyId } : {}), activo: true },
            orderBy: { nivelTarifario: 'asc' },
            select: { id: true, nombre: true },
          })
          .catch(() => []),
      ])
    )
    // El semáforo se calcula UNA vez, en el servidor, con los umbrales de esta
    // empresa. La tabla solo lo pinta: si lo decidiera el navegador, cada
    // pantalla podría llegar a una conclusión distinta del mismo cliente.
    const ahora = new Date()
    clientes = filas.map((c) => ({
      ...c,
      semaforo: semaforoDeFila(c, umbrales, ahora),
    })) as unknown as ClienteRow[]
    total = cuenta
    categorias = tipos
  } catch (e) {
    fallo = true
    console.error('[admin-clientes]', e)
  }

  const grupos: GrupoFiltro[] = [
    {
      clave: 'sinVisitas',
      titulo: 'Sin venir',
      activo: f.sinVisitas ? String(f.sinVisitas) : undefined,
      opciones: DIAS_SIN_VISITAS.map((d) => ({ valor: String(d), label: `+${d} días` })),
    },
    {
      clave: 'membresia',
      titulo: 'Membresía',
      activo: f.membresia,
      opciones: MEMBRESIA_OPCIONES.map((m) => ({ valor: m.clave, label: m.label })),
    },
    {
      clave: 'nuevos',
      titulo: 'Registrados',
      activo: f.nuevos ? String(f.nuevos) : undefined,
      opciones: [7, 30, 90].map((d) => ({ valor: String(d), label: `últimos ${d} días` })),
    },
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

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1
  const hasta = Math.min(pagina * POR_PAGINA, total)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description={
          fallo
            ? 'No se pudieron cargar los clientes.'
            : total === 0
              ? busqueda
                ? `Ningún cliente coincide con "${busqueda}".`
                : 'Todavía no hay clientes.'
              : `${desde}–${hasta} de ${total}${busqueda ? ` para "${busqueda}"` : ''}`
        }
      />

      {/* `next/form` navega sin JavaScript: el buscador sigue funcionando en la
          pista con conexión mala o mientras el bundle todavía no cargó. */}
      <FiltrosChips
        base="/admin/clientes"
        params={sp}
        grupos={grupos}
        hayFiltros={hayFiltrosClientes(f)}
      />

      {/* Los filtros activos viajan ocultos: buscar no debe borrarlos. */}
      <Form action="/admin/clientes" className="flex max-w-2xl gap-2">
        {(['sinVisitas', 'membresia', 'nuevos', 'vehiculo', 'vence'] as const).map((k) =>
          sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null
        )}
        <Input
          name="q"
          aria-label="Buscar clientes"
          defaultValue={busqueda}
          placeholder="Buscar por nombre, correo o teléfono…"
          className="min-h-10"
          autoComplete="off"
        />
        <Button type="submit" variant="outline" className="shrink-0">
          <Search className="h-4 w-4" />
        </Button>
        {/* La exportación es un ENLACE al servidor, no un botón en la tabla: se
            lleva todo el filtro, no las 50 filas que el navegador tenga a mano. */}
        <BotonExportar
          href={urlConFiltros('/admin/clientes/export', sp, {})}
          variant="outline"
          className="shrink-0"
        />
      </Form>

      <ClientesTable data={clientes} />

      {paginas > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Paginación">
          <PaginaLink
            href={urlConFiltros('/admin/clientes', { ...sp, p: undefined }, { p: pagina - 1 > 1 ? pagina - 1 : undefined })}
            disponible={pagina > 1}
            texto="← Anterior"
          />
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          <PaginaLink
            href={urlConFiltros('/admin/clientes', { ...sp, p: undefined }, { p: pagina + 1 })}
            disponible={pagina < paginas}
            texto="Siguiente →"
          />
        </nav>
      )}
    </div>
  )
}

/** El borde deshabilitado se pinta como texto, no como enlace muerto. */
function PaginaLink({
  href,
  disponible,
  texto,
}: {
  href: string
  disponible: boolean
  texto: string
}) {
  if (!disponible) {
    return <span className="text-sm text-muted-foreground/50">{texto}</span>
  }
  return (
    <Link
      href={href}
      className="rounded-lg border border-border/70 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
    >
      {texto}
    </Link>
  )
}
