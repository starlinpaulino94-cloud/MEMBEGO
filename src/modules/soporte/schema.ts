import * as z from 'zod'
import { TICKET_CATEGORIAS, TICKET_ESTADOS } from '@/lib/soporte'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const orden = z.preprocess(
  (v) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n : 0
  },
  z.number()
)

export const configComunicacionSchema = z.object({
  codigoPais: z.string().min(2, 'Ingresa un código de país válido (ej: +52).'),
  numero: z.string().min(7, 'Ingresa un número de WhatsApp válido (solo dígitos).'),
  correoSoporte: z
    .string()
    .trim()
    .refine(
      (v) => !v || EMAIL_RE.test(v),
      'El correo de soporte no tiene un formato válido.'
    ),
})

export const correoPruebaSchema = z.object({
  correoSoporte: z
    .string()
    .trim()
    .refine(
      (v) => v.length > 0 && EMAIL_RE.test(v),
      'Ingresa un correo de soporte válido antes de probar.'
    ),
})

export const faqSchema = z.object({
  pregunta: z.string().trim().min(1, 'La pregunta y la respuesta son obligatorias.'),
  respuesta: z.string().trim().min(1, 'La pregunta y la respuesta son obligatorias.'),
  orden,
})

export const faqActualizarSchema = z.object({
  id: z.string().min(1, 'Datos incompletos.'),
  pregunta: z.string().trim().min(1, 'Datos incompletos.'),
  respuesta: z.string().trim().min(1, 'Datos incompletos.'),
  orden,
})

export const responderTicketSchema = z.object({
  ticketId: z.string().min(1, 'Escribe una respuesta.'),
  cuerpo: z.string().trim().min(1, 'Escribe una respuesta.'),
  nuevoEstado: z.string().trim().default(''),
})

export const notaInternaSchema = z.object({
  ticketId: z.string().min(1, 'Escribe la nota interna.'),
  cuerpo: z.string().trim().min(1, 'Escribe la nota interna.'),
})

export const cambiarEstadoTicketSchema = z.object({
  estado: z.enum(TICKET_ESTADOS, 'Estado inválido.'),
})

export const responderClienteSchema = z.object({
  ticketId: z.string().min(1, 'Escribe tu mensaje.'),
  cuerpo: z.string().trim().min(1, 'Escribe tu mensaje.'),
})

export const crearTicketSchema = z.object({
  asunto: z.string().trim().min(1, 'El asunto y la descripción son obligatorios.'),
  descripcion: z
    .string()
    .trim()
    .min(1, 'El asunto y la descripción son obligatorios.'),
  categoria: z
    .string()
    .default('OTRO')
    .transform((v) =>
      (TICKET_CATEGORIAS as readonly string[]).includes(v) ? v : 'OTRO'
    ),
  adjuntoUrl: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine(
      (v) => {
        if (!v) return true
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const prefijo = `${supabaseUrl ?? ''}/storage/v1/object/public/`
        if (!supabaseUrl) return false
        return v.startsWith(prefijo)
      },
      'El adjunto no es válido.'
    )
    .refine(
      (v) => {
        if (!v) return true
        return ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].some((ext) =>
          v.toLowerCase().split('?')[0].endsWith(ext)
        )
      },
      'Formato de adjunto no permitido.'
    ),
})
