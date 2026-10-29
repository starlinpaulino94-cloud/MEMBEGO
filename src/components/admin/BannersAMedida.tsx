'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ImageIcon, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { quitarBanner } from '@/modules/home/acciones'
import type { BannerMedidaVista } from '@/modules/home/banners-medida'

const DESTINO: Record<BannerMedidaVista['destinoTipo'], string> = {
  promocion: 'Promoción',
  empresa: 'Tu negocio',
  plan: 'Plan',
  excursion: 'Excursión',
  catalogo: 'Productos y servicios',
}

/**
 * LOS BANNERS A MEDIDA PUBLICADOS. Editar abre el editor en ese banner; quitar
 * lo saca del inicio (el servidor vuelve a comprobar permiso, posición y huella:
 * esconder el botón no es seguridad).
 */
export function BannersAMedida({
  banners,
  puedeEditar,
  hayBorrador,
  bloqueApagado,
}: {
  banners: BannerMedidaVista[]
  puedeEditar: boolean
  hayBorrador: boolean
  bloqueApagado: boolean
}) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()

  function quitar(b: BannerMedidaVista) {
    if (!window.confirm(`¿Quitar «${b.titulo || 'este banner'}» del inicio? Esta acción no se puede deshacer.`)) return
    empezar(async () => {
      const r = await quitarBanner(b.indice, b.huella)
      if (r.error) toast.error(r.error)
      else {
        toast.success('Banner quitado.')
        router.refresh()
      }
    })
  }

  return (
    <section className="space-y-3" aria-labelledby="banners-medida-titulo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="banners-medida-titulo" className="text-h4 text-foreground">
            Banners a medida
          </h2>
          <p className="text-small text-muted-foreground">
            Los que armaste tú, con tu imagen y tu texto. Van siempre antes que los automáticos.
          </p>
        </div>
        {puedeEditar ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/personalizacion">Crear o editar en el editor</Link>
          </Button>
        ) : null}
      </div>

      {hayBorrador ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-small text-foreground">
          Tienes cambios sin publicar en el editor. Lo que ves aquí es lo que está al aire hoy.
        </p>
      ) : null}
      {bloqueApagado ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-small text-foreground">
          El bloque de banners está apagado: tus clientes no los ven. Enciéndelo en el editor.
        </p>
      ) : null}
      {!puedeEditar ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-small text-muted-foreground">
          El editor de inicio no está activado para tu negocio, así que estos banners solo se pueden ver. Pídele a MembeGo que lo active para editarlos o quitarlos.
        </p>
      ) : null}

      {banners.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          No tienes banners a medida publicados.
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Banners a medida publicados">
          {banners.map((b) => (
            <li
              key={`${b.indice}-${b.huella}`}
              className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[64px_minmax(0,1fr)_auto]"
            >
              <div className="relative h-20 w-16 overflow-hidden rounded-lg bg-muted">
                {b.imagen ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.imagen} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-5" aria-hidden />
                  </span>
                )}
              </div>

              <div className="min-w-0 space-y-1">
                <p className="truncate text-label-lg font-bold text-foreground">{b.titulo || 'Banner solo con imagen'}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="info">{DESTINO[b.destinoTipo]}</Badge>
                  {b.hero ? (
                    <Badge variant="success">Se ve en el inicio</Badge>
                  ) : (
                    <Badge variant="outline">
                      {bloqueApagado ? 'Bloque apagado' : 'No se muestra: su destino o su imagen ya no están disponibles'}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-caption text-muted-foreground">
                  {b.subtitulo ? `${b.subtitulo} · ` : ''}Botón «{b.ctaTexto}»
                </p>
              </div>

              {puedeEditar ? (
                <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:justify-end">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/personalizacion?banner=${b.indice + 1}`} aria-label={`Editar ${b.titulo || 'banner'}`}>
                      <Pencil className="size-4" aria-hidden /> Editar
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendiente}
                    onClick={() => quitar(b)}
                    aria-label={`Quitar ${b.titulo || 'banner'}`}
                  >
                    <Trash2 className="size-4" aria-hidden /> Quitar
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
