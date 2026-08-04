import { cookies } from 'next/headers'
import { sinEmpresa } from '@/lib/tenant'
import { CANAL_COOKIE, sanitizarCanal } from './shared'

/**
 * Atribución de marketing · lado servidor. La cookie `mg_canal` la siembra el
 * middleware cuando el visitante llega con `?src=canal` (primer toque, 30
 * días); aquí se lee al REGISTRARSE y se guarda en la ficha del cliente.
 */

/** Canal atribuido al visitante actual (cookie), o null. */
export async function leerCanalCookie(): Promise<string | null> {
  try {
    const store = await cookies()
    return sanitizarCanal(store.get(CANAL_COOKIE)?.value)
  } catch {
    return null
  }
}

/**
 * Guarda el canal en la ficha recién creada. Prioridad: cookie del enlace
 * ?src= (más precisa: distingue campañas) > canal DECLARADO por el usuario en
 * el selector "¿Cómo nos conociste?" del registro. NUNCA lanza y tolera que
 * la columna `canalOrigen` aún no exista en la BD (migración 20260755
 * pendiente): el registro del cliente jamás se bloquea por esto.
 */
export async function capturarCanalRegistro(
  clienteId: string,
  canalDeclarado?: string | null
): Promise<void> {
  try {
    const canal = (await leerCanalCookie()) ?? sanitizarCanal(canalDeclarado)
    if (!canal) return
    await sinEmpresa('adquisicion: actualizar canal del cliente por id (empresa desconocida aquí)', (tx) =>
      tx.$executeRaw`UPDATE "clientes" SET "canalOrigen" = ${canal} WHERE "id" = ${clienteId} AND "canalOrigen" IS NULL`
    )
  } catch (e) {
    console.error('[adquisicion] capturarCanalRegistro', e)
  }
}
