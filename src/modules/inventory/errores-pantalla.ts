import 'server-only'
import { clasificarErrorPrisma } from '@/lib/prisma-errors'

/**
 * COMMERCE CORE · inventario — qué decirle a la persona cuando una pantalla NO
 * pudo cargar.
 *
 * Una pantalla nueva que lee tablas nuevas, desplegada ANTES de aplicar su
 * migración en Supabase, revienta con `P2021`/`P2022`. Eso es lo que
 * `docs/MIGRACIONES.md` describe como el fallo recurrente, y el mensaje genérico
 * («intenta de nuevo») manda a la persona a insistir en algo que no se arregla
 * solo. Aquí se distingue: si es el esquema, se dice QUÉ falta y quién lo arregla.
 */
export function describirFalloDeCarga(contexto: string, e: unknown): string {
  console.error(`[${contexto}]`, e)
  if (clasificarErrorPrisma(e).tipo === 'SCHEMA_DRIFT') {
    return 'Esta función necesita una actualización de la base de datos que todavía no se ha aplicado. Avisa a quien administra la plataforma: no se arregla reintentando.'
  }
  return 'No se pudo cargar. Intenta de nuevo en un momento.'
}
