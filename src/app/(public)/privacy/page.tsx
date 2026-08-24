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
          Última actualización: julio de 2026
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

          {/* DÓNDE VIVE EL NOMBRE DEL PROCESADOR.
              En la pantalla de pago el cliente ve MembeGo y nada más: meterle
              el nombre de un tercero en mitad de una compra no le aporta y le
              distrae. Pero quién custodia los datos de su tarjeta es
              exactamente el tipo de cosa que tiene derecho a saber, así que
              está escrito aquí, completo y sin adornos. */}
          <div>
            <h2 className="text-h2 text-foreground">5. Pagos con tarjeta</h2>
            <p>
              <strong className="font-semibold">MembeGo nunca ve, recibe ni almacena
              el número de tu tarjeta, su fecha de vencimiento ni el código CVV.</strong>{' '}
              Cuando pagas con tarjeta, esos datos se escriben directamente en una
              ventana segura operada por{' '}
              <strong className="font-semibold">CardNET</strong>, el procesador de pagos
              autorizado que da servicio a la banca dominicana, y viajan cifrados a
              sus servidores sin pasar por los nuestros.
            </p>
            <p className="mt-3">
              Lo único que guardamos es una referencia cifrada —un «token»— que
              permite cobrar el monto acordado sin conocer la tarjeta, junto con la
              marca y los últimos cuatro dígitos para que puedas reconocerla. Con
              esa referencia no se puede usar tu tarjeta fuera de MembeGo, y puedes
              eliminarla cuando quieras desde tu perfil.
            </p>
            <p className="mt-3">
              Al registrar una tarjeta, tu banco puede aplicar un cargo de
              verificación de RD$1.00 para confirmar que es tuya. Es un paso de
              seguridad del emisor, no un cobro de MembeGo.
            </p>
          </div>

          <div>
            <h2 className="text-h2 text-foreground">6. Tus derechos</h2>
            <p>
              Puedes solicitar el acceso, rectificación o eliminación de tus datos
              personales escribiéndonos a{' '}
              <a href="mailto:contacto@membego.com" className="text-primary hover:underline">
                contacto@membego.com
              </a>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
