import { CelebracionBienvenida } from '@/components/cliente/CelebracionBienvenida'
import { OnboardingClienteFirstVisit } from '@/components/cliente/OnboardingClienteFirstVisit'
import { PopupInteligente } from '@/components/engagement/PopupInteligente'
import type { PanelPersonal } from '@/modules/cliente/panelPersonal'
import type { InicioVista } from '@/modules/home/vista'
import { InicioComercial } from './InicioComercial'
import { VibeReferidos } from './VibeReferidos'

/**
 * EL INICIO DEL CLIENTE — rediseño violeta (Stitch «amazon style», aprobado
 * 2026-09-10). La pantalla es la vitrina comercial del diseño: héroe,
 * categorías, «Relacionado», relámpago y el banner de referidos al cierre.
 *
 * LO QUE YA NO VIVE AQUÍ (decisiones acumuladas del usuario):
 * - La WALLET: el diseño nuevo no la trae en el Inicio; vive en
 *   /mis-membresias (y la Cuenta enseña la ficha del contrato). Con ella se
 *   fue el orden condicional wallet-primero.
 * - Las NOVEDADES de empresas seguidas: tienen su pantalla en
 *   /cliente/novedades (campana de la cabecera).
 * - EN VIVO (2026-09-09) y el héroe del motor (2026-09-10): retirados; el
 *   motor de experiencias habla solo por el popup.
 *
 * El onboarding de primera visita se conserva al fondo: es condicional (una
 * cookie lo apaga) y perderlo sería perder una capacidad, no un adorno.
 */
export function InicioRetail({
  comercial,
  personal,
}: {
  comercial: InicioVista
  personal: PanelPersonal
}) {
  return (
    // Margen negativo espejo del CustomerShell (`px-4 py-4 lg:px-6`): el
    // rediseño es a sangre — el héroe se asoma por el borde y las bandas
    // pintan de lado a lado. Segunda excepción legítima junto a /cliente/cerca.
    // En escritorio la columna se centra a ancho de teléfono grande: el
    // diseño es móvil y estirarlo a 7xl lo rompería.
    <div className="retail -mx-4 -my-4 min-w-0 overflow-x-hidden bg-vibe-fondo pb-8 pt-4 text-foreground lg:-mx-6">
      {/* Felicitación por encima de la app tras registrarse. */}
      <CelebracionBienvenida />

      {/* El motor de experiencias habla SOLO por el popup (máx. 1 al día). */}
      {!personal.walletError && personal.engagement.popups ? (
        <PopupInteligente candidato={personal.popup} color={personal.engagement.color} />
      ) : null}

      <div className="mx-auto w-full max-w-md md:max-w-xl">
        <InicioComercial data={comercial} />

        {/* El banner de referidos cierra la pantalla, salvo que el popup del
            motor ya sea la invitación: la misma dos veces se lee como error. */}
        {personal.popup?.tipo !== 'REFERIDOS' ? <VibeReferidos /> : null}

        {personal.onboarding ? (
          <section className="mt-6 px-4" aria-label="Primeros pasos">
            <OnboardingClienteFirstVisit onboarding={personal.onboarding} />
          </section>
        ) : null}
      </div>
    </div>
  )
}
