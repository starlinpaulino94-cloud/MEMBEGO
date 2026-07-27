import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { crearNotificacion, notificarAdmins } from '@/modules/notificaciones/service'
import { ACTION_TYPES } from '@/lib/rule-engine'
import type { ActionSink, AutomationEngine, AutomationRepository } from '@/lib/automation'

/**
 * LiveActionSink: handlers REALES del Action Engine para las estrategias
 * instaladas. Sustituye al RecordingActionSink cuando las automatizaciones
 * corren en la app en vivo:
 *
 *  - send_push / notificaciones     → campana in-app del cliente (Notificacion)
 *  - send_internal_notification    → alerta a los admins de la empresa
 *  - send_email                    → correo real (Resend) al cliente
 *  - apply_benefit                 → benefit_grant del Benefit Engine (si la
 *                                    empresa tiene el beneficio por código)
 *  - record_event / create_event / → registro en automation_events (auditoría
 *    record_history / create_log     y métricas)
 *  - run_workflow                  → ejecuta otra automatización publicada de
 *                                    la empresa (por templateKey)
 *
 * Los canales aún no integrados (whatsapp, sms, webhook…) y las acciones de
 * otros motores no cableados NO fallan: se registran como intención
 * (`simulated: true`) en la auditoría del run, para que ninguna estrategia
 * rompa un flujo en vivo. Sin 'use server': solo invocable desde servidor.
 */
export class LiveActionSink implements ActionSink {
  private engine: AutomationEngine | null = null
  private repo: AutomationRepository | null = null

  /** Enlaza el motor tras crearlo (run_workflow lo necesita; evita el ciclo). */
  bindEngine(engine: AutomationEngine, repo: AutomationRepository): void {
    this.engine = engine
    this.repo = repo
  }

  async run(input: {
    companyId: string
    subjectId: string | null
    type: string
    params: Record<string, unknown>
  }): Promise<{ ok: boolean; detail?: unknown }> {
    try {
      switch (input.type) {
        case ACTION_TYPES.SEND_PUSH:
          return await this.notificarCliente(input)
        case ACTION_TYPES.SEND_INTERNAL_NOTIFICATION:
          return await this.notificarEquipo(input)
        case ACTION_TYPES.SEND_EMAIL:
          return await this.enviarEmail(input)
        case ACTION_TYPES.APPLY_BENEFIT:
          return await this.otorgarBeneficio(input)
        case ACTION_TYPES.RECORD_EVENT:
        case ACTION_TYPES.CREATE_EVENT:
        case ACTION_TYPES.RECORD_HISTORY:
        case ACTION_TYPES.CREATE_LOG:
        case ACTION_TYPES.SAVE_EVIDENCE:
          return await this.registrarEvento(input)
        case ACTION_TYPES.RUN_WORKFLOW:
          return await this.ejecutarWorkflow(input)
        default:
          // Canal/motor aún no cableado: intención registrada, nunca rompe.
          return { ok: true, detail: { simulated: true, type: input.type } }
      }
    } catch (e) {
      console.error(`[estrategias] acción ${input.type} falló`, e)
      return { ok: false, detail: { error: String(e) } }
    }
  }

  /** subjectId es el id de la ficha Cliente → usuario de la campana in-app. */
  private async usuarioDeCliente(subjectId: string | null) {
    if (!subjectId) return null
    const cliente = await prisma.cliente.findUnique({
      where: { id: subjectId },
      select: { supabaseId: true, email: true, nombre: true },
    })
    if (!cliente) return null
    const user = await prisma.user.findUnique({
      where: { supabaseId: cliente.supabaseId },
      select: { id: true },
    })
    return { userId: user?.id ?? null, email: cliente.email, nombre: cliente.nombre }
  }

  private async notificarCliente(input: {
    companyId: string
    subjectId: string | null
    params: Record<string, unknown>
  }) {
    const destino = await this.usuarioDeCliente(input.subjectId)
    if (!destino?.userId) {
      return { ok: false, detail: { error: 'Cliente sin usuario para notificar.' } }
    }
    await crearNotificacion({
      userId: destino.userId,
      tipo: 'SISTEMA',
      titulo: String(input.params.title ?? 'Novedad para ti'),
      mensaje: String(input.params.body ?? ''),
      href: typeof input.params.href === 'string' ? input.params.href : undefined,
    })
    return { ok: true, detail: { channel: 'inapp', userId: destino.userId } }
  }

  private async notificarEquipo(input: {
    companyId: string
    params: Record<string, unknown>
  }) {
    await notificarAdmins(input.companyId, {
      tipo: 'SISTEMA',
      titulo: String(input.params.title ?? 'Aviso de estrategia'),
      mensaje: String(input.params.body ?? ''),
    })
    return { ok: true, detail: { channel: 'admins' } }
  }

  private async enviarEmail(input: {
    companyId: string
    subjectId: string | null
    params: Record<string, unknown>
  }) {
    const destino = await this.usuarioDeCliente(input.subjectId)
    if (!destino?.email) {
      return { ok: false, detail: { error: 'Cliente sin email.' } }
    }
    const asunto = String(input.params.subject ?? 'Novedades')
    const cuerpo = String(input.params.body ?? '')
    // companyId para que `sendEmail` corte el envío si la empresa es de
    // demostración: una automatización de práctica no puede escribirle a nadie.
    const res = await sendEmail({
      to: destino.email,
      subject: asunto,
      text: cuerpo,
      companyId: input.companyId,
    })
    return { ok: res.sent, detail: { channel: 'email', to: destino.email, sent: res.sent } }
  }

  /**
   * Otorga un beneficio del Benefit Engine por código. Si la empresa aún no
   * tiene ese beneficio creado, queda como intención (no rompe la estrategia).
   */
  private async otorgarBeneficio(input: {
    companyId: string
    subjectId: string | null
    params: Record<string, unknown>
  }) {
    const code = String(input.params.benefitCode ?? '').trim()
    if (!code || !input.subjectId) {
      return { ok: true, detail: { simulated: true, reason: 'sin código o sin sujeto' } }
    }
    const benefit = await prisma.benefit.findFirst({
      where: { companyId: input.companyId, code },
      select: { id: true, nombre: true },
    })
    if (!benefit) {
      return { ok: true, detail: { simulated: true, reason: `beneficio ${code} no existe en la empresa` } }
    }
    const dias = Number(input.params.expiresInDays ?? 0)
    const grant = await prisma.benefitGrant.create({
      data: {
        companyId: input.companyId,
        benefitId: benefit.id,
        subscriberId: input.subjectId,
        subscriberKind: 'CLIENT',
        sourceModule: 'automation',
        expiresAt: dias > 0 ? new Date(Date.now() + dias * 86_400_000) : null,
      },
      select: { id: true },
    })
    return { ok: true, detail: { grantId: grant.id, benefit: benefit.nombre } }
  }

  private async registrarEvento(input: {
    companyId: string
    subjectId: string | null
    type: string
    params: Record<string, unknown>
  }) {
    const tipo = String(input.params.event ?? input.type)
    await prisma.automationEvent.create({
      data: {
        companyId: input.companyId,
        type: tipo,
        subjectId: input.subjectId,
        payload: input.params as object,
        source: 'action_engine',
        processed: true,
      },
    })
    return { ok: true, detail: { event: tipo } }
  }

  /** Ejecuta otra automatización PUBLICADA de la empresa (campañas hijas). */
  private async ejecutarWorkflow(input: {
    companyId: string
    subjectId: string | null
    params: Record<string, unknown>
  }) {
    if (!this.engine || !this.repo) {
      return { ok: true, detail: { simulated: true, reason: 'motor no enlazado' } }
    }
    const key = String(input.params.workflow ?? '').trim()
    if (!key) return { ok: true, detail: { simulated: true, reason: 'sin workflow' } }

    const todas = await this.repo.listAutomations(input.companyId, { status: 'PUBLISHED' })
    const objetivo = todas.find((a) => a.templateKey === key)
    if (!objetivo) {
      return { ok: true, detail: { simulated: true, reason: `workflow ${key} no instalado/publicado` } }
    }
    const triggerData =
      input.params.triggerData && typeof input.params.triggerData === 'object'
        ? (input.params.triggerData as Record<string, unknown>)
        : {}
    const outcome = await this.engine.run(objetivo, {
      subjectId: input.subjectId,
      triggeredBy: 'workflow',
      triggerData,
    })
    return { ok: true, detail: { workflow: key, runStatus: outcome.run.status } }
  }
}
