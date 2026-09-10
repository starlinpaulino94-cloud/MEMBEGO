import Link from 'next/link'
import Image from 'next/image'
import {
  Megaphone,
  CalendarDays,
  Newspaper,
  BadgeCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RetailSeccionHeader, RetailSeccionPie } from '@/components/cliente/inicio/RetailSeccion'
import type { NovedadInicio } from '@/modules/social/queries'

/**
 * NOVEDADES DEL INICIO — filas densas del contrato Stitch.
 *
 * La versión anterior era un carrusel de tarjetas con degradado por categoría
 * (naranja para promos, violeta para eventos) y un CTA blanco por tarjeta:
 * llamativo, pero de otro idioma. La receta que manda es la de «Experiencias
 * y Excursiones» del Inicio de Stitch: fila con miniatura de 88px y el tipo
 * en pastilla oscura, sobretítulo de la EMPRESA en mayúsculas, título de una
 * línea, bajada gris, y la fila de dato (descuento, fecha) con la píldora
 * clara de acción a la derecha.
 *
 * La fila entera es el enlace; la píldora es visual, no un botón anidado.
 * Las promociones traen su arte real; los posts no tienen imagen y llevan la
 * tesela con el icono del tipo — mismo esqueleto, sin fingir fotos.
 */

interface TipoMeta {
  label: string
  icon: LucideIcon
  cta: string
}

const TIPO_META: Record<string, TipoMeta> = {
  PROMOCION: { label: 'Promoción', icon: Megaphone, cta: 'Ver oferta' },
  EVENTO: { label: 'Evento', icon: CalendarDays, cta: 'Ver evento' },
  NOTICIA: { label: 'Noticia', icon: Newspaper, cta: 'Leer más' },
  BENEFICIO: { label: 'Beneficio', icon: BadgeCheck, cta: 'Ver beneficio' },
}

function fmtFecha(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: 'numeric',
    month: 'short',
  }).format(new Date(d))
}

function fmtFechaHora(d: Date) {
  return new Intl.DateTimeFormat('es-DO', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(d))
}

/** La línea de dato de cada tipo: lo que decide, no relleno. */
function Dato({ n }: { n: NovedadInicio }) {
  if (n.tipo === 'PROMOCION') {
    return (
      <span className="min-w-0 truncate">
        {n.descuento ? (
          <span className="text-price-sm tabular-nums text-primary">{n.descuento}</span>
        ) : null}
        {n.vence ? (
          <span className="text-caption">
            {n.descuento ? ' · ' : ''}hasta el {fmtFecha(n.vence)}
          </span>
        ) : null}
      </span>
    )
  }
  if (n.tipo === 'EVENTO') {
    return (
      <span className="min-w-0 truncate text-label-md font-semibold text-foreground">
        {fmtFechaHora(n.fecha)}
      </span>
    )
  }
  return <span className="min-w-0 truncate text-caption">Publicada el {fmtFecha(n.fecha)}</span>
}

export function FeedNovedades({ novedades }: { novedades: NovedadInicio[] }) {
  if (novedades.length === 0) return null

  return (
    <div>
      <RetailSeccionHeader
        id="retail-novedades"
        titulo="Novedades de tus empresas"
        bajada="Lo último de los negocios que sigues"
        enlace={{ href: '/cliente/promociones', texto: 'Ver todas' }}
      />

      <ul className="mt-3 flex flex-col gap-2.5">
        {novedades.map((n) => {
          const meta = TIPO_META[n.tipo] ?? TIPO_META.NOTICIA
          const Icon = meta.icon
          return (
            <li key={`${n.tipo}-${n.id}`}>
              <Link
                href={n.href}
                className="flex items-center gap-3 rounded-lg bg-card p-2.5 elevation-1 outline-none transition-colors duration-fast hover:bg-brand-primary-soft/40 focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.99]"
              >
                <span className="relative size-22 shrink-0 overflow-hidden rounded-lg">
                  {n.imagenUrl ? (
                    <Image
                      src={n.imagenUrl}
                      alt=""
                      fill
                      sizes="88px"
                      className="object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-full items-center justify-center bg-brand-primary-soft"
                    >
                      <Icon className="size-7 text-primary" />
                    </span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-foreground/80 px-1.5 py-0.5 text-label-sm font-semibold leading-none text-background">
                    {meta.label}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-overline text-retail-deep">
                    {n.companyName}
                  </span>
                  <span className="mt-0.5 block truncate text-h4 text-foreground">
                    {n.titulo}
                  </span>
                  {n.resumen ? (
                    <span className="block truncate text-caption">{n.resumen}</span>
                  ) : null}
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <Dato n={n} />
                    <span className="shrink-0 rounded-full bg-brand-primary-soft px-3.5 py-1.5 text-label-md font-semibold text-primary">
                      {meta.cta}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      <RetailSeccionPie href="/cliente/promociones">Ver todas las novedades</RetailSeccionPie>
    </div>
  )
}
