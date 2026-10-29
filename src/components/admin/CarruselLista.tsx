'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ImageIcon, Pencil, Pin } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { ORIGEN_BANNER_INFO, MAX_CARRUSEL, DIAS_NOVEDAD } from '@/modules/home/banner-formatos'
import { ajustarPieza, moverFijada, type FilaDeCarruselVista } from '@/modules/home/banners-acciones'

const CAMPO =
  'h-9 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20'

const MOTIVO: Record<NonNullable<FilaDeCarruselVista['motivoFuera']>, string> = {
  OCULTO: 'Oculta por ti',
  VENCIDO: 'Ya venció',
  ANTIGUO: `Más de ${DIAS_NOVEDAD} días: fíjala para mantenerla`,
  LLENO: `Hay más de ${MAX_CARRUSEL} más recientes`,
}

const fecha = (iso: string) => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium' }).format(new Date(iso))

function haceCuanto(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 30) return `Hace ${dias} días`
  return fecha(iso)
}

/**
 * LA LISTA DEL CARRUSEL. Cada fila es una pieza que la empresa publicó; las
 * decisiones (plantilla, fijar, ocultar, subir o bajar lo fijado) las toma el
 * servidor, que las vuelve a comprobar: ocultar un botón no es seguridad.
 */
export function CarruselLista({ filas }: { filas: FilaDeCarruselVista[] }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; error: string }>, exito?: string) {
    empezar(async () => {
      const r = await accion()
      if (!r.ok) toast.error(r.error)
      else {
        if (exito) toast.success(exito)
        router.refresh()
      }
    })
  }

  if (filas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Todavía no hay nada publicado. Cuando publiques una promoción, un producto o servicio, una oferta o un plan, aparecerá aquí y en el inicio de tus clientes.
      </div>
    )
  }

  const fijadas = filas.filter((f) => f.fijado)

  return (
    <ul className="space-y-3" aria-label="Piezas del carrusel">
      {filas.map((f) => {
        const posicionFijada = fijadas.findIndex((x) => x.clave === f.clave)
        return (
          <li
            key={f.clave}
            className={cn(
              'grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl border bg-card p-4 md:grid-cols-[64px_minmax(0,1fr)_200px_auto]',
              f.fijado ? 'border-primary/40' : 'border-border',
              !f.enCarrusel && 'opacity-80'
            )}
          >
            <div className="relative h-20 w-16 overflow-hidden rounded-lg bg-muted">
              {f.imagen ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.imagen} alt="" className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center text-muted-foreground">
                  <ImageIcon className="size-5" aria-hidden />
                </span>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <p className="truncate text-label-lg font-bold text-foreground">
                {f.titulo}
                {f.precio ? <span className="ml-2 font-medium text-muted-foreground">{f.precio}</span> : null}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="info">{ORIGEN_BANNER_INFO[f.origen].nombre}</Badge>
                {f.fijado ? (
                  <Badge variant="default">
                    <Pin className="mr-1 size-3" aria-hidden />
                    Fijada
                  </Badge>
                ) : null}
                {f.enCarrusel ? (
                  <Badge variant="success">En el carrusel</Badge>
                ) : (
                  <Badge variant="outline">{f.motivoFuera ? MOTIVO[f.motivoFuera] : 'Fuera'}</Badge>
                )}
              </div>
              <p className="text-caption text-muted-foreground">
                {haceCuanto(f.publicadoEn)}
                {f.vence ? ` · vence ${fecha(f.vence)}` : ''}
              </p>
            </div>

            <div className="col-span-2 md:col-span-1">
              <label className="mb-1 block text-label-sm text-muted-foreground" htmlFor={`pl-${f.clave}`}>
                Plantilla {f.plantillaManual ? '' : '· automática'}
              </label>
              <select
                id={`pl-${f.clave}`}
                value={f.plantillaManual ? f.plantilla : ''}
                disabled={pendiente}
                onChange={(e) => ejecutar(() => ajustarPieza(f.origen, f.id, { plantilla: e.target.value || null }), 'Plantilla cambiada.')}
                className={CAMPO}
              >
                <option value="">Automática</option>
                {f.plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-span-2 flex flex-wrap items-center gap-4 md:col-span-1 md:justify-end">
              <label className="flex items-center gap-2 text-small text-foreground">
                <Switch
                  checked={f.fijado}
                  disabled={pendiente}
                  onCheckedChange={(v) => ejecutar(() => ajustarPieza(f.origen, f.id, { fijado: v }), v ? 'Fijada arriba.' : 'Ya no está fijada.')}
                  aria-label={`Fijar ${f.titulo}`}
                />
                Fijada
              </label>
              <label className="flex items-center gap-2 text-small text-foreground">
                <Switch
                  checked={!f.oculto}
                  disabled={pendiente}
                  onCheckedChange={(v) => ejecutar(() => ajustarPieza(f.origen, f.id, { oculto: !v }), v ? 'Visible.' : 'Oculta.')}
                  aria-label={`Mostrar ${f.titulo}`}
                />
                Visible en el inicio
              </label>
              <Button asChild variant="outline" size="sm">
                <Link href={f.hrefEditar} aria-label={`Editar ${f.titulo}`}>
                  <Pencil className="size-4" aria-hidden /> Editar
                </Link>
              </Button>
              {f.fijado ? (
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Subir ${f.titulo}`}
                    disabled={pendiente || posicionFijada <= 0}
                    onClick={() => ejecutar(() => moverFijada(f.origen, f.id, 'arriba'))}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Bajar ${f.titulo}`}
                    disabled={pendiente || posicionFijada < 0 || posicionFijada >= fijadas.length - 1}
                    onClick={() => ejecutar(() => moverFijada(f.origen, f.id, 'abajo'))}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                </span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
