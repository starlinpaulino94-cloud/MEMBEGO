import Link from 'next/link'
import { AlertCircle, ArrowRight, QrCode, Trophy } from 'lucide-react'
import { WalletStack } from '@/components/wallet/WalletStack'
import type { PanelPersonal } from '@/modules/cliente/panelPersonal'

/**
 * La wallet dentro del contrato retail.
 *
 * Es la única sección del Inicio que NO se puede apagar desde el panel: son
 * las membresías de esa persona. La empresa compone lo comercial de arriba y
 * de abajo; esto es suyo.
 *
 * Los puntos de gamificación viajan aquí, en la cabecera de la sección, y no
 * en la barra superior: la cabecera de la app es del buscador, la ubicación y
 * la cuenta, y meterle una insignia más era volver a la cabecera saturada que
 * el rediseño retira.
 */
export function RetailWallet({
  wallet,
  walletError,
  gamificacion,
  primerPaso,
}: {
  wallet: PanelPersonal['wallet']
  walletError: boolean
  gamificacion: PanelPersonal['gamificacion']
  primerPaso: PanelPersonal['primerPaso']
}) {
  return (
    <section className="bg-background px-4 py-5 md:px-6 md:py-6" aria-labelledby="retail-wallet">
      <div className="mx-auto max-w-6xl">
        {/* Sin `flex-wrap`: el chip de puntos vive en la línea del título
            (como en el mockup aprobado); si el espacio aprieta, el que se
            parte en dos líneas es el título, no la fila. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="retail-wallet" className="text-h2 text-foreground">
              Mis membresías
            </h2>
            <p className="mt-0.5 text-small text-muted-foreground">
              Toca una tarjeta para mostrar su QR.
            </p>
          </div>
          <div className="mt-0.5 flex shrink-0 items-center gap-2">
            {gamificacion ? (
              <Link
                href="/cliente/ruleta"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-caption font-semibold text-foreground outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Trophy className="size-4 text-primary" aria-hidden />
                {gamificacion.puntos.toLocaleString('es-DO')}
                <span className="sr-only"> puntos acumulados</span>
                <span aria-hidden> pts</span>
              </Link>
            ) : null}
            {wallet.length > 0 ? (
              <Link
                href="/mis-membresias"
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-small font-semibold text-primary outline-none transition hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                Ver todas
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          {walletError ? (
            <div className="rounded-lg border border-border bg-card p-4 elevation-1">
              <p className="flex items-center gap-2 text-small font-semibold text-foreground">
                <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
                No pudimos cargar tus membresías
              </p>
              <p className="mt-1 text-caption text-muted-foreground">
                Hubo un problema al conectar con el servidor. Intenta de nuevo en unos momentos.
              </p>
              <Link
                href="/mis-membresias"
                className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-small font-semibold text-foreground outline-none transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
              >
                Reintentar
              </Link>
            </div>
          ) : wallet.length === 0 ? (
            // Estado vacío = el banner comercial de Stitch («Canje inmediato»):
            // degradado azul→verde azulado, sobretítulo en mayúsculas, título
            // blanco y el disco con el QR. La tarjeta entera es el enlace; la
            // píldora dentro es visual. `bg-card`/`text-primary` en las piezas
            // claras: en tema oscuro siguen legibles sin blanco fijo.
            <Link
              href={primerPaso.href}
              className="flex items-center justify-between gap-3 rounded-xl bg-gradient-to-r from-retail-blue to-retail-lagoon p-4 outline-none elevation-1 transition-transform duration-fast focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.99]"
            >
              <span className="min-w-0">
                <span className="block text-overline text-retail-mist/90">Tu wallet</span>
                <span className="mt-0.5 block text-h3 text-white">
                  Activa tu primera membresía
                </span>
                <span className="mt-0.5 block text-caption text-retail-mist/85">
                  Su QR vivirá aquí para aplicar tus beneficios en caja sin trámites.
                </span>
                <span className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full bg-card px-4 text-label-md font-semibold text-primary">
                  {primerPaso.etiqueta}
                  <ArrowRight className="size-4" aria-hidden />
                </span>
              </span>
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card elevation-1"
              >
                <QrCode className="size-6 text-primary" />
              </span>
            </Link>
          ) : (
            <WalletStack items={[...wallet]} />
          )}
        </div>
      </div>
    </section>
  )
}
