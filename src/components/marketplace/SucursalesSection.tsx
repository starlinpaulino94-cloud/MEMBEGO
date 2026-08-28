import { MapPin, Phone, Clock, Navigation, Store } from 'lucide-react'
import type { SucursalPublic } from '@/modules/marketplace/queries'
import { estaAbierto, textoHorarioHoy, type HorarioDetallado } from '@/modules/geo/cercanos/horario'

const MAPS_DIR = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

function FichaSucursal({
  sucursal,
  destacada,
}: {
  sucursal: SucursalPublic
  destacada?: boolean
}) {
  const horario = sucursal.horarioDetallado as HorarioDetallado | null
  const abierto = estaAbierto(horario)
  const horarioHoy = textoHorarioHoy(horario)
  const localidad = [sucursal.sectorTexto, sucursal.ciudadTexto]
    .filter(Boolean)
    .join(', ')

  return (
    <div
      className={`flex h-full flex-col rounded-2xl border bg-card p-5 ${
        destacada
          ? 'border-primary/50 shadow-premium ring-1 ring-primary/20'
          : 'border-border/80 shadow-card'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            destacada ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          <Store className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-foreground">{sucursal.nombre}</h3>
          {destacada && (
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Estás viendo esta sucursal
            </p>
          )}
        </div>
        {abierto === true && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
            <Clock className="h-3 w-3" /> Abierto
          </span>
        )}
        {abierto === false && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            <Clock className="h-3 w-3" /> Cerrado
          </span>
        )}
      </div>

      {(sucursal.direccion || localidad) && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {[sucursal.direccion, localidad].filter(Boolean).join(', ')}
          </span>
        </p>
      )}

      {horarioHoy && <p className="mt-1.5 text-xs text-muted-foreground">Hoy: {horarioHoy}</p>}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {sucursal.telefono && (
          <a
            href={`tel:${sucursal.telefono.replace(/\D/g, '')}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <Phone className="h-3.5 w-3.5" /> Llamar
          </a>
        )}
        {sucursal.latitud != null && sucursal.longitud != null && (
          <a
            href={MAPS_DIR(sucursal.latitud, sucursal.longitud)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/10"
          >
            <Navigation className="h-3.5 w-3.5" /> Cómo llegar
          </a>
        )}
      </div>
    </div>
  )
}

export function SucursalesSection({
  sucursales,
  sucursalActiva,
}: {
  sucursales: SucursalPublic[]
  sucursalActiva: SucursalPublic | null
}) {
  if (sucursales.length === 0) return null
  const destacada = sucursalActiva?.id

  return (
    <section id="sucursales" className="mt-14 scroll-mt-32">
      <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        Sucursales
      </h2>
      <p className="mt-2 text-muted-foreground">
        Elige la sucursal que mejor te quede. Las ofertas y membresías se
        muestran según dónde quieras ir.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sucursales.map((s) => (
          <FichaSucursal key={s.id} sucursal={s} destacada={s.id === destacada} />
        ))}
      </div>
      {sucursales.length > 1 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {sucursalActiva
            ? 'Las ofertas de abajo se muestran solo para la sucursal resaltada.'
            : 'Selecciona una sucursal desde el mapa para ver sus ofertas específicas.'}
        </p>
      )}
    </section>
  )
}
