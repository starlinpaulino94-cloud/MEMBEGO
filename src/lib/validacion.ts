import type { ZodError } from 'zod'

export function primerErrorZod(error: ZodError): string {
  return error.issues[0]?.message ?? 'Datos inválidos.'
}
