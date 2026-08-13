import { resolveCompanyContext, listTicketsAdmin } from '@/modules/soporte/queries'
import { leerFiltroTickets } from '@/modules/soporte/filtros'
import { PageHeader } from '@/components/ui/page-header'
import { CompanySelector } from '@/components/admin/CompanySelector'
import { TicketsTable } from '@/components/admin/TicketsTable'
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIA EL `alcance`, Y POR QUÉ NO BASTABA CON LA RUTA GEMELA
 *
 * Al montar la ruta se dio por hecho que `resolveCompanyContext` dejaba al
 * superadmin sin empresa —«ya sabe que ve las de todas», decía el comentario— y
 * era falso: elegía SIEMPRE una, y sin elección explícita, la primera
 * alfabéticamente. La bandeja de plataforma enseñaba los tickets de una sola
 * empresa sin decirlo, y como `showEmpresa` se activa solo cuando no hay
 * empresa, tampoco salía la columna que lo habría delatado.
 *
 * El aviso del Centro de control, en cambio, cuenta los pendientes de TODAS las
 * empresas. Decía «7 abiertos» y al pulsar aparecían 2.
 *
 * `alcance` hace explícito lo que antes se suponía: en `plataforma` el
 * superadmin arranca viéndolo todo y acota si quiere; en `empresa`, nada
 * cambia.
 */
export async function BandejaTickets({
  user,
  searchParams,
  alcance,
}: {
  user: SessionUser
  searchParams: Record<string, string | undefined>
  alcance: 'plataforma' | 'empresa'
}) {
  const f = leerFiltroTickets(searchParams)
  const ctx = await resolveCompanyContext(user, f.empresa ?? undefined, {
    ambitoPlataforma: alcance === 'plataforma',
  })
  const d = await listTicketsAdmin(ctx.companyId, ctx.isSuperadmin, f)

  const base = alcance === 'plataforma' ? '/superadmin/tickets' : '/admin/tickets'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tickets de soporte"
        description={
          // En el panel de plataforma los tickets NO son tuyos: son de las
          // empresas, y quien los responde es cada negocio.
          alcance === 'plataforma'
            ? 'Solicitudes de soporte abiertas por los clientes de cada empresa.'
            : 'Gestiona las solicitudes de soporte de tus clientes.'
        }
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
      <TicketsTable
        datos={d}
        f={f}
        base={base}
        detalleBase={`${base}/`}
        mostrarEmpresa={ctx.companyId === null}
        mostrarAmbito={ctx.companyId === null}
      />
    </div>
  )
}
