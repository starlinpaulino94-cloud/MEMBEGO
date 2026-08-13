import Link from 'next/link'
import { Download, ExternalLink, MessageCircle, TriangleAlert } from 'lucide-react'
import { ADMIN_ROLES } from '@/types'
import { requireRole } from '@/lib/auth/guards'
import { companyFilter } from '@/modules/admin/queries'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, formatMoney } from '@/lib/format'
import { clientesEnRiesgo, leerFiltroRiesgo } from '@/modules/riesgo'
import {
  DIAS_PARA_VENCER,
  DIAS_SIN_VISITAS,
  diasDesde,
  diasHasta,
  urlConFiltros,
} from '@/modules/admin/filtrosComunes'
import { FiltrosChips, type GrupoFiltro } from '@/components/admin/FiltrosChips'
import { ReporteImprimible } from '@/components/ui/reporte-imprimible'
import { BotonImprimir } from '@/components/ui/boton-imprimir'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/system/EmptyState'
import { leerPaginacion } from '@/lib/paginacion'
import { TablaPaginacion } from '@/components/tablas/TablaPaginacion'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Clientes en riesgo',
  description: 'Quién está a punto de irse, y cuánto cuesta perderlo',
}

const POR_PAGINA = 50

/** Enlace de WhatsApp desde un teléfono local (es-DO: antepone 1 si falta). */
function waLink(telefono: string | null, mensaje: string) {
  if (!telefono) return null
  let digits = telefono.replace(/\D/g, '')
  if (digits.length === 10 && !digits.startsWith('1')) digits = `1${digits}`
  if (digits.length < 10) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(mensaje)}`
}

/**
 * CLIENTES EN RIESGO (auditoría · B-7, C-11, C-12).
 *
 * El Resumen decía «2 membresías vencen esta semana» y «17 clientes llevan 30
 * días sin venir», y los dos avisos llevaban a listas SIN filtrar: el sistema
 * identificaba a las personas a las que hay que llamar hoy y después dejaba al
 * administrador buscándolas a mano entre cincuenta filas. Esta es la pantalla
 * que faltaba, y es adonde llevan ahora esos avisos.
 *
 * Tres decisiones que la separan de una tabla más:
 *
 * - **Ordena por dinero en juego, no por nombre.** Con una tarde para llamar,
 *   el orden alfabético reparte el esfuerzo al azar.
 * - **Las acciones están en cada fila.** El WhatsApp llega con el mensaje ya
 *   escrito: si hay que redactarlo cincuenta veces, se llama a diez.
 * - **Los umbrales están en la URL.** «Sin venir +60 y vence en 7» es un enlace
 *   que se pega en un grupo de WhatsApp; un filtro que solo vive en el
 *   navegador no se puede señalar con el dedo.
 */
export default async function RiesgoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireRole(ADMIN_ROLES)
  const companyId = companyFilter(user)
  if (!companyId) return <SinEmpresaActiva seccion="los clientes en riesgo" />

  const sp = await searchParams
  const filtro = leerFiltroRiesgo(sp)
  const pag = leerPaginacion(sp, POR_PAGINA)
  const prefs = await getRegionalPrefs(companyId)
  const dinero = (n: number) => formatMoney(n, prefs)

  const { items, total, valorTotal } = await clientesEnRiesgo(companyId, filtro, pag).catch(
    (e) => {
      console.error('[admin-riesgo]', e)
      return { items: [], total: 0, valorTotal: 0 }
    }
  )

  const grupos: GrupoFiltro[] = [
    {
      clave: 'sinVisitas',
      titulo: 'Sin venir',
      activo: String(filtro.sinVisitas),
      opciones: [
        { valor: '0', label: 'Da igual' },
        ...DIAS_SIN_VISITAS.map((d) => ({ valor: String(d), label: `+${d} días` })),
      ],
    },
    {
      clave: 'vence',
      titulo: 'Vence en',
      activo: String(filtro.vence),
      opciones: [
        { valor: '0', label: 'Da igual' },
        ...DIAS_PARA_VENCER.map((d) => ({ valor: String(d), label: `${d} días` })),
      ],
    },
    {
      clave: 'usos',
      titulo: 'Usos',
      activo: filtro.soloConUsos ? 'con' : undefined,
      opciones: [{ valor: 'con', label: 'Solo con usos sin consumir' }],
    },
  ]

  const desde = total === 0 ? 0 : pag.saltar + 1
  const hasta = Math.min(pag.saltar + pag.tomar, total)

  return (
    <ReporteImprimible
      titulo="Clientes en riesgo"
      subtitulo={
        total === 0
          ? 'Con estos criterios no hay nadie en riesgo. Prueba a ampliar las ventanas.'
          : `${desde}–${hasta} de ${total} · ${dinero(valorTotal)} en juego`
      }
      generadoEn={formatDateTime(new Date(), prefs)}
      controles={
        <>
          <Button asChild variant="outline">
            <a href={urlConFiltros('/admin/riesgo/export', sp, {})}>
              <Download className="mr-2 h-4 w-4" aria-hidden /> Exportar CSV
            </a>
          </Button>
          {/* En papel: la lista de a quién llamar, para repartirla entre el
              equipo sin que cada persona necesite una pantalla. */}
          <BotonImprimir />
        </>
      }
    >
      <FiltrosChips
        base="/admin/riesgo"
        params={sp}
        grupos={grupos}
        hayFiltros={filtro.sinVisitas > 0 || filtro.vence > 0 || filtro.soloConUsos}
      />

      {total === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="Nadie en riesgo con estos criterios"
          description="Es una buena noticia, pero conviene comprobarlo con ventanas más amplias antes de darlo por hecho."
          action={
            <Button asChild variant="outline">
              <Link href="/admin/riesgo?sinVisitas=60&vence=0">Ver quién lleva 60 días sin venir</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* El «valor en juego» necesita una frase, no un tooltip: es un número
              que la gente va a citar en una reunión y tiene que poder
              defenderlo. */}
          <p className="text-caption">
            <strong className="text-foreground">Valor en juego</strong> = lo que queda sin
            consumir de cada membresía, al precio al que se compró. En los planes ilimitados
            es la renovación completa. La lista va ordenada por ese número: arriba, a quien
            más cuesta perder.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card">
            <table className="w-full">
              <thead className="border-b border-border/70 bg-muted/50">
                <tr className="text-overline">
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Plan</th>
                  <th className="px-4 py-3 text-right">Sin venir</th>
                  <th className="px-4 py-3 text-right">Vence</th>
                  <th className="px-4 py-3 text-right">Usos</th>
                  <th className="px-4 py-3 text-right">En juego</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {items.map((c) => {
                  const sinVenir = diasDesde(c.ultimaVisita ? new Date(c.ultimaVisita) : null)
                  const paraVencer = diasHasta(
                    c.fechaVencimiento ? new Date(c.fechaVencimiento) : null
                  )
                  const wa = waLink(
                    c.telefono,
                    `Hola ${c.nombre.split(' ')[0]}, te escribimos de parte del equipo. ` +
                      (c.esIlimitado
                        ? 'Tu membresía está por vencer y no queremos que la pierdas.'
                        : `Todavía te quedan ${c.usosRestantes} usos en tu plan ${c.plan}` +
                          (paraVencer != null && paraVencer <= 30
                            ? `, y vence en ${paraVencer} días.`
                            : '.')) +
                      ' ¿Te esperamos esta semana?'
                  )
                  return (
                    <tr key={c.membershipId} className="text-sm">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/clientes/${c.clienteId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {c.nombre}
                        </Link>
                        <span className="block text-caption">{c.email}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.plan}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {sinVenir == null ? (
                          <span className="text-destructive">nunca vino</span>
                        ) : (
                          `${sinVenir} d`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {paraVencer == null ? (
                          '—'
                        ) : (
                          <span className={paraVencer <= 7 ? 'font-semibold text-destructive' : ''}>
                            {paraVencer} d
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.esIlimitado ? '∞' : c.usosRestantes}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {dinero(c.valorEnJuego)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {wa && (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Escribir a ${c.nombre} por WhatsApp`}
                              aria-label={`Escribir a ${c.nombre} por WhatsApp`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          <Link
                            href={`/admin/clientes/${c.clienteId}`}
                            title="Ver ficha"
                            aria-label={`Ver ficha de ${c.nombre}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/notificaciones">Notificar a este grupo</Link>
            </Button>
            <TablaPaginacion
              paginacion={pag}
              total={total}
              params={sp}
              etiqueta="clientes en riesgo"
            />
          </div>
        </>
      )}
    </ReporteImprimible>
  )
}
