import Link from 'next/link'
import { Clock, Car, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { EstadoPista, VehiculoEnPista } from '@/modules/carwash/pista'

/**
 * LA CABINA — el estado de la pista ahora mismo.
 *
 * Sustituye al launchpad de tarjetas iguales. Tres decisiones de diseño:
 *
 *  1. EL TIEMPO ES EL KPI. En un car wash el costo es el minuto de bahía, así
 *     que cada vehículo lleva su reloj y se pone en rojo cuando se pasa del
 *     estimado del catálogo.
 *  2. LO QUE PASA AHORA OCUPA LA PANTALLA. Los contadores de cierre de día
 *     ("caja de hoy") bajan al pie, que es donde se miran una vez.
 *  3. SE LEE DE PIE Y A UN METRO. Números grandes y tabulares, placas en
 *     mayúsculas, contraste alto — se usa con el celular en la mano.
 */

function Reloj({ minutos, estimado }: { minutos: number; estimado: number | null }) {
  // Se avisa al 80% del estimado y se marca en rojo al pasarse: el encargado
  // necesita ver el problema ANTES de que el cliente lo reclame.
  const excedido = estimado != null && minutos > estimado
  const cerca = estimado != null && !excedido && minutos >= estimado * 0.8
  const clase = excedido
    ? 'text-destructive'
    : cerca
      ? 'text-warning'
      : 'text-muted-foreground'
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-bold tabular-nums ${clase}`}>
      <Clock className="h-3.5 w-3.5" />
      {minutos}m
      {estimado != null && <span className="font-normal opacity-70">/ {estimado}m</span>}
    </span>
  )
}

function Identidad({ v }: { v: VehiculoEnPista }) {
  return (
    <>
      <p className="truncate font-mono text-lg font-bold uppercase tracking-wide text-foreground">
        {v.placa || 'sin placa'}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {[v.tipoVehiculo, v.descripcion || v.clienteNombre].filter(Boolean).join(' · ') ||
          'Sin detalle'}
      </p>
    </>
  )
}

function fmtRD(n: number) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(n)
}

export function Pista({ estado }: { estado: EstadoPista }) {
  const { bahias, esperando, enServicioSinBahia, listos, hoy } = estado
  const enServicio = bahias.filter((b) => b.ocupadaPor).length + enServicioSinBahia.length

  return (
    <div className="space-y-5">
      {/* ── Bahías: la fila que responde "¿cuál está libre?" ───────────── */}
      {bahias.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            En pista ahora
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {bahias.map((b) => (
              <div
                key={b.id}
                className={`rounded-2xl border p-4 ${
                  b.ocupadaPor
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-dashed border-border/70 bg-muted/20'
                }`}
              >
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {b.nombre}
                </p>
                {b.ocupadaPor ? (
                  <>
                    <Identidad v={b.ocupadaPor} />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Reloj
                        minutos={b.ocupadaPor.minutos}
                        estimado={b.ocupadaPor.estimado}
                      />
                      {b.ocupadaPor.total > 0 && (
                        <span className="text-xs font-semibold text-foreground">
                          {fmtRD(b.ocupadaPor.total)}
                        </span>
                      )}
                    </div>
                    {b.ocupadaPor.servicios.length > 0 && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {b.ocupadaPor.servicios.join(' + ')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="py-3 text-center text-sm font-semibold text-muted-foreground">
                    Libre
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Vehículos trabajándose sin bahía asignada (o sin bahías configuradas) */}
      {enServicioSinBahia.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            En servicio {bahias.length > 0 && '· sin bahía asignada'}
          </h2>
          <div className="space-y-2">
            {enServicioSinBahia.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3"
              >
                <div className="min-w-0">
                  <Identidad v={v} />
                </div>
                <Reloj minutos={v.minutos} estimado={v.estimado} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Esperando: ordenado por quien lleva más ─────────────────── */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Esperando
            {esperando.length > 0 && (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background">
                {esperando.length}
              </span>
            )}
          </h2>
          {esperando.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
              Nadie esperando.
            </p>
          ) : (
            <div className="space-y-2">
              {esperando.map((v, i) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                    // El primero de la fila es el que hay que atender ya.
                    i === 0 ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card'
                  }`}
                >
                  <div className="min-w-0">
                    <Identidad v={v} />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold tabular-nums ${
                      v.minutos >= 30 ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                  >
                    {v.minutos >= 30 && <AlertTriangle className="h-3.5 w-3.5" />}
                    <Clock className="h-3.5 w-3.5" />
                    {v.minutos}m
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Listos para entregar ─────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Listos para entregar
            {listos.length > 0 && (
              <span className="rounded-full bg-success px-2 py-0.5 text-[10px] text-background">
                {listos.length}
              </span>
            )}
          </h2>
          {listos.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
              Nada por entregar.
            </p>
          ) : (
            <div className="space-y-2">
              {listos.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 p-3"
                >
                  <div className="min-w-0">
                    <Identidad v={v} />
                  </div>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-bold text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    {v.total > 0 ? fmtRD(v.total) : 'Listo'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Cierre del día: abajo, que es donde se mira una vez ────────── */}
      <section className="grid grid-cols-2 gap-2 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:grid-cols-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hoy</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{hoy.atendidos}</p>
          <p className="text-[11px] text-muted-foreground">vehículos entregados</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Facturado</p>
          <p className="text-xl font-bold tabular-nums text-foreground">{fmtRD(hoy.ingresos)}</p>
          <p className="text-[11px] text-muted-foreground">en servicios</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tiempo medio</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {hoy.tiempoMedioMin != null ? `${hoy.tiempoMedioMin}m` : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">por vehículo</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">En pista</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {enServicio + esperando.length}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {enServicio} en servicio · {esperando.length} esperando
          </p>
        </div>
      </section>
    </div>
  )
}

/** Aviso cuando el catálogo del oficio todavía no está configurado. */
export function PistaSinCatalogo({ faltan }: { faltan: string[] }) {
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/10 p-5">
      <p className="flex items-center gap-2 font-bold text-foreground">
        <Car className="h-5 w-5" /> Falta configurar la pista
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        La app funciona, pero sin esto no puede cobrar por servicio ni estimar tiempos.
        Falta: <b className="text-foreground">{faltan.join(', ')}</b>.
      </p>
      <Link
        href="/admin/app/carwash/catalogo"
        className="mt-3 inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
      >
        Configurar ahora
      </Link>
    </div>
  )
}
