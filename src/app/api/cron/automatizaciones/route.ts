import { NextResponse, type NextRequest } from 'next/server'
import { ejecutarAutomatizacionesGlobal } from '@/modules/admin/automatizaciones'
import { mantenimientoRegalos } from '@/modules/regalos/mantenimiento'
import { recordatoriosSeguimientoAuto } from '@/modules/seguimiento/mantenimiento'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * F4.7: endpoint de cron para ejecutar las automatizaciones de todas las
 * empresas (cumpleaños, por vencer, inactivos). Idempotente.
 * Regalos P2P · R4: además expira los regalos vencidos y recuerda al
 * destinatario los que expiran en menos de 24h.
 *
 * Protegido con CRON_SECRET: configura la variable en el entorno y llama
 * con `Authorization: Bearer <CRON_SECRET>` (Vercel Cron, GitHub Actions,
 * cron-job.org, etc.), idealmente una vez al día.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET no configurado en el servidor.' },
      { status: 503 }
    )
  }

  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  try {
    // El cron ya NO ejecuta las automatizaciones: solo las REPARTE, una por
    // empresa, a la cola (auditoría · C-06). Por eso aquí no hay totales de
    // cumpleaños ni de vencimientos — cada empresa los produce en su propia
    // invocación. Lo que sí se devuelve es cuántas se encolaron, que es el
    // número que delata si algo dejó de repartirse.
    const reparto = await ejecutarAutomatizacionesGlobal()
    const regalos = await mantenimientoRegalos().catch((e) => {
      console.error('[cron-automatizaciones] regalos', e)
      return { expirados: 0, recordatorios: 0 }
    })
    // Seguimiento S3: recuerda a los clientes sus recompensas gratis por vencer.
    const seguimiento = await recordatoriosSeguimientoAuto().catch((e) => {
      console.error('[cron-automatizaciones] seguimiento', e)
      return { recordatorios: 0 }
    })
    // Integraciones: reintenta los webhooks pendientes hacia los sistemas
    // satélite. Va aquí (y no en un cron propio) porque el plan de Vercel
    // limita la cantidad de crons; el primer intento de cada evento es
    // inmediato — esto solo barre los que fallaron.
    const { reintentarPendientes } = await import('@/modules/integraciones/despacho')
    const integraciones = await reintentarPendientes().catch((e) => {
      console.error('[cron-automatizaciones] integraciones', e)
      return { enviados: 0, fallidos: 0 }
    })
    return NextResponse.json({
      ok: true,
      reparto,
      regalos,
      seguimiento,
      integraciones,
    })
  } catch (e) {
    console.error('[cron-automatizaciones]', e)
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 })
  }
}
