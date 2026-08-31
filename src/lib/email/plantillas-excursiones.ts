/**
 * PLANTILLAS DE CORREO del módulo de Excursiones.
 *
 * Viven aquí, y no dentro de la acción que las envía, por dos razones:
 *
 *  1. En un correo NO existen las variables CSS. Los clientes de correo no
 *     resuelven `var(--color-muted)`: hay que escribir el color literal. La
 *     auditoría de diseño ya contempla esa excepción, pero la reconoce por la
 *     RUTA del archivo (`correo|email|…`), así que una plantilla escondida en
 *     una acción de servidor contaba como deuda de la interfaz.
 *  2. Un correo es un texto que le llega a una persona. Tenerlo junto al resto
 *     de correos permite leerlos todos y ver si suenan igual.
 */

import QRCode from 'qrcode'

/** Bienvenida al cliente que un vendedor dio de alta al crear su reserva. */
export function correoBienvenidaClienteVendedor(input: {
  nombre: string
  email: string
  password: string
  urlLogin: string
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>¡Hola ${input.nombre}!</h2>
      <p>Se ha creado tu cuenta para que puedas gestionar tus reservas.</p>
      <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; margin: 24px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Usuario:</strong> ${input.email}</p>
        <p style="margin: 0;"><strong>Contraseña:</strong> ${input.password}</p>
      </div>
      <p>
        <a href="${input.urlLogin}" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Iniciar Sesión
        </a>
      </p>
      <p style="color: #666; font-size: 14px; margin-top: 24px;">
        Te recomendamos cambiar tu contraseña una vez hayas iniciado sesión por primera vez.
      </p>
    </div>
  `
}

/** Acceso al panel del vendedor — el admin le da acceso y este establece su contraseña. */
export function correoAccesoVendedor(input: {
  nombre: string
  email: string
  token: string
  urlBase: string
}): string {
  const url = `${input.urlBase}/vendedor/establecer-contrasena?token=${input.token}`
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>¡Hola ${input.nombre}!</h2>
      <p>Se te ha dado acceso al panel de vendedor de MembeGo. Desde allí podrás gestionar tus excursiones y reservas.</p>
      <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; margin: 24px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Tu usuario (email):</strong> ${input.email}</p>
        <p style="margin: 0;">Ahora solo necesitas establecer tu contraseña para acceder.</p>
      </div>
      <p>
        <a href="${url}" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Establecer mi contraseña
        </a>
      </p>
      <p style="color: #666; font-size: 14px; margin-top: 16px;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${url}" style="color: #666;">${url}</a>
      </p>
    </div>
  `
}

/** Confirmación de reserva enviada al cliente después de reservar una excursión. */
export async function correoConfirmacionReserva(input: {
  nombreCliente: string
  numeroReserva: string
  nombreExcursion: string
  fecha: string
  hora: string
  pasajeros: number
  total: string
  checkinToken: string
  urlBase: string
}): Promise<string> {
  const qrDataUri = await QRCode.toDataURL(input.checkinToken, { width: 150, margin: 2 })
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>¡Hola ${input.nombreCliente}!</h2>
      <p>Tu reserva ha sido confirmada exitosamente.</p>
      
      <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; margin: 24px 0;">
        <p style="margin: 0 0 12px 0;"><strong>Número de reserva:</strong> ${input.numeroReserva}</p>
        <p style="margin: 0 0 8px 0;"><strong>Excursión:</strong> ${input.nombreExcursion}</p>
        <p style="margin: 0 0 8px 0;"><strong>Fecha:</strong> ${input.fecha}</p>
        <p style="margin: 0 0 8px 0;"><strong>Hora:</strong> ${input.hora}</p>
        <p style="margin: 0 0 8px 0;"><strong>Pasajeros:</strong> ${input.pasajeros}</p>
        <p style="margin: 0;"><strong>Total pagado:</strong> ${input.total}</p>
      </div>

      <p style="margin: 24px 0;"><strong>Código QR para check-in:</strong></p>
      <p style="text-align: center; margin: 16px 0;">
        <img src="${qrDataUri}" alt="QR Check-in" style="max-width: 150px; height: auto;" />
      </p>
      <p style="color: #666; font-size: 14px; margin-top: 16px;">
        Presenta este código QR al llegar al punto de encuentro para completar tu check-in.
      </p>

      <p style="color: #666; font-size: 14px; margin-top: 24px;">
        Si tienes alguna pregunta sobre tu reserva, no dudes en contactarnos.
      </p>
    </div>
  `
}
