import * as z from 'zod'

const opcionalTexto = z
  .string()
  .trim()
  .transform((v) => v || null)

export const confirmarVisitaSchema = z.object({
  membershipId: z
    .string()
    .min(1, 'No se encontró la membresía. Escanea el QR de nuevo.'),
  servicio: z
    .string()
    .trim()
    .min(1, 'Selecciona un servicio antes de confirmar.'),
  vehiculoId: opcionalTexto,
  notas: opcionalTexto,
  sucursalId: opcionalTexto,
  qrTokenId: opcionalTexto,
})
