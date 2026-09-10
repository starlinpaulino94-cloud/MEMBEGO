import { CelebracionBienvenida } from '@/components/cliente/CelebracionBienvenida'
import { OnboardingClienteFirstVisit } from '@/components/cliente/OnboardingClienteFirstVisit'
import { PopupInteligente } from '@/components/engagement/PopupInteligente'
import type { PanelPersonal } from '@/modules/cliente/panelPersonal'
import type { InicioVista } from '@/modules/home/vista'
import { InicioComercial } from './InicioComercial'
import { RetailDescubreMas } from './RetailDescubreMas'
import { RetailWallet } from './RetailWallet'

/**
 * EL INICIO DEL CLIENTE — una sola pantalla, dos mitades con dueños distintos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA MITAD COMERCIAL SIEMPRE ESTÁ (segunda corrección de D10)
 *
 * La primera versión de D10 dejó UN solo Inicio, pero la mitad comercial —los
 * siete bloques del diseño— solo aparecía si la empresa había publicado
 * composición; sin ella, su sitio lo ocupaba un carril de ofertas que era la
 * pantalla vieja con otro nombre. En una base real donde nadie ha publicado,
 * el diseño no lo veía nadie. El usuario lo vio de inmediato.
 *
 * Ahora `getInicioVista` SIEMPRE devuelve los bloques: por defecto salen del
 * marketplace (hero desde las promociones destacadas, y cada sección de su
 * consulta real), y la composición publicada los CURA en vez de habilitarlos.
 * Aquí ya no hay respaldo que elegir.
 *
 *   COMERCIAL — los 7 bloques del contrato, curados por la empresa si publicó.
 *   PERSONAL  — sale del estado de esa persona y no es configurable. Ningún
 *               panel puede apagarle la wallet a nadie.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN LO DECIDE EL CONTEXTO
 *
 * Con membresías, la app se abre por una razón concreta: enseñar el QR en el
 * mostrador. Enterrar la wallet bajo los carriles comerciales hace más lento
 * justo el gesto más frecuente, así que va primero.
 *
 * Sin membresías, la wallet no tiene nada que enseñar y lo accionable es
 * descubrir: entonces manda la mitad comercial y la wallet baja a ofrecer el
 * primer paso.
 */
export function InicioRetail({
  comercial,
  personal,
}: {
  comercial: InicioVista
  personal: PanelPersonal
}) {
  const tieneMembresias = !personal.walletError && personal.wallet.length > 0

  const mitadComercial = <InicioComercial data={comercial} />

  const mitadPersonal = (
    <RetailWallet
      wallet={personal.wallet}
      walletError={personal.walletError}
      gamificacion={personal.gamificacion}
      primerPaso={personal.primerPaso}
    />
  )

  return (
    <div className="retail min-w-0 overflow-x-hidden bg-background text-foreground">
      {/* Felicitación por encima de la app tras registrarse. */}
      <CelebracionBienvenida />

      {/* El motor de experiencias habla SOLO por el popup (máx. 1 al día).
          El héroe que lo pintaba arriba se retiró por decisión del usuario
          (2026-09-10): rompía el diseño; sus estados también viven donde se
          actúa (wallet, planes, detalle de membresía). */}
      {!personal.walletError && personal.engagement.popups ? (
        <PopupInteligente candidato={personal.popup} color={personal.engagement.color} />
      ) : null}

      {tieneMembresias ? (
        <>
          {mitadPersonal}
          {mitadComercial}
        </>
      ) : (
        <>
          {mitadComercial}
          {mitadPersonal}
        </>
      )}

      {/* La «prueba social» (EN VIVO) se retiró del Inicio por decisión del
          usuario (2026-09-09): competía con la wallet sin aportarle nada a la
          persona. Los números de comunidad viven en el perfil de cada empresa,
          donde sí son un argumento. */}

      {/* Después de la wallet: una tarjeta real le gana la primera mirada a un
          recordatorio de configuración. */}
      {personal.onboarding ? (
        <section className="bg-background px-4 pb-5 md:px-6" aria-label="Primeros pasos">
          <div className="mx-auto max-w-6xl">
            <OnboardingClienteFirstVisit onboarding={personal.onboarding} />
          </div>
        </section>
      ) : null}

      {!personal.walletError ? (
        <RetailDescubreMas
          novedades={personal.novedades}
          mostrarInvitaYGana={personal.popup?.tipo !== 'REFERIDOS'}
        />
      ) : null}
    </div>
  )
}
