import { CelebracionBienvenida } from '@/components/cliente/CelebracionBienvenida'
import { OnboardingClienteFirstVisit } from '@/components/cliente/OnboardingClienteFirstVisit'
import { PopupInteligente } from '@/components/engagement/PopupInteligente'
import { PruebaSocial } from '@/components/engagement/PruebaSocial'
import type { PanelPersonal } from '@/modules/cliente/panelPersonal'
import type { InicioVista } from '@/modules/home/vista'
import { InicioComercial } from './InicioComercial'
import { RetailDescubreMas } from './RetailDescubreMas'
import { RetailExperiencia } from './RetailExperiencia'
import { RetailOfertas } from './RetailOfertas'
import { RetailWallet } from './RetailWallet'

/**
 * EL INICIO DEL CLIENTE — una sola pantalla, dos mitades con dueños distintos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA ANTES (D10)
 *
 * Existían DOS inicios. El retail solo aparecía si la empresa había publicado
 * composición; el resto del tiempo se veía la pantalla anterior íntegra, con
 * su cabecera saturada, su buscador duplicado y sus degradados. Es decir: el
 * rediseño casi nunca se veía, y las seis capacidades que solo vivían allí
 * —wallet, motor de experiencias, prueba social, gamificación, onboarding y
 * novedades— eran la razón de no poder borrarla.
 *
 * Ahora hay un solo Inicio, siempre retail, con dos mitades:
 *
 *   COMERCIAL — la compone y publica la empresa (los 7 bloques de F2a/F2b).
 *               Si no hay composición publicada, su sitio lo ocupan las
 *               ofertas personalizadas: nadie se queda sin nada que descubrir,
 *               y cuando sí la hay no se repite el mismo contenido dos veces.
 *
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
  comercial: InicioVista | null
  personal: PanelPersonal
}) {
  const tieneMembresias = !personal.walletError && personal.wallet.length > 0

  const mitadComercial = comercial ? (
    <InicioComercial data={comercial} />
  ) : personal.hayOfertas ? (
    <RetailOfertas feed={personal.ofertas} />
  ) : null

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

      {/* El aviso #2 del motor: el #1 ya es la experiencia protagonista. */}
      {!personal.walletError && personal.engagement.popups ? (
        <PopupInteligente candidato={personal.popup} color={personal.engagement.color} />
      ) : null}

      {personal.experiencia ? <RetailExperiencia exp={personal.experiencia} /> : null}

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

      {personal.pruebaSocial && personal.engagement.pruebaSocial ? (
        <section className="bg-background px-4 py-5 md:px-6 md:py-6" aria-label="Actividad de la comunidad">
          <div className="mx-auto max-w-6xl">
            <PruebaSocial data={personal.pruebaSocial} color={personal.engagement.color} />
          </div>
        </section>
      ) : null}

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
          mostrarInvitaYGana={personal.experiencia?.tipo !== 'REFERIDOS'}
        />
      ) : null}
    </div>
  )
}
