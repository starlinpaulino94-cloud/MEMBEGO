import { CelebracionBienvenida } from '@/components/cliente/CelebracionBienvenida'
import { OnboardingClienteFirstVisit } from '@/components/cliente/OnboardingClienteFirstVisit'
import { PopupInteligente } from '@/components/engagement/PopupInteligente'
import type { PanelPersonal } from '@/modules/cliente/panelPersonal'
import type { InicioVista } from '@/modules/home/vista'
import { InicioComercial } from './InicioComercial'
import { VibeReferidos } from './VibeReferidos'
import { VibeMembresiasActivas } from './VibeMembresiasActivas'

/**
 * EL INICIO DEL CLIENTE — rediseño violeta enriquecido (Stitch «amazon style»):
 * Acceso rápido a membresías activas, héroe, categorías, novedades con chips
 * de promociones activas, empresas en scroll horizontal, membresías recomendadas,
 * relámpago con timer y el banner de referidos al cierre.
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
    // En móvil la columna se centra a ancho de teléfono grande; en escritorio
    // ocupa todo el `main` (las rejillas interiores suben de columnas).
    <div className="retail -mx-4 -my-4 min-w-0 overflow-x-hidden bg-vibe-fondo pb-8 pt-4 text-foreground lg:-mx-6">
      {/* Felicitación por encima de la app tras registrarse. */}
      <CelebracionBienvenida />

      {/* El motor de experiencias habla SOLO por el popup (máx. 1 al día). */}
      {!personal.walletError && personal.engagement.popups ? (
        <PopupInteligente candidato={personal.popup} color={personal.engagement.color} />
      ) : null}

      <div className="mx-auto w-full max-w-md md:max-w-xl lg:max-w-7xl">
        {/* Widget superior compacto si tiene membresías activas */}
        {/* {!personal.walletError && personal.wallet.length > 0 ? (
          <VibeMembresiasActivas wallet={personal.wallet} />
        ) : null} */}

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
