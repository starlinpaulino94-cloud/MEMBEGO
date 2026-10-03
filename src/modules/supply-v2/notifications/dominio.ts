/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · QUÉ SE AVISA, A QUIÉN Y POR DÓNDE.
 *
 * Todo lo de este archivo es PURO: se prueba sin base de datos y sin red. Lo
 * que decide es la POLÍTICA —qué clase de aviso es, por qué canales puede
 * salir, si la persona lo ha apagado, cómo se llama su clave de deduplicación—
 * y nada de cómo se entrega.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES CLASES, Y POR QUÉ NO SE MEZCLAN (§3)
 *
 *   TRANSACCIONAL   Consecuencia directa de algo que la persona hizo o
 *                   compró: «tu pago está confirmado», «tu bono ya está».
 *                   Si esto no llega, la persona no puede usar lo que pagó.
 *   OPERATIVO       Para quien OPERA Membego: un incidente de severidad alta,
 *                   un efecto sin salida. No va a clientes.
 *   PROMOCIONAL     Para vender. Es lo único que una preferencia de marketing
 *                   puede apagar.
 *
 * Confundirlas tiene dos formas, las dos malas:
 *
 *   · Tratar el consentimiento de marketing como permiso para todo. Entonces
 *     quien se dio de baja de las promociones deja de enterarse de que su
 *     compra se confirmó. Eso no es respetar su decisión: es romperle el
 *     producto y además esconderle información que pagó por tener.
 *   · Tratar lo promocional como transaccional «porque es importante». Ese es
 *     el camino por el que un sistema de avisos acaba siendo un canal de
 *     publicidad que nadie puede apagar.
 *
 * Por eso `puedeMandarse` pregunta por la CLASE antes que por el canal, y por
 * eso un aviso transaccional por correo no mira la preferencia promocional.
 */

// ── Vocabulario ─────────────────────────────────────────────────────────────

export type ClaseDeAviso = 'TRANSACTIONAL' | 'OPERATIONAL' | 'MARKETING'

export type CanalDeAviso = 'IN_APP' | 'EMAIL' | 'WHATSAPP'

/** A quién va dirigido. Decide de qué tabla sale el destinatario. */
export type DestinatarioDeAviso = 'CLIENTE' | 'PROVEEDOR' | 'OPERACIONES'

export interface DefinicionDeAviso {
  /** El tipo de efecto en el outbox: `supply.notify.<algo>`. */
  clave: string
  clase: ClaseDeAviso
  destinatario: DestinatarioDeAviso
  /** Por qué canales PUEDE salir. La preferencia decide por cuáles sale. */
  canales: readonly CanalDeAviso[]
  /** Para el panel y los informes. */
  etiqueta: string
}

/**
 * LOS AVISOS QUE ESTE BLOQUE SABE MANDAR (§4).
 *
 * La lista está corta a propósito. §4 pide «no crear veinte eventos solo por
 * completar una lista» y tiene razón: cada aviso que existe es un aviso que
 * alguien tiene que leer, y un sistema que manda de todo entrena a la gente a
 * ignorarlo. Están los que cambian lo que la persona puede HACER —su compra
 * está pagada, su bono está disponible, su membresía se activó o se va a
 * vencer— y los que hacen que un operador llegue a tiempo.
 *
 * Lo que NO está, y por qué:
 *
 *   · «recompensa disponible» y «beneficio próximo a vencer» salen del mismo
 *     par de disparadores que la membresía (`BENEFIT_EXPIRING`), así que no
 *     necesitan un tipo de aviso aparte.
 *   · «liquidación creada» no está: el proveedor ya lo ve en su portal y un
 *     correo por cada liquidación es ruido. «Liquidación PAGADA» sí, porque
 *     eso es dinero que llegó.
 */
export const AVISOS: Readonly<Record<string, DefinicionDeAviso>> = {
  // ── Cliente ──
  'supply.notify.order_paid': {
    clave: 'supply.notify.order_paid',
    clase: 'TRANSACTIONAL',
    destinatario: 'CLIENTE',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Pago confirmado',
  },
  'supply.notify.benefit_available': {
    clave: 'supply.notify.benefit_available',
    clase: 'TRANSACTIONAL',
    destinatario: 'CLIENTE',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Beneficio disponible',
  },
  'supply.notify.membership_active': {
    clave: 'supply.notify.membership_active',
    clase: 'TRANSACTIONAL',
    destinatario: 'CLIENTE',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Membresía activada',
  },
  'supply.notify.membership_expiring': {
    clave: 'supply.notify.membership_expiring',
    clase: 'TRANSACTIONAL',
    destinatario: 'CLIENTE',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Membresía por vencer',
  },
  'supply.notify.benefit_expiring': {
    clave: 'supply.notify.benefit_expiring',
    clase: 'TRANSACTIONAL',
    destinatario: 'CLIENTE',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Beneficio por vencer',
  },

  // ── Proveedor ──
  'supply.notify.supplier_sale': {
    clave: 'supply.notify.supplier_sale',
    clase: 'TRANSACTIONAL',
    destinatario: 'PROVEEDOR',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Venta nueva',
  },
  'supply.notify.supplier_settlement_paid': {
    clave: 'supply.notify.supplier_settlement_paid',
    clase: 'TRANSACTIONAL',
    destinatario: 'PROVEEDOR',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Liquidación pagada',
  },

  // ── Operaciones de Membego ──
  //
  // Van por correo además de in-app a propósito: un incidente de severidad
  // alta a las tres de la mañana no se ve en una campana dentro del panel que
  // nadie tiene abierto.
  'supply.notify.ops_incident_high': {
    clave: 'supply.notify.ops_incident_high',
    clase: 'OPERATIONAL',
    destinatario: 'OPERACIONES',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Incidente de severidad alta',
  },
  'supply.notify.ops_dead_letter': {
    clave: 'supply.notify.ops_dead_letter',
    clase: 'OPERATIONAL',
    destinatario: 'OPERACIONES',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Efecto sin salida',
  },
  'supply.notify.ops_readiness_degraded': {
    clave: 'supply.notify.ops_readiness_degraded',
    clase: 'OPERATIONAL',
    destinatario: 'OPERACIONES',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Readiness degradado',
  },
  'supply.notify.ops_reconciliation_mismatch': {
    clave: 'supply.notify.ops_reconciliation_mismatch',
    clase: 'OPERATIONAL',
    destinatario: 'OPERACIONES',
    canales: ['IN_APP', 'EMAIL'],
    etiqueta: 'Desacuerdo de conciliación',
  },
}

export function definicionDeAviso(clave: string): DefinicionDeAviso | null {
  return AVISOS[clave] ?? null
}

// ── Preferencias (§9) ───────────────────────────────────────────────────────

/**
 * Lo que una persona puede apagar, separado por canal Y por clase.
 *
 * Cinco interruptores y no uno, porque «no quiero correos» y «no quiero
 * publicidad» son decisiones distintas y mezclarlas obliga a elegir entre
 * respetar la primera o entregar la segunda.
 *
 * `undefined` significa «no lo ha tocado» y manda el valor por defecto, que es
 * el de `POR_DEFECTO`: lo transaccional encendido, lo promocional APAGADO.
 * Promocional apagado por defecto no es timidez comercial: es que un
 * consentimiento que nadie dio no es un consentimiento.
 */
export interface PreferenciasDeAviso {
  inApp?: boolean
  emailTransactional?: boolean
  emailMarketing?: boolean
  whatsappTransactional?: boolean
  whatsappMarketing?: boolean
}

export const POR_DEFECTO: Required<PreferenciasDeAviso> = {
  inApp: true,
  emailTransactional: true,
  emailMarketing: false,
  whatsappTransactional: false,
  whatsappMarketing: false,
}

export function conPorDefecto(p: PreferenciasDeAviso | null | undefined): Required<PreferenciasDeAviso> {
  return { ...POR_DEFECTO, ...(p ?? {}) }
}

/**
 * ¿Puede salir este aviso por este canal?
 *
 * Lo OPERATIVO no pregunta por preferencias: no va a un cliente, va a quien
 * tiene la guardia, y una persona no se da de baja de los avisos del sistema
 * que opera. Si alguien no quiere recibirlos, se le quita el permiso o se le
 * saca de la lista de operaciones; apagarlos desde una pantalla de
 * preferencias personales dejaría el sistema sin vigilancia sin que nadie lo
 * decidiera a propósito.
 */
export function puedeMandarse(
  aviso: DefinicionDeAviso,
  canal: CanalDeAviso,
  preferencias: PreferenciasDeAviso | null | undefined
): boolean {
  if (!aviso.canales.includes(canal)) return false
  if (aviso.clase === 'OPERATIONAL') return true

  const p = conPorDefecto(preferencias)
  const esMarketing = aviso.clase === 'MARKETING'
  switch (canal) {
    case 'IN_APP':
      // El aviso dentro de la propia aplicación es el menos intrusivo que hay
      // —no persigue a nadie fuera de Membego— y es donde vive el historial.
      // Lo promocional sí lo respeta.
      return esMarketing ? p.inApp && p.emailMarketing : p.inApp
    case 'EMAIL':
      return esMarketing ? p.emailMarketing : p.emailTransactional
    case 'WHATSAPP':
      return esMarketing ? p.whatsappMarketing : p.whatsappTransactional
  }
}

/** Los canales por los que ESTE aviso sale para ESTA persona. */
export function canalesEfectivos(
  aviso: DefinicionDeAviso,
  preferencias: PreferenciasDeAviso | null | undefined
): CanalDeAviso[] {
  return aviso.canales.filter((c) => puedeMandarse(aviso, c, preferencias))
}

// ── Estados de entrega (§7) ─────────────────────────────────────────────────

export type EstadoDeEntrega = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD_LETTER'

/**
 * EL OUTBOX YA ERA LA MÁQUINA DE ESTADOS. No se crea otra.
 *
 * Un aviso externo es un efecto del outbox del bloque 1, así que sus estados
 * SON los del outbox y aquí solo se traducen al vocabulario de §7:
 *
 *   PENDING     → QUEUED       apuntado, esperando su turno
 *   PROCESSING  → SENDING      alguien lo tiene arrendado
 *   DELIVERED   → SENT         el proveedor lo ACEPTÓ
 *   FAILED      → FAILED       falló y está reprogramado
 *   DEAD_LETTER → DEAD_LETTER  agotó los intentos y espera decisión
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ `SENT` Y NO `DELIVERED` (§7)
 *
 * El outbox llama `DELIVERED` a «se lo di al destino», que para un correo
 * significa «Resend respondió 200 y se queda con él». Eso NO es «la persona lo
 * recibió»: el correo puede rebotar, caer en spam o no existir el buzón. Decir
 * «entregado» cuando solo hubo aceptación es inventar una certeza que el
 * proveedor no dio, y es la clase de dato que luego alguien usa para decidir
 * que no hace falta llamar al cliente.
 *
 * Para poder decir `DELIVERED` de verdad haría falta el webhook de entrega de
 * Resend (`email.delivered`). El webhook existe —`/api/webhooks/resend`— pero
 * hoy solo atiende `email.received`, que es el correo ENTRANTE del módulo de
 * soporte. Mientras no se añada ese tipo de evento, el techo honesto es `SENT`
 * y así se enseña.
 */
export function estadoDeEntrega(estadoOutbox: string): EstadoDeEntrega {
  switch (estadoOutbox) {
    case 'PENDING':
      return 'QUEUED'
    case 'PROCESSING':
      return 'SENDING'
    case 'DELIVERED':
      return 'SENT'
    case 'DEAD_LETTER':
      return 'DEAD_LETTER'
    default:
      return 'FAILED'
  }
}

/** Lo que se le enseña a una persona, no el nombre interno. */
export const ETIQUETA_ENTREGA: Readonly<Record<EstadoDeEntrega, string>> = {
  QUEUED: 'En cola',
  SENDING: 'Enviando',
  SENT: 'Aceptado por el proveedor',
  FAILED: 'Falló, reprogramado',
  DEAD_LETTER: 'Sin salida',
}

// ── Identidad estable (§6, §12) ─────────────────────────────────────────────

/**
 * La clave con la que el outbox impide el duplicado.
 *
 * `dedupeKey` es ÚNICO en la tabla, así que esto no es una intención: es la
 * base de datos la que rechaza el segundo. Las cuatro piezas que pide §6
 * —tipo, destinatario, agregado y evento— van dentro, y el destinatario va
 * como `userId`, NUNCA como correo: un identificador no es un dato personal y
 * un correo sí, y esta clave se ve en el Centro de Operaciones.
 */
export function claveDeAviso(d: {
  aviso: string
  canal: CanalDeAviso
  userId: string
  agregadoId: string
  eventoId?: string | null
}): string {
  const base = [d.aviso, d.canal, d.userId, d.agregadoId]
  if (d.eventoId) base.push(d.eventoId)
  return base.join(':')
}

/**
 * La clave de una automatización (§12).
 *
 * `regla + sujeto + periodo` y nada más. El PERIODO es lo que hace que «la
 * membresía de Ana vence en 7 días» avise UNA vez y no una por cada vez que
 * corre el cron: el día ya está dentro de la clave, así que la segunda pasada
 * del mismo día choca contra el índice único.
 *
 * Y es el periodo y no «la última vez que corrió» a propósito: un `lastRunAt`
 * se puede quedar sin escribir si el proceso muere entre el envío y la
 * actualización, y entonces el aviso sale dos veces. Una clave determinista no
 * tiene ese hueco.
 */
export function claveDeAutomatizacion(d: { regla: string; sujetoId: string; periodo: string }): string {
  return ['auto', d.regla, d.sujetoId, d.periodo].join(':')
}

/** El periodo de un día, en la forma que entra en una clave. */
export function periodoDelDia(cuando: Date): string {
  return cuando.toISOString().slice(0, 10)
}

// ── Disparadores de automatización (§11) ────────────────────────────────────

/**
 * Los disparadores que este bloque enciende, y los que NO.
 *
 * §11 pide «no activar todos si no existe caso de uso real», así que están los
 * cuatro que tienen a alguien esperando del otro lado y se dejan apuntados los
 * dos que no:
 *
 *   MEMBERSHIP_EXPIRING    sí · la persona pierde el beneficio si no renueva
 *   BENEFIT_EXPIRING       sí · dinero ya concedido que se vence sin gastar
 *   FINANCE_INCIDENT_HIGH  sí · hay dinero descuadrado esperando decisión
 *   OUTBOX_DEAD            sí · un efecto que nadie va a reintentar solo
 *
 *   POINTS_THRESHOLD_REACHED  no · no hay nada que la persona pueda hacer con
 *                                  el aviso que no vea ya en su panel
 *   SETTLEMENT_OVERDUE        no · hoy la liquidación la lanza una persona, no
 *                                  hay un plazo que se pueda incumplir solo
 */
export const DISPARADORES = [
  'MEMBERSHIP_EXPIRING',
  'BENEFIT_EXPIRING',
  'FINANCE_INCIDENT_HIGH',
  'OUTBOX_DEAD',
] as const

export type Disparador = (typeof DISPARADORES)[number]

export const DISPARADORES_APUNTADOS = ['POINTS_THRESHOLD_REACHED', 'SETTLEMENT_OVERDUE'] as const

/** Qué aviso produce cada disparador. */
export const AVISO_DEL_DISPARADOR: Readonly<Record<Disparador, string>> = {
  MEMBERSHIP_EXPIRING: 'supply.notify.membership_expiring',
  BENEFIT_EXPIRING: 'supply.notify.benefit_expiring',
  FINANCE_INCIDENT_HIGH: 'supply.notify.ops_incident_high',
  OUTBOX_DEAD: 'supply.notify.ops_dead_letter',
}

/**
 * Cuántos días antes avisa cada vencimiento. Configurable, con el valor por
 * defecto documentado, igual que los umbrales del bloque 4.
 */
export function diasDeAviso(variable: string, porDefecto: number): number {
  const bruto = Number(process.env[variable])
  if (!Number.isFinite(bruto) || !Number.isInteger(bruto) || bruto < 1 || bruto > 90) return porDefecto
  return bruto
}
