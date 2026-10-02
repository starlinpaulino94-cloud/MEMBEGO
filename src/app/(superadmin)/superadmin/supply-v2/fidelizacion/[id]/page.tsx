import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { fichaDePrograma } from '@/modules/supply-v2/loyalty/queries'
import { puedeSupplyV2 } from '@/modules/supply-v2/permisos'
import { ESTADO_PROGRAMA, TIPO_DE_PLAN } from '@/modules/supply-v2/core/catalogo'

export const dynamic = 'force-dynamic'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 8 · ficha de un programa (§41).
 *
 * Todo lo que hay que saber de un programa, y su bitácora completa, que no se
 * borra nunca. El presupuesto y los costos solo con permiso financiero.
 */
export default async function FichaProgramaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [p, veFinanzas] = await Promise.all([fichaDePrograma(id), puedeSupplyV2('SUPPLY_V2_LOYALTY_FINANCE_VIEW')])
  if (!p) notFound()

  return (
    <div className="space-y-6">
      <PageHeader title={p.nombre} description={p.descripcion ?? p.objetivo ?? 'Programa de fidelización'} eyebrow={p.code} />

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
          <div>
            <p className="text-caption uppercase text-muted-foreground">Estado</p>
            <p data-testid="ficha-estado">{ESTADO_PROGRAMA[p.estado] ?? p.estado}</p>
          </div>
          <div>
            <p className="text-caption uppercase text-muted-foreground">Dueño</p>
            <p data-testid="ficha-dueno">{p.propietario}</p>
          </div>
          <div>
            <p className="text-caption uppercase text-muted-foreground">Vigencia</p>
            <p className="tabular-nums">
              {formatDate(new Date(p.vigencia.desde))}
              {p.vigencia.hasta ? ` – ${formatDate(new Date(p.vigencia.hasta))}` : ' · sin fin'}
            </p>
          </div>
          {p.reglaDePuntos && (
            <div className="sm:col-span-2">
              <p className="text-caption uppercase text-muted-foreground">Regla de puntos</p>
              <p data-testid="ficha-regla-puntos">{p.reglaDePuntos}</p>
            </div>
          )}
          <div>
            <p className="text-caption uppercase text-muted-foreground">Vencimiento de puntos</p>
            <p>{p.vencimientoDePuntos}</p>
          </div>
        </CardContent>
      </Card>

      {veFinanzas && (
        <Card data-testid="ficha-presupuesto">
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-h4">Presupuesto</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {([
                ['Aprobado', p.presupuesto.aprobado ?? 'Sin techo', 'pres-aprobado'],
                ['Comprometido', p.presupuesto.comprometido, 'pres-comprometido'],
                ['Gastado', p.presupuesto.realizado, 'pres-realizado'],
                ['Pendiente', p.presupuesto.pendiente, 'pres-pendiente'],
                ['Disponible', p.presupuesto.disponible ?? '—', 'pres-disponible'],
              ] as const).map(([k, v, tid]) => (
                <div key={k} className="rounded-xl bg-muted/50 p-2">
                  <dt className="text-caption text-muted-foreground">{k}</dt>
                  <dd className="tabular-nums" data-testid={tid}>{v}</dd>
                </div>
              ))}
            </dl>
            {p.presupuesto.sinTopeAutorizado && (
              <p className="text-sm text-destructive" data-testid="aviso-sin-techo">
                Este programa va SIN techo con autorización escrita: «{p.presupuesto.sinTopeAutorizado.motivo}»
                {p.presupuesto.sinTopeAutorizado.cuando ? ` (${formatDate(new Date(p.presupuesto.sinTopeAutorizado.cuando))})` : ''}.
              </p>
            )}
            {p.presupuesto.algunaSinTope && (
              <p className="text-sm text-muted-foreground">Alguna recompensa va sin tope: el techo no se puede garantizar.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="ficha-puntos">
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-h4">Puntos</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {([
              ['Emitidos', String(p.puntos.emitidos), 'pts-emitidos'],
              ['Disponibles', String(p.puntos.disponibles), 'pts-disponibles'],
              ['Pendientes', String(p.puntos.pendientes), 'pts-pendientes'],
              ['Usados', String(p.puntos.usados), 'pts-usados'],
              ['Vencidos', String(p.puntos.vencidos), 'pts-vencidos'],
            ] as const).map(([k, v, tid]) => (
              <div key={k} className="rounded-xl bg-muted/50 p-2">
                <dt className="text-caption text-muted-foreground">{k}</dt>
                <dd className="tabular-nums" data-testid={tid}>{v}</dd>
              </div>
            ))}
          </dl>
          {veFinanzas && (
            <p className="text-sm" data-testid="ficha-compromiso">
              Costo efectivo <strong className="tabular-nums">{p.puntos.costoEfectivo}</strong> · Compromiso potencial{' '}
              <strong className="tabular-nums">{p.puntos.costoPotencialEstimado}</strong>{' '}
              <span className="text-muted-foreground">
                (estimación, no deuda: depende de que la gente canjee y de que no se le venzan los puntos antes).
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {p.planes.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 text-h4">Planes</h2>
            <ul className="space-y-2 text-sm" data-testid="ficha-planes">
              {p.planes.map((pl) => (
                <li key={pl.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                  <span>
                    <strong>{pl.nombre}</strong> · {TIPO_DE_PLAN[pl.tipo] ?? pl.tipo} · {pl.dias} días · v{pl.version}
                  </span>
                  <span className="tabular-nums">{pl.precio} · {pl.miembros} miembro(s) · {pl.estado}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {p.recompensas.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-3 text-h4">Recompensas</h2>
            <ul className="space-y-2 text-sm" data-testid="ficha-recompensas">
              {p.recompensas.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
                  <span><strong>{r.nombre}</strong> · {r.puntosNecesarios} puntos · {r.estado}</span>
                  <span className="tabular-nums">
                    {r.reclamadas} reclamada(s){r.tope ? ` de ${r.tope}` : ''}
                    {veFinanzas && r.costoPorEntrega ? ` · ${r.costoPorEntrega} por entrega` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-3 text-h4">Bitácora</h2>
          <ul className="space-y-1 text-sm" data-testid="ficha-bitacora">
            {p.bitacora.map((e, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2">
                <span>{e.tipo}</span>
                <span className="text-muted-foreground">{formatDate(new Date(e.cuando))} · {e.quien}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
