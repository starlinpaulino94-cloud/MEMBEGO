import 'server-only'
import type { NextResponse } from 'next/server'
import { errorApi } from '@/modules/plataforma/errores'
import { decodificarCursor, parsearLimite } from '@/modules/plataforma/paginacionNucleo'

/**
 * PAGINACIÓN por cursor — el pegamento entre la petición y Prisma (B-6).
 *
 * Lee `?limit=` y `?cursor=`, los valida con el núcleo puro, y devuelve o bien
 * un fallo listo para responder o bien las piezas que un `findMany` necesita:
 * cuántas filas pedir (una de más, para saber si hay siguiente) y desde dónde
 * seguir.
 *
 * Vive aparte del núcleo porque toca `NextResponse` y `errorApi`; la decisión
 * de qué es un límite o un cursor válido está en `paginacionNucleo`, que se
 * prueba sin nada de esto.
 */

export type LecturaPaginacion =
  | {
      ok: true
      /** Cuántas filas SE ENSEÑAN. Se piden `limite + 1` para detectar el «hay más». */
      limite: number
      /**
       * Lo que se esparce en el `findMany` para seguir desde el cursor. Vacío en
       * la primera página. `skip: 1` salta la propia fila del cursor —que ya se
       * entregó en la página anterior— para no repetirla en el borde.
       */
      cursor: { cursor: { id: string }; skip: number } | Record<string, never>
    }
  | { ok: false; fallo: NextResponse }

export function leerPaginacion(
  params: URLSearchParams,
  requestId: string
): LecturaPaginacion {
  const limite = parsearLimite(params.get('limit'))
  if (!limite.ok) {
    return {
      ok: false,
      fallo: errorApi('INVALID_REQUEST', requestId, {
        message: 'limit must be a positive integer.',
      }),
    }
  }

  const cursor = decodificarCursor(params.get('cursor'))
  if (cursor.presente && !cursor.ok) {
    return {
      ok: false,
      // Un cursor ilegible es un error del cliente, no algo que reintentar: no
      // mejora repitiéndolo. Y se dice, para que no se quede paginando el mismo
      // principio creyendo que avanza.
      fallo: errorApi('INVALID_REQUEST', requestId, {
        message: 'cursor is not a valid pagination cursor. Use the nextCursor value from a previous page.',
      }),
    }
  }

  return {
    ok: true,
    limite: limite.limite,
    cursor: cursor.presente ? { cursor: { id: cursor.id }, skip: 1 } : {},
  }
}
