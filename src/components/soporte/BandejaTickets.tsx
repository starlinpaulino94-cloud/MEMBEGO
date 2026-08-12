import { resolveCompanyContext, listTicketsAdmin } from '@/modules/soporte/queries'
import { PageHeader } from '@/components/ui/page-header'
import { CompanySelector } from '@/components/admin/CompanySelector'
import { TicketsTable, type TicketRow } from '@/components/admin/TicketsTable'
import { formatDate } from '@/lib/format'
import type { SessionUser } from '@/types'

/**
 * La bandeja de tickets, una sola vez.
 *
 * Vive en dos rutas: `/admin/tickets` para el administrador de una empresa y
 * `/superadmin/tickets` para el operador de la plataforma. La misma pantalla en
 * dos sitios, no dos pantallas.
 *
 * POR QUÉ HAY DOS RUTAS. El aviso «Tickets abiertos» del Centro de control
 * llevaba a `/admin/tickets`, y eso saca al superadmin del panel de PLATAFORMA y
 * lo mete en el de EMPRESA: la barra lateral cambia entera y volver no es obvio.
 * La barra tiene dos pestañas explícitas —Plataforma y Panel de empresa—, así que
 * cruzar de una a otra al pulsar un aviso contradice lo que la propia navegación
 * promete. Con la ruta gemela, el aviso lleva a la misma bandeja sin mover al
 * usuario de sitio.
 *
 * Y NO SE DUPLICA NADA: las dos rutas son cuatro líneas que renderizan esto.
 */
export async function BandejaTickets({
  user,
  company,
}: {
  user: SessionUser
  /** Empresa elegida en el selector (solo la usa el superadmin). */
  company?: string
}) {
  const ctx = await resolveCompanyContext(user, company)
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
