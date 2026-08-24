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
