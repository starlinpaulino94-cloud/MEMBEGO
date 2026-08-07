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
  // Onboarding v2 (Fase 4). Vacíos en el formulario clásico: el flujo legacy
  // no cambia. `flujoV2` marca que el alta entró por el asistente y activa la
  // validación estricta del vehículo en los negocios que lo exigen.
  tipoVehiculoId: z.string().trim().default(''),
  pais: z.string().trim().default(''),
  flujoV2: z.string().trim().default(''),
  // Ubicación (docs/GEOLOCALIZACION.md §4): opcional, nunca bloquea el
  // registro. El parser real está en `geo-form.ts` (leerUbicacionDeForm);
  // aquí solo se pasan como strings para que zod no las rechace.
  geoCountryId: z.string().trim().default(''),
  geoRegionId: z.string().trim().default(''),
  geoRegionName: z.string().trim().default(''),
  geoCityId: z.string().trim().default(''),
  geoCityName: z.string().trim().default(''),
  geoSectorId: z.string().trim().default(''),
  geoSectorName: z.string().trim().default(''),
  geoLat: z.string().trim().default(''),
  geoLng: z.string().trim().default(''),
  geoSource: z.string().trim().default(''),
  geoConsentHome: z.string().trim().default(''),
  geoConsentMarketing: z.string().trim().default(''),
})

export type RegistroInput = z.infer<typeof registroSchema>
