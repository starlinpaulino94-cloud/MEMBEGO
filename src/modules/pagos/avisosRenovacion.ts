import 'server-only'
import { conEmpresa, sinEmpresa } from '@/lib/tenant'
import { encolarEmail } from '@/modules/jobs/emisiones'
import { anotarFallo } from '@/lib/prisma-errors'
import { appUrl } from '@/lib/site'
import { puedeCobrarToken } from '@/modules/pagos/cardnetToken'
import { tarjetaCardnetVencida } from '@/modules/pagos/cardnet-expiracion'
import {
  clavesDeAviso,
  etiquetaTarjeta,
  formatoVencimiento,
  redactarAviso,
  type DatosAviso,
  type TipoAviso,
} from '@/modules/pagos/avisosRenovacionCore'
import { armarCorreo } from '@/modules/pagos/correoAvisoRenovacion'
import {
  MARGEN_PRIMER_INTENTO_MS,
  POLITICA_RENOVACION,
  claveDeCiclo,
} from '@/modules/pagos/renovacionPolitica'

/**
 * AVISOS AL CLIENTE sobre la renovación automática: quién avisa, cuándo, y sin
 * repetirse. Los textos están en `avisosRenovacionCore.ts`.
 *
 * UN AVISO = UNA NOTIFICACIÓN EN LA APP + UN CORREO, y la notificación es el
 * reclamo. La `dedupeKey` es única por usuario: quien la inserta primero es el
 * dueño del aviso, y cualquier otra ejecución del cron —o el mismo cron al día
 * siguiente— ve que ya existe y no hace nada. Así el aviso es idempotente sin
 * una tabla nueva.
 *
 * Si el correo no se puede encolar, la notificación se RETIRA para que el
 * siguiente cron lo reintente: un aviso que dice «te escribimos» y no se envió
 * no sirve de aviso. (Un cliente sin correo recibe solo la notificación; no hay
 * a dónde escribirle.)
 */

export type ResultadoAviso = 'enviado' | 'ya_enviado' | 'sin_destino' | 'fallo'

/** Primer nombre, para el saludo. «María Pérez» → «María». */
function nombreDePila(nombre: string | null | undefined): string {
  return nombre?.trim().split(/\s+/)[0] || 'cliente'
}

/**
 * Avisa a un cliente, una sola vez por `dedupeKey`. Nunca lanza: un aviso que
 * falla no puede romper el cobro ni el cron que lo llama.
 */
export async function avisarCliente(input: {
  companyId: string
  clienteId: string
  tipo: TipoAviso
  datos: Omit<DatosAviso, 'empresa' | 'cliente'>
  dedupeKey: string
}): Promise<ResultadoAviso> {
  try {
    const destino = await conEmpresa(input.companyId, async (tx) => {
      const [cliente, company] = await Promise.all([
        tx.cliente.findUnique({
          where: { id: input.clienteId },
          select: { nombre: true, email: true, supabaseId: true },
        }),
        tx.company.findUnique({
          where: { id: input.companyId },
          select: { name: true, logoUrl: true },
        }),
      ])
      if (!cliente || !company) return null
      const user = cliente.supabaseId
        ? await tx.user.findFirst({ where: { supabaseId: cliente.supabaseId }, select: { id: true } })
        : null
      return { cliente, company, userId: user?.id ?? null }
    })
    // Sin cuenta no hay dónde dejar el reclamo, y sin reclamo no hay forma de no
    // repetir el aviso cada día. Quien guarda una tarjeta paga con sesión, así
    // que tiene cuenta; esto es el caso raro y se dice.
    if (!destino || !destino.userId) return 'sin_destino'
    const { cliente, company, userId } = destino

    const aviso = redactarAviso(input.tipo, {
      ...input.datos,
      empresa: company.name,
      cliente: nombreDePila(cliente.nombre),
    })

    const reclamo = await conEmpresa(input.companyId, (tx) =>
      tx.notificacion.createMany({
        data: [
          {
            userId,
            tipo: aviso.tipoNotificacion,
            titulo: aviso.titulo,
            mensaje: aviso.mensaje,
            href: aviso.href,
            dedupeKey: input.dedupeKey,
          },
        ],
        skipDuplicates: true,
      })
    )
    if (reclamo.count === 0) return 'ya_enviado'

    const correo = cliente.email?.trim()
    if (correo) {
      try {
        const { html, text } = armarCorreo(aviso, {
          empresa: company.name,
          logoUrl: company.logoUrl,
          urlBase: appUrl(),
        })
        await encolarEmail({
          to: correo,
          subject: aviso.asunto,
          html,
          text,
          companyId: input.companyId,
        })
      } catch (e) {
        anotarFallo('pagos:avisos:correo', { dedupeKey: input.dedupeKey })(e)
        // Se retira el reclamo: el siguiente cron lo vuelve a intentar entero.
        await conEmpresa(input.companyId, (tx) =>
          tx.notificacion.deleteMany({ where: { userId, dedupeKey: input.dedupeKey } })
        ).catch(anotarFallo('pagos:avisos:retirar-reclamo', { dedupeKey: input.dedupeKey }))
        return 'fallo'
      }
    }
    return 'enviado'
  } catch (e) {
    anotarFallo('pagos:avisos', { tipo: input.tipo, dedupeKey: input.dedupeKey })(e)
    return 'fallo'
  }
}

/**
 * ¿Consta que se avisó de ESTA renovación? Es lo que consulta el cobro cuando el
 * cliente aceptó un texto que le prometió el aviso (`exigeAvisoPrevio`).
 *
 * Mira la misma clave que `avisarCliente` reclama. LANZA si no puede comprobarlo
 * o devuelve `false`: ante la duda, no se cobra.
 */
export async function avisoPrevioRegistrado(input: {
  companyId: string
  clienteId: string
  membershipId: string
  vence: Date
}): Promise<boolean> {
  return conEmpresa(input.companyId, async (tx) => {
    const cliente = await tx.cliente.findUnique({
      where: { id: input.clienteId },
      select: { supabaseId: true },
    })
    if (!cliente?.supabaseId) return false
    const user = await tx.user.findFirst({
      where: { supabaseId: cliente.supabaseId },
      select: { id: true },
    })
    if (!user) return false
    const n = await tx.notificacion.count({
      where: {
        userId: user.id,
        dedupeKey: clavesDeAviso.renovacionProxima(input.membershipId, claveDeCiclo(input.vence)),
      },
    })
    return n > 0
  })
}

export interface ResumenAvisos {
  /** Membresías con renovación automática que vencen dentro del plazo de aviso. */
  candidatas: number
  enviados: number
  yaEnviados: number
  /** Sin cuenta donde dejar el reclamo. */
  sinDestino: number
  fallos: number
  /** No se avisó porque la renovación no podría ocurrir (pasarela apagada, precio 0…). */
  omitidas: number
}

const DIA = 24 * 60 * 60 * 1000

/**
 * AVISO PREVIO de la renovación. Lo corre el cron ANTES de cobrar.
 *
 * Avisa a quien tiene la renovación automática encendida, con una tarjeta activa
 * y un consentimiento vigente, y cuyo vencimiento cae dentro de
 * `avisoPrevioDias`. Es el cuerpo de la promesa de `renovacion-v2`.
 *
 * SOLO AVISA LO QUE VA A OCURRIR. Si la empresa no puede cobrar (pasarela
 * apagada, empresa de práctica), no se dice «se renovará»: el cobro no saldría.
 *
 * Con el vencimiento de la tarjeta (cuando se conozca) elige entre tres textos:
 * si ya estará vencida cuando toque cobrar, avisa de que NO servirá; si vence
 * antes de la renovación siguiente, lo añade al aviso normal; si no, el normal.
 */
export async function ejecutarAvisosDeRenovacion(
  limite = 500,
  /** Opcional: acota la pasada a una empresa. Por defecto, todas (es lo que hace el cron). */
  companyId?: string
): Promise<ResumenAvisos> {
  const resumen: ResumenAvisos = {
    candidatas: 0,
    enviados: 0,
    yaEnviados: 0,
    sinDestino: 0,
    fallos: 0,
    omitidas: 0,
  }
  const ahora = new Date()
  const hasta = new Date(ahora.getTime() + POLITICA_RENOVACION.avisoPrevioDias * DIA)

  const filas = await sinEmpresa(
    'pagos: el cron de avisos selecciona renovaciones próximas de todas las empresas',
    (tx) =>
      tx.membership.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          estado: 'ACTIVA',
          autoRenovar: true,
          tarjetaTokenizadaId: { not: null },
          tarjetaTokenizada: { activa: true },
          fechaVencimiento: { not: null, gt: ahora, lte: hasta },
          consentimientosPago: { some: { tipo: 'RENOVACION_AUTOMATICA', revocadoAt: null } },
        },
        select: {
          id: true,
          companyId: true,
          clienteId: true,
          fechaVencimiento: true,
          plan: { select: { nombre: true, precio: true, vigenciaDias: true } },
          tarjetaTokenizada: {
            select: {
              id: true,
              clienteId: true,
              marca: true,
              ultimos4: true,
              vencMes: true,
              vencAnio: true,
            },
          },
          consentimientosPago: {
            where: { tipo: 'RENOVACION_AUTOMATICA', revocadoAt: null },
            orderBy: { otorgadoAt: 'desc' },
            take: 1,
            select: { origen: true },
          },
        },
        orderBy: { fechaVencimiento: 'asc' },
        take: limite,
      })
  ).catch((e) => {
    anotarFallo('pagos:avisos:seleccion', {})(e)
    return []
  })

  resumen.candidatas = filas.length
  const puede = new Map<string, boolean>()

  for (const m of filas) {
    const tarjeta = m.tarjetaTokenizada
    const vence = m.fechaVencimiento
    const pesos = Number(m.plan.precio)
    if (!tarjeta || !vence || tarjeta.clienteId !== m.clienteId || !(pesos > 0)) {
      resumen.omitidas++
      continue
    }
    if (!puede.has(m.companyId)) {
      puede.set(m.companyId, await puedeCobrarToken(m.companyId).catch(() => false))
    }
    if (!puede.get(m.companyId)) {
      resumen.omitidas++
      continue
    }

    const ciclo = claveDeCiclo(vence)
    const primerCobro = new Date(vence.getTime() - MARGEN_PRIMER_INTENTO_MS)
    const cobroSiguiente = new Date(
      vence.getTime() + (m.plan.vigenciaDias ?? 30) * DIA - MARGEN_PRIMER_INTENTO_MS
    )
    const base = {
      plan: m.plan.nombre,
      monto: pesos,
      tarjeta: etiquetaTarjeta(tarjeta.marca, tarjeta.ultimos4),
      vence,
      membershipId: m.id,
      tarjetaVence: formatoVencimiento(tarjeta.vencMes, tarjeta.vencAnio),
    }

    // `tarjetaCardnetVencida` acepta la fecha contra la que se mide: aquí, el momento del primer cobro.
    const noServira = tarjetaCardnetVencida(tarjeta.vencMes, tarjeta.vencAnio, primerCobro)
    const r = noServira
      ? await avisarCliente({
          companyId: m.companyId,
          clienteId: m.clienteId,
          tipo: 'tarjeta_no_servira',
          datos: base,
          dedupeKey: clavesDeAviso.tarjetaNoServira(m.id, ciclo),
        })
      : await avisarCliente({
          companyId: m.companyId,
          clienteId: m.clienteId,
          tipo: 'renovacion_proxima',
          datos: {
            ...base,
            tarjetaVenceAntesDeLaSiguiente: tarjetaCardnetVencida(
              tarjeta.vencMes,
              tarjeta.vencAnio,
              cobroSiguiente
            ),
            heredado: m.consentimientosPago[0]?.origen === 'HEREDADO',
          },
          dedupeKey: clavesDeAviso.renovacionProxima(m.id, ciclo),
        })

    if (r === 'enviado') resumen.enviados++
    else if (r === 'ya_enviado') resumen.yaEnviados++
    else if (r === 'sin_destino') resumen.sinDestino++
    else resumen.fallos++
  }
  return resumen
}
