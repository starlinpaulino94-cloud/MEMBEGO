/**
 * Catálogo Universal de Acciones (Fase 3).
 *
 * Declara —como DATOS— todos los tipos de acción que el sistema soportará,
 * agrupados por categoría. NO contiene lógica de negocio: solo identificadores,
 * categoría y descripción. Sirve para la futura UI (constructor de reglas),
 * para validar configuraciones y como contrato estable de claves `tipo`.
 *
 * Las fases siguientes implementarán los ActionHandler de estos tipos y los
 * registrarán; añadir un tipo nuevo aquí NO obliga a tocar el motor.
 */

export type ActionCategory =
  | 'BENEFICIOS'
  | 'DESCUENTOS'
  | 'CREDITOS'
  | 'PUNTOS'
  | 'MEMBRESIAS'
  | 'CUPONES'
  | 'QR'
  | 'NOTIFICACIONES'
  | 'AUDITORIA'
  | 'AUTOMATIZACION'

export interface ActionDefinition {
  /** Clave estable usada en RuleAction.tipo y en el ActionRegistry. */
  readonly id: string
  readonly category: ActionCategory
  readonly description: string
}

/** Claves de acción como constantes tipadas (evita strings sueltos). */
export const ACTION_TYPES = {
  // Beneficios
  APPLY_BENEFIT: 'apply_benefit',
  REMOVE_BENEFIT: 'remove_benefit',
  UPDATE_BENEFIT: 'update_benefit',
  SUSPEND_BENEFIT: 'suspend_benefit',
  ACTIVATE_BENEFIT: 'activate_benefit',
  // Descuentos
  APPLY_DISCOUNT_PERCENT: 'apply_discount_percent',
  APPLY_DISCOUNT_FIXED: 'apply_discount_fixed',
  APPLY_DISCOUNT_CATEGORY: 'apply_discount_category',
  APPLY_DISCOUNT_PRODUCT: 'apply_discount_product',
  // Créditos
  ADD_CREDITS: 'add_credits',
  CONSUME_CREDITS: 'consume_credits',
  TRANSFER_CREDITS: 'transfer_credits',
  EXPIRE_CREDITS: 'expire_credits',
  // Puntos
  ADD_POINTS: 'add_points',
  CONSUME_POINTS: 'consume_points',
  REVERT_POINTS: 'revert_points',
  TRANSFER_POINTS: 'transfer_points',
  // Membresías
  ACTIVATE_MEMBERSHIP: 'activate_membership',
  RENEW_MEMBERSHIP: 'renew_membership',
  SUSPEND_MEMBERSHIP: 'suspend_membership',
  FREEZE_MEMBERSHIP: 'freeze_membership',
  CANCEL_MEMBERSHIP: 'cancel_membership',
  UPDATE_MEMBERSHIP_LEVEL: 'update_membership_level',
  // Cupones
  CREATE_COUPON: 'create_coupon',
  ACTIVATE_COUPON: 'activate_coupon',
  DEACTIVATE_COUPON: 'deactivate_coupon',
  CONSUME_COUPON: 'consume_coupon',
  EXPIRE_COUPON: 'expire_coupon',
  // QR
  ACTIVATE_QR: 'activate_qr',
  INVALIDATE_QR: 'invalidate_qr',
  REGENERATE_QR: 'regenerate_qr',
  REGISTER_QR_USE: 'register_qr_use',
  BLOCK_QR: 'block_qr',
  // Notificaciones
  SEND_EMAIL: 'send_email',
  SEND_PUSH: 'send_push',
  SEND_SMS: 'send_sms',
  SEND_WHATSAPP: 'send_whatsapp',
  SEND_MESSENGER: 'send_messenger',
  SEND_INSTAGRAM: 'send_instagram',
  SEND_INTERNAL_NOTIFICATION: 'send_internal_notification',
  SEND_WEBHOOK: 'send_webhook',
  // Auditoría
  RECORD_EVENT: 'record_event',
  RECORD_HISTORY: 'record_history',
  CREATE_LOG: 'create_log',
  SAVE_EVIDENCE: 'save_evidence',
  // Automatización
  RUN_WORKFLOW: 'run_workflow',
  SCHEDULE_TASK: 'schedule_task',
  CREATE_EVENT: 'create_event',
  INVOKE_MODULE: 'invoke_module',
} as const

export type ActionTypeKey = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES]

/** Definiciones completas del catálogo, agrupables por categoría. */
export const ACTION_CATALOG: readonly ActionDefinition[] = [
  // Beneficios
  { id: ACTION_TYPES.APPLY_BENEFIT, category: 'BENEFICIOS', description: 'Aplicar un beneficio.' },
  { id: ACTION_TYPES.REMOVE_BENEFIT, category: 'BENEFICIOS', description: 'Eliminar un beneficio.' },
  { id: ACTION_TYPES.UPDATE_BENEFIT, category: 'BENEFICIOS', description: 'Actualizar un beneficio.' },
  { id: ACTION_TYPES.SUSPEND_BENEFIT, category: 'BENEFICIOS', description: 'Suspender un beneficio.' },
  { id: ACTION_TYPES.ACTIVATE_BENEFIT, category: 'BENEFICIOS', description: 'Activar un beneficio.' },
  // Descuentos
  { id: ACTION_TYPES.APPLY_DISCOUNT_PERCENT, category: 'DESCUENTOS', description: 'Descuento porcentual.' },
  { id: ACTION_TYPES.APPLY_DISCOUNT_FIXED, category: 'DESCUENTOS', description: 'Descuento fijo.' },
  { id: ACTION_TYPES.APPLY_DISCOUNT_CATEGORY, category: 'DESCUENTOS', description: 'Descuento por categoría.' },
  { id: ACTION_TYPES.APPLY_DISCOUNT_PRODUCT, category: 'DESCUENTOS', description: 'Descuento por producto.' },
  // Créditos
  { id: ACTION_TYPES.ADD_CREDITS, category: 'CREDITOS', description: 'Agregar créditos.' },
  { id: ACTION_TYPES.CONSUME_CREDITS, category: 'CREDITOS', description: 'Consumir créditos.' },
  { id: ACTION_TYPES.TRANSFER_CREDITS, category: 'CREDITOS', description: 'Transferir créditos.' },
  { id: ACTION_TYPES.EXPIRE_CREDITS, category: 'CREDITOS', description: 'Expirar créditos.' },
  // Puntos
  { id: ACTION_TYPES.ADD_POINTS, category: 'PUNTOS', description: 'Agregar puntos.' },
  { id: ACTION_TYPES.CONSUME_POINTS, category: 'PUNTOS', description: 'Consumir puntos.' },
  { id: ACTION_TYPES.REVERT_POINTS, category: 'PUNTOS', description: 'Revertir puntos.' },
  { id: ACTION_TYPES.TRANSFER_POINTS, category: 'PUNTOS', description: 'Transferir puntos.' },
  // Membresías
  { id: ACTION_TYPES.ACTIVATE_MEMBERSHIP, category: 'MEMBRESIAS', description: 'Activar membresía.' },
  { id: ACTION_TYPES.RENEW_MEMBERSHIP, category: 'MEMBRESIAS', description: 'Renovar membresía.' },
  { id: ACTION_TYPES.SUSPEND_MEMBERSHIP, category: 'MEMBRESIAS', description: 'Suspender membresía.' },
  { id: ACTION_TYPES.FREEZE_MEMBERSHIP, category: 'MEMBRESIAS', description: 'Congelar membresía.' },
  { id: ACTION_TYPES.CANCEL_MEMBERSHIP, category: 'MEMBRESIAS', description: 'Cancelar membresía.' },
  { id: ACTION_TYPES.UPDATE_MEMBERSHIP_LEVEL, category: 'MEMBRESIAS', description: 'Actualizar nivel de membresía.' },
  // Cupones
  { id: ACTION_TYPES.CREATE_COUPON, category: 'CUPONES', description: 'Crear cupón.' },
  { id: ACTION_TYPES.ACTIVATE_COUPON, category: 'CUPONES', description: 'Activar cupón.' },
  { id: ACTION_TYPES.DEACTIVATE_COUPON, category: 'CUPONES', description: 'Desactivar cupón.' },
  { id: ACTION_TYPES.CONSUME_COUPON, category: 'CUPONES', description: 'Consumir cupón.' },
  { id: ACTION_TYPES.EXPIRE_COUPON, category: 'CUPONES', description: 'Expirar cupón.' },
  // QR
  { id: ACTION_TYPES.ACTIVATE_QR, category: 'QR', description: 'Activar QR.' },
  { id: ACTION_TYPES.INVALIDATE_QR, category: 'QR', description: 'Invalidar QR.' },
  { id: ACTION_TYPES.REGENERATE_QR, category: 'QR', description: 'Regenerar QR.' },
  { id: ACTION_TYPES.REGISTER_QR_USE, category: 'QR', description: 'Registrar uso de QR.' },
  { id: ACTION_TYPES.BLOCK_QR, category: 'QR', description: 'Bloquear QR.' },
  // Notificaciones
  { id: ACTION_TYPES.SEND_EMAIL, category: 'NOTIFICACIONES', description: 'Enviar correo.' },
  { id: ACTION_TYPES.SEND_PUSH, category: 'NOTIFICACIONES', description: 'Enviar push.' },
  { id: ACTION_TYPES.SEND_SMS, category: 'NOTIFICACIONES', description: 'Enviar SMS (arquitectura).' },
  { id: ACTION_TYPES.SEND_WHATSAPP, category: 'NOTIFICACIONES', description: 'Enviar WhatsApp (requiere el conector conectado). Con `template` (nombre de plantilla aprobada) y `templateParams` vale fuera de la ventana de 24 h; con `body`, solo dentro.' },
  { id: ACTION_TYPES.SEND_MESSENGER, category: 'NOTIFICACIONES', description: 'Responder por Messenger en la conversación abierta (`conversacionId`, p. ej. {{mensaje.conversacionId}}); solo dentro de las 24 h.' },
  { id: ACTION_TYPES.SEND_INSTAGRAM, category: 'NOTIFICACIONES', description: 'Responder por Instagram en la conversación abierta (`conversacionId`); solo dentro de las 24 h.' },
  { id: ACTION_TYPES.SEND_INTERNAL_NOTIFICATION, category: 'NOTIFICACIONES', description: 'Notificación interna.' },
  { id: ACTION_TYPES.SEND_WEBHOOK, category: 'NOTIFICACIONES', description: 'Avisar a tus webhooks suscritos.' },
  // Auditoría
  { id: ACTION_TYPES.RECORD_EVENT, category: 'AUDITORIA', description: 'Registrar evento.' },
  { id: ACTION_TYPES.RECORD_HISTORY, category: 'AUDITORIA', description: 'Registrar historial.' },
  { id: ACTION_TYPES.CREATE_LOG, category: 'AUDITORIA', description: 'Crear log.' },
  { id: ACTION_TYPES.SAVE_EVIDENCE, category: 'AUDITORIA', description: 'Guardar evidencia.' },
  // Automatización
  { id: ACTION_TYPES.RUN_WORKFLOW, category: 'AUTOMATIZACION', description: 'Ejecutar workflow.' },
  { id: ACTION_TYPES.SCHEDULE_TASK, category: 'AUTOMATIZACION', description: 'Programar tarea.' },
  { id: ACTION_TYPES.CREATE_EVENT, category: 'AUTOMATIZACION', description: 'Crear evento.' },
  { id: ACTION_TYPES.INVOKE_MODULE, category: 'AUTOMATIZACION', description: 'Invocar otro módulo.' },
]

const CATALOG_BY_ID = new Map(ACTION_CATALOG.map((d) => [d.id, d]))

/** Devuelve la definición de un tipo de acción del catálogo, o undefined. */
export function getActionDefinition(id: string): ActionDefinition | undefined {
  return CATALOG_BY_ID.get(id)
}

/** ¿El tipo pertenece al catálogo universal? (los tipos custom no). */
export function isCatalogAction(id: string): boolean {
  return CATALOG_BY_ID.has(id)
}

/** Lista las acciones de una categoría. */
export function actionsByCategory(category: ActionCategory): ActionDefinition[] {
  return ACTION_CATALOG.filter((d) => d.category === category)
}
