import { NextResponse, type NextRequest } from 'next/server'
import { autorizarCron } from '@/lib/cron-auth'
import { barridoEntregasDePago } from '@/modules/pagos/barrido-entregas'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CRON DE ENTREGAS DE PAGO (pago con tarjeta → comprobante · fase 5).
 *
 * La red de seguridad de un cobro con tarjeta aprobado: reintenta la entrega de los clientes que pagaron y no recibieron,
 * repara los comprobantes que faltan de cobros ya entregados y avisa a los administradores de lo que sigue sin resolverse.
 * Ver `modules/pagos/barrido-entregas.ts`. Ninguna parte recobra dinero y todo es idempotente: correrlo dos veces seguidas no
 * duplica reintentos, comprobantes ni avisos.
 *
 * Protegido con CRON_SECRET (`autorizarCron`, igual que el resto). Programado a diario en vercel.json porque el plan solo
 * admite crons diarios; si el plan permite más frecuencia, basta subirla ahí: el barrido respeta su espaciado entre
 * reintentos y su aviso es uno por empresa y día.
 */
export async function GET(req: NextRequest) {
  const denegado = autorizarCron(req)
  if (denegado) return denegado
  try {
    const resumen = await barridoEntregasDePago()
    return NextResponse.json({ ok: true, ...resumen })
  } catch (e) {
    console.error('[cron-entregas-pago]', e)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}
