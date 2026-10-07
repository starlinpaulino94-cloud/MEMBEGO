import type { Tx } from '@/lib/tenant'
import { emitirEfectoEnTx } from '../operations/outbox'
import {
  canalesEfectivos,
  claveDeAviso,
  definicionDeAviso,
  type CanalDeAviso,
  type PreferenciasDeAviso,
} from './dominio'
import { estadoDeWhatsapp } from './whatsapp'

/**
 * MEMBEGO SUPPLY · SLICE 9 · BLOQUE 5 · APUNTAR UN AVISO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CAMINO, Y POR QUÉ ES ESTE Y NO OTRO (§2)
 *
 *   evento interno → OUTBOX → cola → worker → canal
 *
 * Nunca «transacción financiera → mandar correo». La diferencia no es de
 * estilo: si el correo sale dentro de la transacción que confirma un pago,
 * entonces un Resend caído o lento DESHACE el pago o lo bloquea. El dinero
 * quedaría a merced de un proveedor de correo.
 *
 * Con el outbox, lo que la transacción hace es APUNTAR que hay que avisar —una
 * fila, sin red— y confirmar. Si el proceso muere justo después del COMMIT, el
 * apunte está y el cron lo recoge. Si el correo falla, el pago sigue bien y el
 * aviso se reprograma con la escalera del bloque 1.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA FILA POR CANAL
 *
 * Un aviso por correo y el mismo aviso in-app son DOS efectos, no uno. Así
 * cada uno tiene su propio estado y su propia escalera de reintentos: que
 * Resend esté caído no deja a la persona sin el aviso dentro de Membego, y el
 * estado de entrega de §7 se puede decir por canal en vez de a bulto.
 *
 * La clave de deduplicación lleva el canal dentro, y `dedupeKey` es ÚNICO en
 * la tabla: el duplicado lo rechaza la base, no una comprobación que alguien
 * puede olvidar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PREFERENCIA SE MIRA DOS VECES, A PROPÓSITO
 *
 * Aquí, para no apuntar un efecto de correo de alguien que lo tiene apagado
 * —serían filas que solo existen para ser descartadas, y el panel operativo se
 * llenaría de ruido—. Y otra vez al ENTREGAR, que es la que manda: entre que
 * se apunta un aviso y sale pueden pasar horas, y si en ese rato la persona
 * apaga el canal, lo que vale es lo último que dijo ella.
 */

export interface AvisoAApuntar {
  /** La clave de `AVISOS` en `./dominio`. */
  aviso: string
  /** A quién. SIEMPRE un id, nunca un correo ni un teléfono. */
  userId: string
  /** Sobre qué: la compra, la membresía, el incidente. */
  agregadoType: string
  agregadoId: string
  /** El hilo del Slice 9, para que el aviso se pueda seguir con lo demás (§16). */
  correlationId: string
  /** El evento que lo provocó, si lo hubo. Entra en la clave (§6). */
  eventoId?: string | null
  /**
   * Datos SIN información personal que el ejecutor necesite para redactar.
   * Números de compra y cantidades, sí. Correos, teléfonos y tokens, no: esto
   * se ve en el Centro de Operaciones.
   */
  datos?: Record<string, string | number | boolean | null>
}

export interface AvisoApuntado {
  canal: CanalDeAviso
  outboxId: string
  repetido: boolean
}

/**
 * Apunta el aviso en el outbox, dentro de la transacción de quien llama.
 *
 * Devuelve una entrada por canal. Lista vacía significa que no había ningún
 * canal por el que mandarlo —la persona los apagó todos, o el aviso no existe—
 * y eso NO es un error: es una decisión cumplida.
 */
export async function apuntarAvisoEnTx(tx: Tx, a: AvisoAApuntar): Promise<AvisoApuntado[]> {
  const definicion = definicionDeAviso(a.aviso)
  if (!definicion) return []

  const persona = await tx.user.findUnique({
    where: { id: a.userId },
    select: { preferenciasDeAviso: true },
  })
  if (!persona) return []

  const preferencias: PreferenciasDeAviso | null = persona.preferenciasDeAviso
    ? {
        inApp: persona.preferenciasDeAviso.inApp ?? undefined,
        emailTransactional: persona.preferenciasDeAviso.emailTransactional ?? undefined,
        emailMarketing: persona.preferenciasDeAviso.emailMarketing ?? undefined,
        whatsappTransactional: persona.preferenciasDeAviso.whatsappTransactional ?? undefined,
        whatsappMarketing: persona.preferenciasDeAviso.whatsappMarketing ?? undefined,
      }
    : null

  const apuntados: AvisoApuntado[] = []
  for (const canal of canalesEfectivos(definicion, preferencias)) {
    // WhatsApp de plataforma no está configurado (ver `./whatsapp.ts`). No se
    // apunta el efecto en vez de apuntarlo para que muera ocho veces: una cola
    // de difuntos llena de algo que no puede funcionar esconde las averías de
    // verdad.
    if (canal === 'WHATSAPP' && estadoDeWhatsapp().estado !== 'CONFIGURED') continue

    const { id, repetido } = await emitirEfectoEnTx(tx, {
      eventType: a.aviso,
      aggregateType: a.agregadoType,
      aggregateId: a.agregadoId,
      correlationId: a.correlationId,
      dedupeKey: claveDeAviso({
        aviso: a.aviso,
        canal,
        userId: a.userId,
        agregadoId: a.agregadoId,
        eventoId: a.eventoId ?? null,
      }),
      payload: { canal, userId: a.userId, ...(a.datos ?? {}) },
    })
    apuntados.push({ canal, outboxId: id, repetido })
  }
  return apuntados
}
