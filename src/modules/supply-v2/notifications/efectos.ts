import type { NotifTipo } from '@prisma/client'
import { sinEmpresa } from '@/lib/tenant'
import { definicionDeAviso, type CanalDeAviso } from './dominio'
import { mandarCorreoDeAviso } from './correo'

/**
 * MEMBEGO SUPPLY 2.0 · SLICE 9 · BLOQUE 5 · LOS EJECUTORES DE AVISO.
 *
 * Un ejecutor toma un efecto del outbox y lo entrega por su canal. Nada más:
 * la decisión de qué avisar y a quién ya la tomó `./servicio.ts` al apuntarlo,
 * y la de por qué canales, `./dominio.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CANAL VIENE EN EL PAYLOAD, NO EN EL TIPO DE EFECTO
 *
 * Una fila por canal, pero el mismo `eventType`. Así el Centro de Operaciones
 * agrupa por aviso —«pago confirmado»— y cada canal conserva su estado y su
 * escalera de reintentos. Si el canal fuera parte del tipo habría el doble de
 * tipos y el panel se leería peor sin ganar nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CONTENIDO SE REDACTA AL ENTREGAR, NO AL APUNTAR
 *
 * El payload lleva identificadores y cifras, nunca el texto ni la dirección.
 * Dos razones, y las dos importan:
 *
 *   · el payload se VE en el Centro de Operaciones, y un correo o un teléfono
 *     ahí dentro es un dato personal en una pantalla que ve más gente que la
 *     base de datos (§27);
 *   · entre apuntar y entregar pueden pasar horas: redactar al final hace que
 *     el aviso diga el estado de AHORA y no el de entonces.
 */

export interface EfectoDeAviso {
  eventType: string
  aggregateId: string
  payload: unknown
  idempotencyKey: string
}

/** Lo que cada aviso dice, en los dos canales que hoy funcionan. */
interface Redaccion {
  tipoInApp: NotifTipo
  titulo: string
  mensaje: string
  href: string
  asunto: string
}

/**
 * Los textos. Cortos, sin tecnicismos y sin cifras que puedan quedar viejas
 * entre que se apunta el aviso y sale: lo que se puede comprobar al entregar
 * se comprueba, y lo que no, no se promete.
 */
const REDACCION: Readonly<Record<string, Redaccion>> = {
  'supply.notify.order_paid': {
    tipoInApp: 'PAGO_APROBADO',
    titulo: 'Tu compra está confirmada',
    mensaje: 'Recibimos el pago de tu compra. Ya puedes ver lo que compraste.',
    href: '/cliente/compras',
    asunto: 'Tu compra en Membego está confirmada',
  },
  'supply.notify.benefit_available': {
    tipoInApp: 'SISTEMA',
    titulo: 'Tienes un beneficio disponible',
    mensaje: 'Membego te asignó un beneficio. Puedes usarlo en tu próxima compra.',
    href: '/cliente/bonos',
    asunto: 'Tienes un beneficio disponible en Membego',
  },
  'supply.notify.membership_active': {
    tipoInApp: 'SISTEMA',
    titulo: 'Tu membresía está activa',
    mensaje: 'Tu membresía quedó activa. Ya puedes usar lo que incluye.',
    href: '/cliente/membresias',
    asunto: 'Tu membresía de Membego está activa',
  },
  'supply.notify.membership_expiring': {
    tipoInApp: 'SISTEMA',
    titulo: 'Tu membresía está por vencer',
    mensaje: 'Tu membresía vence pronto. Renuévala para no perder sus beneficios.',
    href: '/cliente/membresias',
    asunto: 'Tu membresía de Membego vence pronto',
  },
  'supply.notify.benefit_expiring': {
    tipoInApp: 'SISTEMA',
    titulo: 'Un beneficio tuyo está por vencer',
    mensaje: 'Tienes un beneficio que vence pronto. Úsalo antes de que se venza.',
    href: '/cliente/bonos',
    asunto: 'Un beneficio tuyo en Membego vence pronto',
  },
  'supply.notify.supplier_sale': {
    tipoInApp: 'SISTEMA',
    titulo: 'Tienes una venta nueva',
    mensaje: 'Se vendió una de tus ofertas. Revisa la entrega pendiente.',
    href: '/admin/supply-v2/ventas',
    asunto: 'Tienes una venta nueva en Membego',
  },
  'supply.notify.supplier_settlement_paid': {
    tipoInApp: 'SISTEMA',
    titulo: 'Tu liquidación está pagada',
    mensaje: 'Membego pagó tu liquidación. Puedes ver el detalle en tu portal.',
    href: '/admin/supply-v2/finanzas',
    asunto: 'Tu liquidación de Membego está pagada',
  },
  'supply.notify.ops_incident_high': {
    tipoInApp: 'SISTEMA',
    titulo: 'Incidente de pago de severidad alta',
    mensaje: 'Hay un incidente de pago externo sin resolver que necesita decisión.',
    href: '/superadmin/supply-v2/operaciones/incidentes?severity=HIGH',
    asunto: '[Membego · operaciones] Incidente de pago de severidad alta',
  },
  'supply.notify.ops_dead_letter': {
    tipoInApp: 'SISTEMA',
    titulo: 'Hay efectos sin salida',
    mensaje: 'Uno o más efectos agotaron sus intentos y esperan decisión.',
    href: '/superadmin/supply-v2/operaciones/difuntos',
    asunto: '[Membego · operaciones] Efectos sin salida',
  },
  'supply.notify.ops_readiness_degraded': {
    tipoInApp: 'SISTEMA',
    titulo: 'Supply 2.0 está degradado',
    mensaje: 'La comprobación de readiness dejó de estar sana. Revisa el estado del sistema.',
    href: '/superadmin/supply-v2/operaciones',
    asunto: '[Membego · operaciones] Supply 2.0 degradado',
  },
  'supply.notify.ops_reconciliation_mismatch': {
    tipoInApp: 'SISTEMA',
    titulo: 'Hay desacuerdos de conciliación',
    mensaje: 'Una o más comprobaciones de pago no cuadran. Revisa las conciliaciones.',
    href: '/superadmin/supply-v2/operaciones/conciliaciones?resultado=MISMATCH',
    asunto: '[Membego · operaciones] Desacuerdos de conciliación',
  },
}

function leerPayload(p: unknown): { canal: CanalDeAviso | null; userId: string | null } {
  if (!p || typeof p !== 'object') return { canal: null, userId: null }
  const o = p as Record<string, unknown>
  const canal = typeof o.canal === 'string' ? (o.canal as CanalDeAviso) : null
  const userId = typeof o.userId === 'string' ? o.userId : null
  return { canal, userId }
}

/**
 * Entrega un efecto de aviso.
 *
 * Lanza cuando el fallo es TRANSITORIO, para que el outbox lo reprograme con
 * su escalera. Devuelve con detalle cuando no hay nada más que hacer —la
 * persona lo apagó, el canal no está configurado, el aviso no existe—, porque
 * reintentar ocho veces algo que no puede cambiar llena la cola de difuntos y
 * esconde las averías de verdad.
 */
export async function entregarAviso(e: EfectoDeAviso): Promise<{ detalle: string; entregado?: boolean }> {
  const definicion = definicionDeAviso(e.eventType)
  const redaccion = REDACCION[e.eventType]
  if (!definicion || !redaccion) {
    throw new Error(`AVISO_DESCONOCIDO: ${e.eventType}`)
  }

  const { canal, userId } = leerPayload(e.payload)
  if (!canal || !userId) {
    // Un efecto sin canal o sin destinatario está mal apuntado. No es
    // transitorio y por eso se dice así, no se reintenta.
    throw new Error('AVISO_SIN_DESTINO: el efecto no lleva canal o usuario')
  }

  if (canal === 'IN_APP') {
    try {
      await sinEmpresa('Supply 2.0: aviso dentro de Membego', (tx) =>
        tx.notificacion.create({
          data: {
            userId,
            tipo: redaccion.tipoInApp,
            titulo: redaccion.titulo,
            mensaje: redaccion.mensaje,
            href: redaccion.href,
            dedupeKey: e.idempotencyKey,
          },
        })
      )
      return { detalle: 'aviso creado dentro de Membego' }
    } catch (err) {
      // P2002: ya existía. Es la idempotencia funcionando —el intento anterior
      // sí llegó, aunque no pudiéramos marcarlo— y cuenta como hecho. La tabla
      // `notificaciones` tiene índice único `(userId, dedupeKey)`, así que esto
      // se puede DEMOSTRAR y no solo afirmar.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        return { detalle: 'el aviso ya existía dentro de Membego' }
      }
      throw err
    }
  }

  if (canal === 'EMAIL') {
    const r = await mandarCorreoDeAviso(definicion, userId, {
      asunto: redaccion.asunto,
      texto: `${redaccion.mensaje}\n\n${redaccion.titulo}`,
    })
    return r ?? { detalle: 'no se manda: la persona no tiene dirección de correo', entregado: false }
  }

  // WhatsApp de plataforma no está configurado y `servicio.ts` no apunta sus
  // efectos. Si una fila llega aquí es de antes de esa decisión: se cierra con
  // su razón en vez de reintentarse hasta morir.
  return { detalle: 'canal de WhatsApp NO CONFIGURADO: ver el informe del bloque 5', entregado: false }
}

/** Los tipos de efecto que este módulo sabe entregar, para el registro del worker. */
export const EFECTOS_DE_AVISO: Readonly<Record<string, (e: EfectoDeAviso) => Promise<{ detalle: string; entregado?: boolean }>>> =
  Object.fromEntries(Object.keys(REDACCION).map((clave) => [clave, entregarAviso]))
