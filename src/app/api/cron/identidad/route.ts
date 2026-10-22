import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { reintentarEventosPendientes } from '@/modules/identidad/eventos'
import { ejecutarMantenimientoDeIdentidad } from '@/modules/identidad/identidad'
import { reconciliarConElProveedor } from '@/modules/identidad/sincronizacion'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * CRON DE IDENTIDAD (verificación de identidad · Fases 1 y 2).
 *
 * 1. EL MANTENIMIENTO DE LA BASE (Fase 1): marca como expiradas las verificaciones cuya fecha
 *    pasó (con su asiento y refrescando lo que ven las empresas), da por abandonados los
 *    intentos que no avanzaron y cuenta cuántas verificaciones entran en la ventana de aviso
 *    de revalidación. Corre aunque la verificación esté apagada: una verificación expirada
 *    tiene que dejar de valer igual.
 * 2. LOS AVISOS PENDIENTES (Fase 2): reintenta los avisos del proveedor que no se pudieron
 *    procesar al llegar.
 * 3. LA RECONCILIACIÓN (Fase 2): pregunta al proveedor por los intentos que llevan rato sin
 *    novedad (el proveedor solo reintenta un aviso dos veces) y reintenta los borrados de
 *    sesión que quedaron pendientes. Sin el proveedor configurado, no hace nada.
 *
 * Idempotente: correrlo dos veces seguidas no duplica asientos ni cambia nada la segunda vez.
 * Lo del proveedor va después del mantenimiento y no lo tumba. Protegido con CRON_SECRET
 * (`autorizarCron`, igual que el resto). Diario en vercel.json porque el plan solo admite
 * crons diarios; entre una pasada y otra, la red de seguridad es la consulta de estado de la
 * persona (`consultarEstadoConReconciliacion`).
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  try {
    const resumen = await ejecutarMantenimientoDeIdentidad()
    // Lo del proveedor va DESPUÉS del mantenimiento y no lo tumba: si el proveedor falla, la base ya quedó al día.
    const avisos = await reintentarEventosPendientes().catch((e) => {
      console.error('[cron-identidad] avisos', e)
      return null
    })
    const reconciliacion = await reconciliarConElProveedor().catch((e) => {
      console.error('[cron-identidad] reconciliación', e)
      return null
    })
    return NextResponse.json({ ok: true, ...resumen, avisos, reconciliacion })
  } catch (e) {
    console.error('[cron-identidad]', e)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}
