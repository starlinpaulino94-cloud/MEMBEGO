import Link from 'next/link'
import { AlertCircle, BadgeCheck, Bell, Gift, Info, XCircle } from 'lucide-react'
import type { NotifTipo } from '@prisma/client'

/**
 * LOS AVISOS DE LA PERSONA, en su propia pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL AGUJERO QUE ESTO CIERRA (lo encontró el recorrido G del Slice 9)
 *
 * El Slice 9 existía, entre otras cosas, para que confirmar un pago avisara al
 * cliente: hasta entonces no avisaba a nadie. Y el aviso se escribía —tabla
 * `notificaciones`, con su clave de deduplicación y todo— pero **el área de
 * cliente no lo mostraba en ninguna parte**.
 *
 * La campana de `CustomerShell` lleva a Novedades, que es el muro social de las
 * empresas que sigues: promociones, eventos, noticias. Eso no es lo mismo que
 * «tu compra está confirmada» o «tu beneficio vence en tres días», que son
 * cosas tuyas y no de un comercio. El `NotificationBell` desplegable sí lee
 * esta tabla, pero vive en `AppHeader`, que es la cabecera de admin y
 * superadmin: un cliente nunca la ve.
 *
 * Resultado: un aviso escrito, entregado, marcado DELIVERED… e invisible. Era
 * exactamente «marcar una funcionalidad como completada porque existe el
 * código».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ AQUÍ Y NO EN UNA PANTALLA NUEVA
 *
 * La campana ya significa «avisos» y ya tiene destino. Lo que faltaba no era
 * una ruta: era que ese destino mostrara también lo que es TUYO, y arriba,
 * antes del muro de las empresas. Añadir una quinta pestaña al dock habría
 * cambiado la navegación del rediseño por un problema que no era de
 * navegación.
 */

export interface AvisoPropio {
  id: string
  tipo: NotifTipo
  titulo: string
  mensaje: string
  href: string | null
  leida: boolean
  createdAt: Date
}

const ICONO: Partial<Record<NotifTipo, { icon: typeof Bell; cls: string }>> = {
  PAGO_APROBADO: { icon: BadgeCheck, cls: 'bg-success/10 text-success' },
  PAGO_RECHAZADO: { icon: XCircle, cls: 'bg-destructive/10 text-destructive' },
  MEMBRESIA_ACTIVADA: { icon: BadgeCheck, cls: 'bg-success/10 text-success' },
  MEMBRESIA_POR_VENCER: { icon: AlertCircle, cls: 'bg-warning/10 text-warning' },
  RECOMPENSA_REFERIDO: { icon: Gift, cls: 'bg-primary/10 text-primary' },
  PROMOCION_NUEVA: { icon: Gift, cls: 'bg-primary/10 text-primary' },
}
const POR_DEFECTO = { icon: Info, cls: 'bg-muted text-muted-foreground' }

function cuando(d: Date): string {
  const min = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const dias = Math.floor(h / 24)
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

export function MisAvisos({ avisos }: { avisos: AvisoPropio[] }) {
  if (avisos.length === 0) return null
  const sinLeer = avisos.filter((a) => !a.leida).length

  return (
    <section className="mb-6" aria-labelledby="titulo-mis-avisos" data-testid="mis-avisos">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="titulo-mis-avisos" className="text-label-lg font-semibold text-foreground">
          Tus avisos
        </h2>
        {sinLeer > 0 && (
          <span className="rounded-full bg-destructive px-2 py-0.5 text-[12px] font-bold leading-none text-white" data-testid="mis-avisos-sin-leer">
            {sinLeer} sin leer
          </span>
        )}
      </div>

      <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60 bg-card">
        {avisos.map((a) => {
          const { icon: Icon, cls } = ICONO[a.tipo] ?? POR_DEFECTO
          // Un aviso sin destino no se envuelve en un enlace: un enlace que no
          // lleva a ningún sitio es peor que ningún enlace.
          const cuerpo = (
            <div className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cls}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm ${a.leida ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground'}`}>
                    {a.titulo}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground/70">{cuando(a.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.mensaje}</p>
              </div>
            </div>
          )
          return (
            <li key={a.id} className={a.leida ? undefined : 'bg-info/5'} data-testid={`aviso-${a.id}`}>
              {a.href ? (
                <Link href={a.href} className="block transition hover:bg-muted/50">
                  {cuerpo}
                </Link>
              ) : (
                cuerpo
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
