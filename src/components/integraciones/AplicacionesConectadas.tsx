import { ArrowUpRight, AppWindow } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AplicacionConectada } from '@/modules/integraciones/sso'

/**
 * LAS APLICACIONES DE LA EMPRESA — los sistemas satélite, con su botón de abrir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA ESTA SECCIÓN
 *
 * El único sitio donde se podían abrir era un botón en la barra superior, junto
 * al buscador y el canje rápido. Funciona cuando ya sabes que está —y no
 * funciona el primer día, que es justo cuando alguien acaba de dar de alta su
 * sistema y viene a buscarlo. Un vertical entero colgando de un botón sin
 * título en una esquina no se encuentra.
 *
 * Aquí tiene nombre, dominio visible y un destino claro. El botón de la
 * cabecera se queda: para quien entra veinte veces al día, esto sobra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PUEDE ABRIR TAMBIÉN SE ENSEÑA (a quien administra)
 *
 * Un sistema registrado que no aparece es el fallo más caro de esta
 * arquitectura: no hay error, no hay aviso, simplemente no está, y el
 * diagnóstico acaba siendo abrir la base de datos a mano —que es exactamente
 * lo que pasó dando de alta el primer satélite de excursiones—.
 *
 * Con `diagnostico`, quien administra ve la tarjeta apagada y el motivo
 * concreto: falta la habilitación, el vertical no coincide, el sistema está en
 * borrador. Al resto del equipo no se le enseña, porque es información de
 * configuración de la plataforma con la que no puede hacer nada.
 */

const MOTIVOS: Record<NonNullable<AplicacionConectada['motivo']>, string> = {
  SISTEMA_NO_ACTIVO:
    'El sistema está en borrador o suspendido. Actívalo desde el panel de plataforma.',
  VERTICAL_INCOMPATIBLE:
    'El vertical de tu empresa no coincide con el del sistema.',
  SIN_HABILITACION:
    'Registrado, pero tu empresa no lo tiene habilitado todavía.',
  HABILITACION_REVOCADA:
    'La habilitación de tu empresa está suspendida o revocada.',
  USUARIO_SIN_ACCESO:
    'Tu empresa lo tiene, pero tu cuenta no tiene acceso concedido.',
}

function Tarjeta({ app, diagnostico }: { app: AplicacionConectada; diagnostico: boolean }) {
  // El dominio sin protocolo: lo que importa de la URL es a dónde lleva, y
  // `https://` delante de cada tarjeta es ruido repetido cinco veces.
  const dominio = app.urlBase.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/50"
        >
          <AppWindow className="h-5 w-5 text-muted-foreground" />
        </span>
        {app.disponible ? (
          <ArrowUpRight
            aria-hidden
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
          />
        ) : (
          <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-caption font-medium text-muted-foreground">
            No disponible
          </span>
        )}
      </div>

      <p className="mt-4 truncate text-h3 font-semibold text-foreground">{app.nombre}</p>
      <p className="truncate text-caption text-muted-foreground">{dominio}</p>

      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
        {app.disponible
          ? 'Entra con tu cuenta de MembeGo, sin otra contraseña.'
          : diagnostico && app.motivo
            ? MOTIVOS[app.motivo]
            : 'Pide a un administrador que te dé acceso.'}
      </p>
    </>
  )

  const clases =
    'relative flex h-full flex-col rounded-xl border border-border/60 bg-card p-5 text-left elevation-1 transition-all duration-fast'

  if (!app.disponible) {
    return (
      <div className={cn(clases, 'opacity-70')} aria-disabled>
        {cuerpo}
      </div>
    )
  }

  /**
   * Enlace normal y no un formulario: abrir es una navegación, y el endpoint
   * firma el token en el servidor. `target=_blank` porque el satélite es otra
   * aplicación y MembeGo se queda abierta detrás — igual que en la cabecera.
   */
  return (
    <a
      href={`/api/integraciones/abrir/${encodeURIComponent(app.slug)}`}
      target="_blank"
      rel="noopener"
      className={cn(
        'group',
        clases,
        'outline-none hover:border-primary/40 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      {cuerpo}
    </a>
  )
}

export function AplicacionesConectadas({
  aplicaciones,
  diagnostico,
}: {
  aplicaciones: AplicacionConectada[]
  /** true para roles de administración: enseña también las que NO se pueden abrir. */
  diagnostico: boolean
}) {
  const visibles = diagnostico ? aplicaciones : aplicaciones.filter((a) => a.disponible)
  // Sin ninguna aplicación, la sección entera desaparece: un bloque vacío
  // titulado «Aplicaciones» en la empresa que no tiene ninguna solo ocupa
  // sitio por encima del catálogo, que es lo que se viene a ver.
  if (visibles.length === 0) return null

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-h2 font-semibold text-foreground">Tus aplicaciones</h2>
        <p className="text-sm text-muted-foreground">
          Los sistemas de tu vertical conectados a MembeGo. Se abren con tu misma sesión.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((app) => (
          <Tarjeta key={app.slug} app={app} diagnostico={diagnostico} />
        ))}
      </div>
    </section>
  )
}
