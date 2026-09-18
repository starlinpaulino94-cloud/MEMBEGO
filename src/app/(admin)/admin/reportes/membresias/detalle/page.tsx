import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { conEmpresa } from '@/lib/tenant'
import { requireRole, requireSection } from '@/lib/auth/guards'
import { ADMIN_ROLES } from '@/types'
import { requireCompanyContext } from '@/lib/auth/company-context'
import { getRegionalPrefs } from '@/modules/empresas/regional'
import { formatDateTime, TZ_PLATAFORMA } from '@/lib/format'
import { leerRango, paramsDeRango } from '@/modules/reportes/rango'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SinEmpresaActiva } from '@/components/admin/SinEmpresaActiva'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Detalle del ciclo de vida' }

const TIPOS = {
  ACTIVADA: 'Activaciones',
  RENOVADA: 'Renovaciones',
  CANCELADA: 'Cancelaciones',
  VENCIDA: 'Vencimientos',
  CAMBIO_PLAN: 'Cambios de plan',
  // El resto del ciclo (F3): el enum tenía siete tipos y aquí solo se
  // enseñaban cinco — CREADA y RECHAZADA existían y no se podían abrir; los
  // ajustes ni siquiera se escribían (Fase 2 los estrenó).
  AJUSTADA: 'Ajustes (vigencia y lavados)',
  CREADA: 'Creadas (pendientes)',
  RECHAZADA: 'Pagos rechazados',
} as const

/** Tipos cuya fila enseña el motivo escrito al hacerlos. */
const CON_MOTIVO = new Set<TipoDetalle>(['CANCELADA', 'AJUSTADA', 'RECHAZADA'])

/** Qué se ajustó, leído del payload del evento AJUSTADA. Nunca lanza. */
function detalleAjuste(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { ajuste?: unknown; antes?: unknown; despues?: unknown; delta?: unknown }
  const que =
    p.ajuste === 'VENCIMIENTO' ? 'Vigencia' : p.ajuste === 'LAVADOS' ? 'Lavados' : null
  if (!que) return null
  const antes = p.antes == null ? '—' : String(p.antes)
  const despues = p.despues == null ? '—' : String(p.despues)
  return `${que}: ${antes} → ${despues}`
}

type TipoDetalle = keyof typeof TIPOS

const ORIGEN_LABEL: Record<string, string> = {
  ADMIN: 'El negocio',
  CLIENTE: 'El cliente',
  SUPERADMIN: 'Soporte',
  CRON: 'Automático',
  API: 'Integración',
  RECONSTRUIDO: 'Histórico reconstruido',
}

/** Tope de filas. Un detalle no es una exportación: lo que no cabe, se dice. */
const MAX = 300

/**
 * LAS FILAS QUE PRODUJERON LA CIFRA.
 *
 * Es la mitad que faltaba del reporte. Un panel donde «12 cancelaciones» no se
 * puede abrir obliga a creer el número o a no usarlo, y lo segundo es lo que
 * acaba pasando.
 *
 * Hereda el MISMO rango que la pantalla anterior porque lee la URL con la misma
 * función. Si lo recalculara por su cuenta, el detalle de «12» podría enseñar
 * once filas y nadie sabría cuál de las dos pantallas miente.
 */
export default async function DetalleCicloVidaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole(ADMIN_ROLES)
  const user = await requireSection('reportes', 'ver')
  if (!user) return <SinEmpresaActiva seccion="los reportes" />
  const companyId = await requireCompanyContext(user)

  const sp = await searchParams
  const pedido = String(Array.isArray(sp.tipo) ? sp.tipo[0] : (sp.tipo ?? ''))
  const tipo: TipoDetalle = pedido in TIPOS ? (pedido as TipoDetalle) : 'RENOVADA'

  const empresa = await conEmpresa(companyId, (tx) =>
    tx.company
      .findUnique({ where: { id: companyId }, select: { zonaHoraria: true } })
      .catch(() => null)
  )
  const timeZone = empresa?.zonaHoraria || TZ_PLATAFORMA
  const rango = leerRango(sp, timeZone)
  const prefs = await getRegionalPrefs(companyId)

  const [filas, total] = await conEmpresa(companyId, (tx) =>
    Promise.all([
      tx.membresiaEvento.findMany({
        where: {
          companyId,
          tipo,
          ocurridoEn: { gte: rango.desde, lt: rango.hasta },
        },
        orderBy: { ocurridoEn: 'desc' },
        take: MAX,
        select: {
          id: true,
          ocurridoEn: true,
          origen: true,
          motivo: true,
          reconstruido: true,
          membershipId: true,
          precioAnterior: true,
          precioNuevo: true,
          payload: true,
          membership: { select: { cliente: { select: { id: true, nombre: true } } } },
          actor: { select: { name: true, email: true } },
        },
      }),
      // El total sale de un `count`, no del largo de la lista recortada: si no,
      // el detalle diría 300 cuando hubo 4.000.
      tx.membresiaEvento.count({
        where: { companyId, tipo, ocurridoEn: { gte: rango.desde, lt: rango.hasta } },
      }),
    ])
  )

  const qs = paramsDeRango(rango)
  const dinero = (v: unknown) =>
    v == null ? '—' : new Intl.NumberFormat(prefs?.idioma || 'es-DO').format(Number(v))

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/admin/reportes/membresias${qs}`}>
          <ArrowLeft className="h-4 w-4" /> Volver al reporte
        </Link>
      </Button>

      <PageHeader
        title={TIPOS[tipo]}
        description={`${rango.desdeDia} a ${rango.hastaDia} · ${total} en total${
          total > MAX ? ` · se muestran las ${MAX} más recientes` : ''
        }`}
      />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TIPOS) as TipoDetalle[]).map((t) => (
          <Button
            key={t}
            asChild
            size="sm"
            variant={t === tipo ? 'default' : 'outline'}
            className="rounded-full"
          >
            <Link href={`/admin/reportes/membresias/detalle?tipo=${t}${qs ? `&${qs.slice(1)}` : ''}`}>
              {TIPOS[t]}
            </Link>
          </Button>
        ))}
      </div>

      {filas.length === 0 ? (
        <EmptyState
          title="Nada que mostrar"
          description="No hubo eventos de este tipo en el periodo elegido."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-small">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 text-overline">Cuándo</th>
                <th className="px-3 py-2 text-overline">Cliente</th>
                <th className="px-3 py-2 text-overline">Origen</th>
                {tipo === 'CAMBIO_PLAN' && (
                  <th className="px-3 py-2 text-right text-overline">Precio</th>
                )}
                {tipo === 'AJUSTADA' && <th className="px-3 py-2 text-overline">Qué cambió</th>}
                <th className="px-3 py-2 text-overline">Quién</th>
                {CON_MOTIVO.has(tipo) && <th className="px-3 py-2 text-overline">Motivo</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(f.ocurridoEn, prefs)}
                    {f.reconstruido && (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-caption"
                        title="Fila reconstruida desde la bitácora, no escrita por el camino normal"
                      >
                        reconstruido
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {f.membership?.cliente ? (
                      <Link
                        href={`/admin/clientes/${f.membership.cliente.id}`}
                        className="text-foreground underline-offset-2 hover:underline"
                      >
                        {f.membership.cliente.nombre}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ORIGEN_LABEL[f.origen] ?? f.origen}
                  </td>
                  {tipo === 'CAMBIO_PLAN' && (
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {dinero(f.precioAnterior)} → {dinero(f.precioNuevo)}
                    </td>
                  )}
                  {tipo === 'AJUSTADA' && (
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {detalleAjuste(f.payload) ?? '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-muted-foreground">
                    {f.actor?.name ?? f.actor?.email ?? '—'}
                  </td>
                  {CON_MOTIVO.has(tipo) && (
                    <td className="px-3 py-2 text-muted-foreground">{f.motivo ?? '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
