import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { anotarFallo } from '@/lib/prisma-errors'
import { anotarConector } from '@/modules/connect/bitacora'
import { transicionSalud } from '@/modules/connect/salud-conexiones-nucleo'
import { CONCURRENCIA, antesDe, enParalelo } from '@/modules/integraciones/concurrencia'
import { credencialWhatsappViva } from '@/modules/connect/whatsapp'
import { inspeccionarToken } from '@/modules/connect/meta/salud'
import { pideReautorizar } from '@/modules/connect/meta/tokensNucleo'

/**
 * INSPECCIÓN ACTIVA vía `debug_token` para el token de sistema de WhatsApp (B-3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE APARTE DE `salud-conexiones.ts`
 *
 * Aquel chequeo es LOCAL y barato: mira `expiresAt` y `metadata`, no abre sellos
 * ni llama a nadie, y por eso puede correr a diario sobre TODAS las conexiones.
 * Esto es lo contrario —abre el token y llama a Meta por conexión—, así que se
 * mantiene separado: para que no se confundan, y para que la promesa de aquel
 * («nunca llama a un proveedor») siga siendo cierta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ CIERRA
 *
 * El token de sistema de WhatsApp se guarda SIN `expiresAt` —no vence por fecha,
 * pero SÍ se invalida si quien lo emitió pierde el acceso o se desconecta el
 * WABA—. El chequeo local no puede juzgarlo: `esTerminal` pide una fecha, y sin
 * ella la conexión se le escapa. Para saber si ese token sigue vivo hay que
 * PREGUNTARLE a Meta con `debug_token`. Es la única clase de conexión que lo
 * necesita; el resto ya se cubre con la fecha guardada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FRÁGIL Y EXTERNO: POR ESO VA ACOTADO Y NUNCA DECIDE A CIEGAS
 *
 * Cada conexión es una llamada a Meta (10 s de timeout), así que:
 *   · Solo actúa con RESPUESTA de Meta. Si la llamada falla —Meta caído, sin app
 *     configurada— NO se marca nada: un apagón de Meta no es motivo para pedirle
 *     a cada empresa que reconecte. Se reintenta mañana.
 *   · Acotado por concurrencia Y por tiempo, como los barridos: se corta antes de
 *     comerse el minuto del cron y deja el resto para la siguiente pasada. Un
 *     token invalidado no es urgente al segundo; capturarlo en uno o dos días es
 *     de sobra.
 *
 * La DECISIÓN es la misma máquina que el chequeo local (`transicionSalud` sobre
 * `pideReautorizar`): marca `reautorizarAt` para que la UI pida reconectar, y lo
 * limpia si el token volvió a estar sano. Nunca sale un secreto a la bitácora.
 */
export async function inspeccionarSaludWhatsapp(
  opciones: { limite?: number; presupuestoMs?: number } = {}
): Promise<{ inspeccionadas: number; marcadas: number; limpiadas: number; sinRespuesta: number; sinTiempo: number }> {
  const limite = opciones.limite ?? 200
  const presupuestoMs = opciones.presupuestoMs ?? 15_000
  const ahora = Date.now()

  try {
    const conexiones = await sinEmpresa(
      'connect: inspección activa de WhatsApp con debug_token (cron diario, cruza inquilinos)',
      (tx) =>
        tx.conexionEmpresa.findMany({
          where: { estado: 'CONNECTED', conector: { slug: 'whatsapp' } },
          select: { id: true, companyId: true, reautorizarAt: true },
          take: limite,
        })
    )

    let marcadas = 0
    let limpiadas = 0
    let sinRespuesta = 0

    // El margen cubre un timeout entero de Graph (10 s) más la escritura: al
    // parar, lo que ya está en vuelo termina sin que maten la función.
    const { sinEmpezar } = await enParalelo(
      conexiones,
      CONCURRENCIA,
      async (c) => {
        const cred = await credencialWhatsappViva(c.companyId).catch(() => null)
        // El sello no abrió, o la empresa tiene otra conexión de WhatsApp: no es
        // el token de ESTA fila, así que no se decide sobre ella.
        if (!cred || cred.conexionId !== c.id || !cred.token) {
          sinRespuesta++
          return
        }
        const r = await inspeccionarToken(cred.token)
        if (!r.ok) {
          // Sin respuesta fiable de Meta: no se toca el aviso. Se ve mañana.
          sinRespuesta++
          return
        }

        const necesita = pideReautorizar(r.datos, ahora)
        const accion = transicionSalud(necesita, c.reautorizarAt !== null)
        if (accion === 'nada') return

        const valor = accion === 'marcar' ? new Date() : null
        await conEmpresa(c.companyId, (tx) =>
          tx.conexionEmpresa.update({ where: { id: c.id }, data: { reautorizarAt: valor } })
        ).catch(anotarFallo('connect:salud-wa:marcar', { id: c.id }))

        if (accion === 'marcar') {
          marcadas++
          // La fecha más cercana entre token y acceso a datos, si la hay; para un
          // token de sistema invalidado no hay fecha, y el motivo lo dice.
          const vence = [r.datos.caducaAt, r.datos.accesoDatosCaducaAt]
            .filter((d): d is Date => d !== null)
            .map((d) => d.getTime())
            .sort((a, b) => a - b)[0]
          await anotarConector({
            companyId: c.companyId,
            origen: 'CONEXION',
            origenId: c.id,
            nivel: 'WARN',
            evento: 'conexion.reautorizar_proximo',
            detalle: {
              proveedor: 'whatsapp',
              motivo: r.datos.valido ? 'por_caducar' : 'token_invalido',
              venceAt: vence ? new Date(vence).toISOString() : null,
            },
          })
        } else {
          limpiadas++
          await anotarConector({
            companyId: c.companyId,
            origen: 'CONEXION',
            origenId: c.id,
            evento: 'conexion.reautorizar_resuelto',
            detalle: { proveedor: 'whatsapp' },
          })
        }
      },
      { continuar: antesDe(presupuestoMs, 12_000) }
    )

    return {
      inspeccionadas: conexiones.length - sinEmpezar,
      marcadas,
      limpiadas,
      sinRespuesta,
      sinTiempo: sinEmpezar,
    }
  } catch (e) {
    console.error('[connect] inspección activa de WhatsApp falló', e)
    return { inspeccionadas: 0, marcadas: 0, limpiadas: 0, sinRespuesta: 0, sinTiempo: 0 }
  }
}
