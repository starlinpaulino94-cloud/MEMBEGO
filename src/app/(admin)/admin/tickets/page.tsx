import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { resolveCompanyContext, listTicketsAdmin } from '@/modules/soporte/queries'
import { PageHeader } from '@/components/ui/page-header'
import { CompanySelector } from '@/components/admin/CompanySelector'
import { TicketsTable, type TicketRow } from '@/components/admin/TicketsTable'
import { formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const sp = await searchParams
  const ctx = await resolveCompanyContext(user, sp.company)

  const tickets = await listTicketsAdmin(ctx.companyId, ctx.isSuperadmin)

  const rows: TicketRow[] = tickets.map((t) => ({
    id: t.id,
    asunto: t.asunto,
    estado: t.estado,
    categoria: t.categoria,
    clienteNombre: t.cliente.nombre,
    empresaNombre: t.company.name,
    mensajes: t._count.mensajes,
    // `formatDate` respeta el idioma y la zona horaria de la empresa; el
    // `toLocaleDateString('es-DO')` de antes los ignoraba y además formateaba
    // en la zona del servidor, que corre en UTC.
    actualizado: formatDate(t.updatedAt, null, { day: '2-digit', month: 'short' }),
    showEmpresa: ctx.isSuperadmin && !ctx.companyId,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets de soporte"
        description="Gestiona las solicitudes de soporte de tus clientes."
        action={
          ctx.isSuperadmin ? (
            <CompanySelector companies={ctx.companies} current={ctx.companyId} />
          ) : undefined
        }
      />

      {/* Se van las cuatro tarjetas de "Total / Nuevos / En proceso /
          Resueltos". Contaban tres de los CINCO estados, así que los tickets en
          ESPERANDO_CLIENTE no salían en ninguna y las cifras no sumaban el
          total — un desglose que no cuadra enseña a no mirarlo. Y ninguna era
          pulsable: cuatro números y después un desplegable aparte para filtrar
          por lo mismo. Los contadores viven ahora en las pestañas de cola, que
          además llevan a su lista. */}
      <TicketsTable tickets={rows} />
    </div>
  )
}
