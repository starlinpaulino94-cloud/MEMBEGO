import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidad',
  description: 'Cómo MembeGo recopila, usa y protege tus datos personales.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-card">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-h1 text-foreground">Política de Privacidad</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Última actualización: octubre de 2026
        </p>

        <section className="mt-8 space-y-6 text-foreground leading-relaxed">
          <div>
            <h2 className="text-h2 text-foreground">1. Datos que recopilamos</h2>
            <p>
              Recopilamos los datos que nos proporcionas al registrarte (nombre,
              correo electrónico, teléfono y, en el caso de lavaderos, los datos de
              tu vehículo) y los datos de uso necesarios para operar tu membresía.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">2. Uso de los datos</h2>
            <p>
              Usamos tus datos para gestionar tu membresía, validar el uso mediante
              QR, enviarte notificaciones relacionadas con tu cuenta y mejorar el
              servicio. No vendemos tus datos personales a terceros.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">3. El código QR</h2>
            <p>
              El código QR de tu membresía contiene únicamente un identificador
              anónimo. Nunca incluye datos personales.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">4. Seguridad</h2>
            <p>
              Aplicamos medidas técnicas y organizativas para proteger tus datos,
              incluyendo autenticación segura y aislamiento de la información por
              empresa.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">Ubicación y proveedores</h2>
            <p>
              Si autorizas el acceso a la ubicación al usar «Cerca», usamos la
              ubicación de tu dispositivo para mostrar empresas cercanas. Puedes
              denegar o retirar ese permiso desde los ajustes del dispositivo.
              La app usa Supabase para autenticación y almacenamiento de datos,
              Google Maps para mostrar mapas y CardNET para procesar pagos con
              tarjeta. Estos proveedores reciben los datos necesarios para
              prestar esas funciones.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">Retención al eliminar la cuenta</h2>
            <p>
              Cuando eliminas tu cuenta, borramos tus fichas de cliente y sus
              datos operativos. Se conserva el historial de transacciones para
              mantener la contabilidad de las empresas y se desvincula de tu
              perfil.
            </p>
          </div>

          {/* DÓNDE VIVE EL NOMBRE DEL PROCESADOR.
              En la pantalla de pago el cliente ve MembeGo y nada más: meterle
              el nombre de un tercero en mitad de una compra no le aporta y le
              distrae. Pero quién custodia los datos de su tarjeta es
              exactamente el tipo de cosa que tiene derecho a saber, así que
              está escrito aquí, completo y sin adornos. */}
          {/* LAS CONDICIONES DE PAGO VIVEN AQUÍ, COMPLETAS.
              La casilla que el cliente marca al guardar su tarjeta o al activar la
              renovación automática es corta a propósito y remite a esta sección
              (decisión del dueño, 21-10-2026). Por eso esto tiene que decir TODO lo
              que el sistema hace —y nada que no haga—: las cifras (días de aviso,
              días antes del cobro, número de intentos) son las de
              `POLITICA_RENOVACION`, y una prueba obliga a que coincidan
              (`tests/politicas-pagos.test.ts`). Si cambia la política, cambia esto. */}
          <div id="pagos-con-tarjeta">
            <h2 className="text-h2 text-foreground">5. Pagos con tarjeta</h2>

            <h3 className="mt-4 text-base font-semibold text-foreground">5.1 Cómo se procesa tu tarjeta</h3>
            <p className="mt-2">
              <strong className="font-semibold">MembeGo nunca ve, recibe ni almacena
              el número completo de tu tarjeta ni el código CVV.</strong>{' '}
              Cuando pagas con tarjeta, esos datos se escriben directamente en una
              ventana segura operada por{' '}
              <strong className="font-semibold">CardNET</strong>, el procesador de pagos
              autorizado que da servicio a la banca dominicana, y viajan cifrados a
              sus servidores sin pasar por los nuestros. Cada empresa es quien te
              cobra; MembeGo opera la plataforma y CardNET procesa el pago.
            </p>
            <p className="mt-3">
              Al registrar una tarjeta, tu banco puede aplicar un cargo de
              verificación de RD$1.00 para confirmar que es tuya. Es un paso de
              seguridad del emisor, no un cobro de MembeGo.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">5.2 Guardar tu tarjeta (opcional)</h3>
            <p className="mt-2">
              Al pagar puedes marcar una casilla, que viene sin marcar, para guardar
              la tarjeta y pagar de nuevo sin escribirla. Lo que guardamos es una
              referencia cifrada —un «token»— que permite cobrar sin conocer la
              tarjeta, la marca y los últimos cuatro dígitos para que la reconozcas
              y, cuando el procesador lo entrega, el mes y el año de vencimiento,
              para avisarte antes de que venza y no intentar cobros con una tarjeta
              vencida. Con esa referencia no se puede usar tu tarjeta fuera de
              MembeGo.
            </p>
            <p className="mt-3">
              Guardar la tarjeta permite pagos que inicias tú, confirmando cada
              uno. <strong className="font-semibold">No activa la renovación
              automática</strong>: esa es una autorización distinta (5.3). Puedes
              eliminar la tarjeta cuando quieras desde tus pagos; al quitarla deja
              de usarse de inmediato, pedimos a CardNET que borre el perfil y, si
              una membresía se renovaba con ella, la renovación se desactiva.
            </p>

            <h3 id="renovacion-automatica" className="mt-5 text-base font-semibold text-foreground">
              5.3 Renovación automática
            </h3>
            <p className="mt-2">
              Es una autorización aparte, también opcional, que das desde tu
              membresía eligiendo una tarjeta guardada y aceptando el texto de la
              casilla. Al aceptarla, aceptas estas condiciones:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong className="font-semibold">Qué se cobra.</strong> El precio
                vigente del plan en el momento del cobro, a la tarjeta que elegiste.
                Cada renovación extiende tu membresía desde su fecha de vencimiento
                y reinicia los beneficios del plan.
              </li>
              <li>
                <strong className="font-semibold">Aviso previo.</strong> Siete días
                antes del vencimiento te avisamos por correo y en tu cuenta, con el
                monto y la tarjeta. Si no podemos avisarte, no cobramos.
              </li>
              <li>
                <strong className="font-semibold">Cuándo.</strong> El cobro se
                intenta desde tres días antes del vencimiento. Cobrar antes no te
                quita días: la nueva vigencia empieza cuando termina la actual.
              </li>
              <li>
                <strong className="font-semibold">Si el banco rechaza el cobro.</strong>{' '}
                Te avisamos (no se hizo ningún cargo) y volvemos a intentarlo al día
                siguiente, hasta tres intentos en total y siempre antes del
                vencimiento. Si se agotan, o si el rechazo indica que la tarjeta ya
                no sirve (vencida, reportada o inválida), desactivamos la renovación
                automática y te avisamos. Tu tarjeta sigue guardada, tu membresía
                sigue vigente hasta su vencimiento y puedes renovarla tú.
              </li>
              <li>
                <strong className="font-semibold">Nunca dos veces.</strong> Si un
                cobro queda sin respuesta del procesador, no lo repetimos hasta
                confirmar con CardNET si se realizó. Tras cada cobro recibes el
                recibo por correo.
              </li>
              <li>
                <strong className="font-semibold">Desactivarla.</strong> Cuando
                quieras, desde tu membresía o quitando la tarjeta. Los cobros se
                detienen desde ese momento; la membresía sigue vigente hasta vencer.
              </li>
              <li>
                <strong className="font-semibold">Renovaciones activadas antes de
                este registro.</strong> Siguen funcionando con estas mismas
                condiciones. Te lo recordamos en el aviso previo, y puedes
                confirmarlas o desactivarlas desde tu membresía.
              </li>
            </ul>

            <h3 className="mt-5 text-base font-semibold text-foreground">5.4 Constancia de tus autorizaciones</h3>
            <p className="mt-2">
              De cada autorización —guardar la tarjeta, renovar automáticamente—
              registramos qué aceptaste, la versión del texto que viste, la fecha y
              hora y, cuando están disponibles, la dirección IP y el navegador o
              dispositivo desde los que lo hiciste; y, si la retiras, cuándo. Esa constancia se conserva aunque
              quites la tarjeta, para poder demostrarte qué autorizaste y cuándo, y
              se elimina junto con tu cuenta según la sección 6.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">6. Tus derechos</h2>
            <p>
              Puedes solicitar el acceso o rectificación de tus datos personales
              escribiéndonos a{' '}
              <a href="mailto:contacto@membego.com" className="text-primary hover:underline">
                contacto@membego.com
              </a>
              . Para eliminar tu cuenta, inicia la solicitud en{' '}
              <a href="/eliminar-cuenta" className="text-primary hover:underline">
                membego.com/eliminar-cuenta
              </a>
              . Verificaremos que controlas el correo de la cuenta y eliminaremos
              tus fichas y datos asociados. Los registros contables que deban
              conservarse por obligación legal quedarán desvinculados de tu perfil.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
