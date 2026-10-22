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
              perfil. Si verificaste tu identidad, también borramos tu resultado
              de verificación y los datos que tenga el proveedor (sección 7).
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

          {/* LA VERIFICACIÓN DE IDENTIDAD, COMPLETA.
              Los textos de los tres permisos que la persona marca antes de empezar son cortos a
              propósito y remiten a esta sección (docs/identidad/AUDITORIA-VERIFICACION-IDENTIDAD.md).
              Por eso esto tiene que decir TODO lo que el sistema hace —y nada que no haga—: el plazo
              («3 años») es el de POLITICA_IDENTIDAD, y una prueba obliga a que coincidan
              (tests/politicas-identidad.test.ts). RUTA_POLITICA_IDENTIDAD apunta al id de abajo. */}
          <div id="verificacion-identidad">
            <h2 className="text-h2 text-foreground">7. Verificación de identidad</h2>
            <p className="mt-2">
              Verificar tu identidad es <strong className="font-semibold">opcional</strong>: no hace
              falta para comprar ni para usar tus membresías, y solo pueden hacerlo personas mayores
              de 18 años. Si decides hacerlo, esto es lo que ocurre con tus datos.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.1 Qué datos se usan y para qué</h3>
            <p className="mt-2">
              Fotografías tu cédula y te tomas una selfie con una prueba de vida. A partir de esas
              imágenes se generan datos biométricos de tu rostro para compararlo con el del documento.
              Se usan únicamente para comprobar que eres el titular del documento y prevenir el fraude
              y el robo de identidad. No se usan para publicidad ni para ninguna otra cosa.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.2 Quién los procesa</h3>
            <p className="mt-2">
              Los procesa Didit, nuestro proveedor de verificación, por cuenta de MembeGo y bajo un
              contrato que le exige seguridad, secreto y borrado. Didit procesa los datos en la Unión
              Europea, es decir, fuera de la República Dominicana, y por eso te pedimos un permiso
              específico para esa transferencia.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.3 Qué conservamos y por cuánto tiempo</h3>
            <p className="mt-2">
              Didit elimina las imágenes y los datos biométricos al concluir la verificación. MembeGo
              conserva solo el resultado: si estás verificado, el nivel y la fecha, junto con una
              referencia cifrada a la sesión y un código que permite detectar que un mismo documento
              no se use en dos cuentas (con ese código no se puede recuperar tu número de cédula).
              Conservamos el resultado durante 3 años, hasta que debas volver a verificarte, o hasta
              que nos pidas borrarlo, lo que ocurra primero.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.4 Quién ve el resultado</h3>
            <p className="mt-2">
              El resultado lo guarda y lo controla MembeGo. Los negocios donde eres cliente solo ven
              que estás verificado y desde cuándo, y únicamente si tú lo permites. Nunca ven tu cédula,
              tu selfie ni tu número de documento, y ningún negocio puede descargar tus documentos.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.5 Tus permisos</h3>
            <p className="mt-2">
              Antes de empezar te pedimos tres permisos, cada uno con su casilla y ninguna marcada de
              antemano: (1) capturar tu cédula y tu selfie y generar los datos biométricos, (2) que
              Didit los procese en la Unión Europea y (3), opcional, que los negocios vean que estás
              verificado. Puedes retirar cualquiera cuando quieras desde la pantalla de verificación de
              tu perfil. Si retiras el primero, se cancela la verificación en curso.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.6 Borrar tus datos de verificación</h3>
            <p className="mt-2">
              Puedes pedir que borremos tus datos de verificación en cualquier momento desde la
              pantalla de verificación de tu perfil. Primero se borran en Didit y, cuando lo confirma,
              en MembeGo. Si eliminas tu cuenta, tus datos de verificación también se borran, en
              MembeGo y en Didit.
            </p>

            <h3 className="mt-5 text-base font-semibold text-foreground">7.7 Si no se puede verificar</h3>
            <p className="mt-2">
              Si la verificación no se completa, te lo decimos y, cuando es posible, cómo intentarlo
              de nuevo. En algunos casos, por seguridad, no detallamos el motivo. Si crees que el
              resultado es un error, cuéntanoslo desde tu perfil o en{' '}
              <a href="mailto:contacto@membego.com" className="text-primary hover:underline">
                contacto@membego.com
              </a>{' '}
              y lo revisa una persona.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
