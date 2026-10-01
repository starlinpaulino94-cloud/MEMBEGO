import type { Tx } from '@/lib/tenant'

/**
 * MEMBEGO SUPPLY 2.0 · QUIÉN CUENTA COMO PERSONA AUTORIZADA (§41).
 *
 * Es la otra mitad de `segregacion.ts`: aquella decide la regla, esta decide
 * sobre cuánta gente se aplica. Vive en `core/` y no en los adaptadores
 * porque la cargan las pruebas de dominio contra PostgreSQL, sin servidor
 * Next: solo importa el TIPO de la transacción, así que no arrastra nada en
 * tiempo de ejecución.
 */

/**
 * Prefijo del `supabaseId` de las cuentas SEMBRADAS para atribuir autoría en
 * los datos de demostración. No existen en Supabase Auth —el rol de la sesión
 * sale de `app_metadata`, no de la tabla `users`—, así que NO PUEDEN INICIAR
 * SESIÓN y no pueden aprobar nada. Los seeds construyen su `supabaseId` con
 * esta misma constante: contador y semilla no se pueden desincronizar.
 */
export const PREFIJO_CUENTA_SIN_LOGIN = 'demo-'

/**
 * Cuántas personas pueden REALMENTE aprobar o confirmar. De esto depende la
 * segregación de funciones: con una sola no hay a quién pasarle el trabajo.
 *
 * Descarta las cuentas sembradas que nunca podrán autenticarse. Contarlas
 * dejaba al único operador real sin poder aprobar sus propias facturas, pagos
 * y liquidaciones, y sin nadie capaz de desbloquearlo.
 */
export async function personasAutorizadasEnTx(tx: Tx): Promise<number> {
  return tx.user.count({
    where: { role: 'SUPERADMIN', supabaseId: { not: { startsWith: PREFIJO_CUENTA_SIN_LOGIN } } },
  })
}
