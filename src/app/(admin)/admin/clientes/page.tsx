import Form from 'next/form'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { companyFilter } from '@/modules/admin/queries'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ClientesTable, type ClienteRow } from '@/components/admin/ClientesTable'
import { whereClientes } from '@/modules/admin/clientesFiltro'
import { Download } from 'lucide-react'

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
  searchParams: Promise<{ q?: string; p?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  const { q, p } = await searchParams

  const busqueda = (q ?? '').trim()
  const pagina = Math.max(1, Number.parseInt(p ?? '1', 10) || 1)

  // El filtro vive en `modules/admin/clientesFiltro`: la exportación usa el
  // MISMO, para que el CSV no pueda separarse nunca de lo que se ve.
  const where = whereClientes(companyId, busqueda)

  let clientes: ClienteRow[] = []
  let total = 0
  let fallo = false
  try {
    ;[clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        include: {
          memberships: {
            include: { plan: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }) as Promise<ClienteRow[]>,
      prisma.cliente.count({ where }),
    ])
  } catch (e) {
    fallo = true
    console.error('[admin-clientes]', e)
  }

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
      <Form action="/admin/clientes" className="flex max-w-md gap-2">
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
        <Button asChild variant="outline" className="shrink-0">
          <a href={`/admin/clientes/export${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </a>
        </Button>
      </Form>

      <ClientesTable data={clientes} />

      {paginas > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Paginación">
          <PaginaLink
            href={enlace(busqueda, pagina - 1)}
            disponible={pagina > 1}
            texto="← Anterior"
          />
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          <PaginaLink
            href={enlace(busqueda, pagina + 1)}
            disponible={pagina < paginas}
            texto="Siguiente →"
          />
        </nav>
      )}
    </div>
  )
}

function enlace(q: string, pagina: number): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (pagina > 1) params.set('p', String(pagina))
  const cadena = params.toString()
  return `/admin/clientes${cadena ? `?${cadena}` : ''}`
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
