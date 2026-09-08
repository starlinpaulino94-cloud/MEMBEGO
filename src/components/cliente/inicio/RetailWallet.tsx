import Link from 'next/link'
import { AlertCircle, ArrowRight, Trophy, WalletCards } from 'lucide-react'
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="retail-wallet" className="text-h2 text-foreground">
              Mis membresías
            </h2>
            <p className="mt-0.5 text-small text-muted-foreground">
              Toca una tarjeta para mostrar su QR.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
            <div className="rounded-lg border border-border bg-muted p-4">
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
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="flex items-center gap-2 text-small font-semibold text-foreground">
                <WalletCards className="size-4 shrink-0 text-primary" aria-hidden />
                Tu wallet está lista
              </p>
              <p className="mt-1 text-caption text-muted-foreground">
                Cuando actives tu primera membresía, su QR vivirá aquí para usarlo en el mostrador.
              </p>
              <Link
                href={primerPaso.href}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-5 text-label-lg text-primary-foreground outline-none transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
              >
                {primerPaso.etiqueta}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          ) : (
            <WalletStack items={[...wallet]} />
          )}
        </div>
      </div>
    </section>
  )
}
