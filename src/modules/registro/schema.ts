import * as z from 'zod'

export const registroSchema = z.object({
  companySlug: z.string(),
  nombre: z.string().trim().min(1, 'Completa todos los campos obligatorios.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Completa todos los campos obligatorios.'),
  password: z
    .string()
    .min(1, 'Completa todos los campos obligatorios.')
    .refine(
      (p) => p.length >= 6,
      'La contraseña debe tener al menos 6 caracteres.'
    ),
  telefono: z
    .string()
    .trim()
    .refine(
      (raw) => (raw.match(/\d/g)?.length ?? 0) >= 7,
      'Ingresa un número de teléfono válido.'
    ),
  terminos: z.literal('on', 'Debes aceptar los términos y la política de privacidad.'),
  refCode: z.string().trim().default(''),
  campanaId: z
    .string()
    .trim()
    .transform((v) => v || undefined),
  glCode: z.string().trim().default(''),
  canalDeclarado: z
    .string()
    .trim()
    .transform((v) => v || null),
  marca: z.string().trim().default(''),
  modelo: z.string().trim().default(''),
  anioRaw: z.string().trim().default(''),
  color: z.string().trim().default(''),
  placa: z.string().trim().default(''),
})

export type RegistroInput = z.infer<typeof registroSchema>
