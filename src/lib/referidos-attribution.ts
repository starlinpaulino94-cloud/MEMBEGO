import { cookies } from 'next/headers'
import { sinEmpresa, conEmpresa } from '@/lib/tenant'
import { emitirEventoEstrategia } from '@/modules/estrategias/eventos'
import { logReferralEvent, hashIp, REF_COOKIE, VISITOR_COOKIE } from '@/lib/referidos'
import { incrementarProgresoCampana } from '@/modules/invitaciones/motorProgreso'

/**
 * Atribución de referidos al momento del registro (por contraseña u OAuth).
 * Extraído a un módulo compartido para que el registro clásico y el alta por
 * Google usen exactamente la misma lógica anti-fraude y de puntos.
 */

/**
 * Anti-fraude: ¿esta huella de IP ya generó registros para este referente en
 * los últimos 7 días? Si sí, el evento se marca sospechoso y no suma puntos
 * (el vínculo se crea igual para que el admin pueda auditarlo).
 */
async function esRegistroSospechoso(
  referenteClienteId: string,
  ipHashValor: string | null,
  visitorId: string | null,
  tipo: 'REGISTRO' | 'REGISTRO_GLOBAL'
): Promise<boolean> {
  try {
    const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // (a) Un segundo registro desde la MISMA huella de red en 7 días ya es
    // sospechoso: patrón típico de autoreferido (mismo dispositivo creando
    // varias cuentas con el propio enlace).
    if (ipHashValor) {
      const repetidosIp = await sinEmpresa('anti-fraude-ip', (tx) =>
        tx.referralEvent.count({
          where: {
            clienteId: referenteClienteId,
            tipo,
            createdAt: { gte: hace7d },
            meta: { path: ['ipHash'], equals: ipHashValor },
          },
        })
      )
      if (repetidosIp >= 1) return true
    }

    // (b) Fase E6: el MISMO visitante (cookie de atribución) registrando más
    // de una cuenta en 30 días = duplicidad de cuentas, para cualquier
    // referente. Detecta granjas de cuentas aunque roten la red.
    if (visitorId) {
      const repetidosVisitante = await sinEmpresa('anti-fraude-visitor', (tx) =>
        tx.referralEvent.count({
          where: {
            tipo: { in: ['REGISTRO', 'REGISTRO_GLOBAL'] },
            visitorId,
            createdAt: { gte: hace30d },
          },
        })
      )
      if (repetidosVisitante >= 1) return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Fase E6 · Embudo: la landing de registro cargada con atribución es una
 * etapa medible (entre el clic anónimo y la cuenta creada). Dedup: un evento
 * por visitante/referente cada 24 h para no inflar con recargas. Nunca lanza.
 */
export async function registrarRegistroIniciado(refCode: string | null | undefined) {
  try {
    if (!refCode) return
    const cookieStore = await cookies()
    const visitorId = cookieStore.get(VISITOR_COOKIE)?.value ?? null
    if (!visitorId) return // sin visitante rastreable no hay etapa que medir

    const referente = await sinEmpresa('reg-iniciado-lookup', (tx) =>
      tx.cliente.findUnique({
        where: { codigoReferido: refCode },
        select: { id: true, companyId: true },
      })
    )
    if (!referente) return

    const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const yaRegistrado = await sinEmpresa('reg-iniciado-dedup', (tx) =>
      tx.referralEvent.findFirst({
        where: {
          clienteId: referente.id,
          tipo: 'REGISTRO_INICIADO',
          visitorId,
          createdAt: { gte: hace24h },
        },
        select: { id: true },
      })
    )
    if (yaRegistrado) return

    await logReferralEvent({
      clienteId: referente.id,
      companyId: referente.companyId,
      tipo: 'REGISTRO_INICIADO',
      visitorId,
    })
  } catch (e) {
    console.error('[referidos] registrarRegistroIniciado error:', e)
  }
}

/**
 * Fase E6 · Embudo: correo verificado. Se dispara desde el callback de
 * confirmación; marca la etapa VERIFICADO de cada vínculo de referido de la
 * persona (una sola vez por referido). Nunca lanza.
 */
export async function registrarVerificacionReferido(supabaseId: string) {
  try {
    const referidos = await sinEmpresa('verif-referido-lookup', (tx) =>
      tx.referido.findMany({
        where: { referidoCliente: { supabaseId } },
        select: {
          referidoClienteId: true,
          referenteClienteId: true,
          companyId: true,
          sospechoso: true,
        },
      })
    )
    for (const r of referidos) {
      const ya = await sinEmpresa('verif-referido-dedup', (tx) =>
        tx.referralEvent.findFirst({
          where: { tipo: 'VERIFICADO', referidoClienteId: r.referidoClienteId },
          select: { id: true },
        })
      )
      if (ya) continue
      await logReferralEvent({
        clienteId: r.referenteClienteId,
        companyId: r.companyId,
        tipo: 'VERIFICADO',
        referidoClienteId: r.referidoClienteId,
        ...(r.sospechoso ? { puntos: 0 } : {}),
      })
    }
  } catch (e) {
    console.error('[referidos] registrarVerificacionReferido error:', e)
  }
}

/**
 * Atribuye el registro a un referente. El código puede venir del formulario
 * (?ref= de la empresa) o de la cookie del Centro global MembeGo (/r/CODE).
 * - Misma empresa: crea el Referido + evento REGISTRO.
 * - Otra empresa de la plataforma: evento REGISTRO_GLOBAL (puntos MembeGo).
 * Nunca lanza: la atribución jamás rompe el registro.
 *
 * `permitirCookie: false` para afiliaciones de usuarios EXISTENTES: la cookie
 * silenciosa (30 días) solo debe atribuir cuentas realmente nuevas; una cuenta
 * vieja uniéndose a otra empresa solo cuenta si llegó con ?ref explícito.
 */
export async function vincularReferido(
  refCode: string,
  companyId: string,
  referidoClienteId: string,
  ipAddress: string | null,
  opts?: {
    permitirCookie?: boolean
    visitorId?: string | null
    /** Campaña "Invita y Gana" que originó el registro (si aplica). */
    campanaInvitacionId?: string
  }
) {
  try {
    let code = refCode
    let viaCookie = false
    if (!code && (opts?.permitirCookie ?? true)) {
      const cookieStore = await cookies()
      code = cookieStore.get(REF_COOKIE)?.value ?? ''
      viaCookie = !!code
    }
    if (!code) return

    // Fase E6: visitante anónimo sembrado en el clic — une el recorrido
    // clic → registro → conversión de esta persona. El llamador puede pasarlo
    // explícitamente (más fiable a través del redirect); si no, se lee de la
    // cookie. La atribución explícita evita depender del timing de la cookie.
    let visitorId: string | null = opts?.visitorId ?? null
    if (!visitorId) {
      try {
        const cookieStore = await cookies()
        visitorId = cookieStore.get(VISITOR_COOKIE)?.value ?? null
      } catch { /* fuera de request scope */ }
    }

    // El código puede ser el corto (/r/XXXXXX y campañas "Invita y Gana",
    // ?ref=codigoCorto) o el largo (codigoReferido) — mismo criterio que
    // el resolvedor de /r/[code].
    const referente = await sinEmpresa('vincular-lookup-referente', (tx) =>
      tx.cliente.findFirst({
        where: {
          OR: [{ codigoCorto: code.toUpperCase() }, { codigoReferido: code }],
        },
      })
    )
    if (!referente) return

    // Anti-abuso: nadie puede referirse a sí mismo. La comparación es por
    // PERSONA (supabaseId), no por fila de Cliente: la ficha es por empresa y
    // comparar ids dejaba pasar el autoreferido hacia otra empresa o con la
    // cookie puesta al probar el propio enlace.
    if (referente.id === referidoClienteId) return
    const referidoCliente = await sinEmpresa('vincular-lookup-referido', (tx) =>
      tx.cliente.findUnique({
        where: { id: referidoClienteId },
        select: { supabaseId: true, nombre: true },
      })
    )
    if (!referidoCliente) return
    if (referidoCliente.supabaseId === referente.supabaseId) return

    const huella = hashIp(ipAddress)

    if (referente.companyId === companyId) {
      // Programa de la empresa (+ campaña "Invita y Gana" si aplica).
      const campanaId = opts?.campanaInvitacionId ?? null
      const sospechoso = await esRegistroSospechoso(referente.id, huella, visitorId, 'REGISTRO')
      await conEmpresa(companyId, (tx) =>
        tx.referido.create({
          data: {
            companyId,
            referenteClienteId: referente.id,
            referidoClienteId,
            sospechoso,
            ...(campanaId ? { campanaInvitacionId: campanaId } : {}),
          },
        })
      )
      await logReferralEvent({
        clienteId: referente.id,
        companyId,
        tipo: 'REGISTRO',
        visitorId,
        referidoClienteId,
        meta: {
          ipHash: huella,
          ...(viaCookie ? { viaCookie: true } : {}),
          ...(sospechoso ? { sospechoso: true } : {}),
          ...(campanaId ? { campanaInvitacionId: campanaId } : {}),
        },
        ...(sospechoso ? { puntos: 0 } : {}),
      })
      // Fase E6: el fraude también es un EVENTO auditable, no solo un flag.
      if (sospechoso) {
        await logReferralEvent({
          clienteId: referente.id,
          companyId,
          tipo: 'FRAUDE',
          visitorId,
          referidoClienteId,
          meta: { motivo: 'registro_con_huella_repetida', ipHash: huella },
        })
      }

      if (!sospechoso) {
        await emitirEventoEstrategia({
          companyId,
          type: 'referido.invitado_registrado',
          subjectId: referente.id,
          payload: {
            cliente: { nombre: referente.nombre },
            invitado: { nombre: referidoCliente.nombre, clienteId: referidoClienteId },
            referido: { codigo: code },
          },
        })

        if (campanaId) {
          await incrementarProgresoCampana(campanaId, referente.id, companyId, referidoClienteId)
        }
      }
      return
    }

    // Centro global MembeGo: el referido se unió a OTRA empresa.
    const sospechoso = await esRegistroSospechoso(referente.id, huella, visitorId, 'REGISTRO_GLOBAL')
    await logReferralEvent({
      clienteId: referente.id,
      companyId: referente.companyId,
      tipo: 'REGISTRO_GLOBAL',
      visitorId,
      referidoClienteId,
      meta: {
        global: true,
        targetCompanyId: companyId,
        referidoClienteId,
        ipHash: huella,
        ...(viaCookie ? { viaCookie: true } : {}),
        ...(sospechoso ? { sospechoso: true } : {}),
      },
      ...(sospechoso ? { puntos: 0 } : {}),
    })
  } catch (e) {
    console.error('[referidos] vincularReferido error:', e)
  }
}
