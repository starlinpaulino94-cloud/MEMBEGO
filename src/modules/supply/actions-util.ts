import 'server-only'

import { revalidatePath } from 'next/cache'
import type { AuditAccion, Prisma } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { getRequestMeta } from '@/lib/server-utils'
import { anotarFallo } from '@/lib/prisma-errors'
import { getUser } from '@/lib/auth'

/**
 * MEMBEGO SUPPLY · lo que comparten todas las server actions del módulo.
 *
 * Bitácora, refresco de rutas, conversión de errores y lectura de formularios.
 * Vive aparte porque las actions se reparten en tres archivos (`actions.ts`,
 * `actions-finanzas.ts`, `actions-ventas.ts`) y un archivo `'use server'` solo
 * puede exportar funciones asíncronas: los helpers síncronos no caben ahí.
 */

export interface EstadoAccion {
  error?: string
  success?: string
  /** Id de lo recién creado, para que la pantalla pueda navegar. */
  id?: string
}

/**
 * Escribe en la bitácora. `antes`/`despues` van en el payload cuando la acción
 * cambia un estado (§26 del encargo): quien la lea seis meses después tiene
 * que poder ver de dónde a dónde, no solo que «cambió».
 */
export async function auditar(
  accion: AuditAccion,
  entidadTipo: string,
  entidadId: string,
  payload: Prisma.InputJsonValue,
  companyId?: string | null
): Promise<void> {
  const user = await getUser()
  const meta = await getRequestMeta()
  await sinEmpresa('Membego Supply: bitácora de una acción de plataforma', (tx) =>
    tx.auditLog.create({
      data: {
        companyId: companyId ?? null,
        userId: user?.metadata.dbUserId ?? null,
        accion,
        entidadTipo,
        entidadId,
        payload,
        ...meta,
      },
    })
  ).catch(anotarFallo('supply:auditLog.create'))
}

export function refrescarPlataforma(sufijo = ''): void {
  revalidatePath('/superadmin/supply')
  if (sufijo) revalidatePath(`/superadmin/supply/${sufijo}`)
}

/** Convierte cualquier fallo en un mensaje que se puede enseñar. */
export function comoError(e: unknown): EstadoAccion {
  return { error: e instanceof Error ? e.message : 'No se pudo completar la operación.' }
}

export function texto(fd: FormData, clave: string, max = 500): string {
  return String(fd.get(clave) ?? '').trim().slice(0, max)
}

export function numero(fd: FormData, clave: string): number | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function fecha(fd: FormData, clave: string): Date | null {
  const v = String(fd.get(clave) ?? '').trim()
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Fin de día para un `<input type="date">`: «hasta el 30» incluye el 30. */
export function fechaFinDeDia(fd: FormData, clave: string): Date | null {
  const d = fecha(fd, clave)
  if (!d) return null
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/** Rutas o referencias de documentos, una por línea. */
export function documentos(fd: FormData, clave = 'documentos'): string[] {
  return texto(fd, clave, 4000)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20)
}

/** User-agent recortado, para guardar el dispositivo (§12). */
export async function dispositivoActual(): Promise<string | null> {
  const meta = await getRequestMeta()
  return meta.userAgent?.slice(0, 200) ?? null
}
