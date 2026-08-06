import * as z from 'zod'

const montoCaja = z.preprocess(
  (v) => {
    const s = String(v ?? '').trim()
    if (!s) return undefined
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  },
  z
    .number('Indica un monto mayor que cero.')
    .positive('Indica un monto mayor que cero.')
)

const montoParte = z.preprocess(
  (v) => {
    const s = String(v ?? '').trim()
    if (!s) return 0
    const n = Number(s)
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
  },
  z.number()
)

const opcionalTexto = z
  .string()
  .trim()
  .transform((v) => v || null)

export const abrirCajaSchema = z.object({
  sucursalId: z.string().trim().min(1, 'Selecciona la sucursal.'),
  balanceInicial: z.preprocess(
    (v) => {
      const s = String(v ?? '').trim()
      if (!s) return 0
      const n = Number(s)
      return Number.isFinite(n) ? n : 0
    },
    z.number().min(0, 'El balance inicial no puede ser negativo.')
  ),
  turno: opcionalTexto,
})

export const cerrarCajaSchema = z.object({
  cajaSesionId: z.string().trim().min(1, 'Sesión no especificada.'),
  balanceFinal: z.preprocess(
    (v) => {
      const s = String(v ?? '').trim()
      if (!s) return undefined
      const n = Number(s)
      return Number.isFinite(n) ? n : undefined
    },
    z
      .number('Indica el efectivo contado al cerrar.')
      .min(0, 'Indica el efectivo contado al cerrar.')
  ),
  observaciones: opcionalTexto,
})

export const movimientoCajaSchema = z.object({
  cajaSesionId: z.string().trim().min(1, 'Sesión no especificada.'),
  tipo: z.enum(['ENTRADA', 'SALIDA'], 'Tipo de movimiento no válido.'),
  monto: montoCaja,
  concepto: z.string().trim().min(1, 'Describe el concepto del movimiento.'),
})

export const cobrarOrdenSchema = z.object({
  cajaSesionId: z.string().trim().min(1, 'Datos incompletos.'),
  ordenId: z.string().trim().min(1, 'Datos incompletos.'),
  ordenTipo: z.enum(['MEMBRESIA', 'PROMOCION'], 'Tipo de orden no válido.'),
  metodoCobro: z.enum(
    ['EFECTIVO', 'TRANSFERENCIA', 'OTRO', 'MIXTO'],
    'Selecciona la forma de pago.'
  ),
  observaciones: opcionalTexto,
  montoEfectivo: montoParte,
  montoTransferencia: montoParte,
})
