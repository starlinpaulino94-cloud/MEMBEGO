import 'server-only'
import { getConnectClavesMaestras } from '@/lib/env'
import { abrir, parsearClavesMaestras, sellar, type ClavesMaestras } from '@/modules/connect/cifrado'
import type { SecretosDeFirma } from '@/modules/connect/webhooksNucleo'

/**
 * SELLADO DEL SECRETO DE UN WEBHOOK DE EMPRESA (auditoría A-7).
 *
 * El secreto con el que se firma un webhook de empresa se guardaba EN CLARO. La
 * razón que lo justificaba —«tiene que poder volver a enseñarse en el panel»—
 * resultó falsa al revisarla: no hay ni hubo nunca pantalla que lo reenseñe. Así
 * que se sella, con el mismo AES-256-GCM (`cifrado.ts`) que las credenciales de
 * conexión.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FALLA ABIERTO, AL REVÉS QUE `credenciales.ts`
 *
 * Las credenciales de conexión fallan CERRADO sin clave maestra: sin ella, «el
 * almacén está apagado» y no se guarda ni se lee. Aquí no se puede: el secreto de
 * webhook FIRMA entregas que están saliendo, y un despliegue sin clave maestra no
 * puede quedarse sin poder firmar sus webhooks. Además no es una credencial de
 * acceso —no abre datos de nadie—: es un HMAC de integridad. Así que sin clave
 * maestra se sigue guardando y leyendo EN CLARO, exactamente como antes, y con
 * clave maestra se sella. Los dos formatos conviven en la misma columna.
 *
 * El AAD ata el sello a la EMPRESA (`webhook:<companyId>`) y no a la fila: el id
 * de la suscripción no existe hasta después del INSERT, y atar al companyId ya
 * cubre la amenaza que importa —que un volcado de la base no deje mover un
 * secreto sellado a la suscripción de OTRA empresa—. Moverlo dentro de la misma
 * empresa no es una escalada: es su propio secreto.
 */

const MARCA_SELLO = 'cn1.'

let cacheClaves: ClavesMaestras | null | undefined
function claves(): ClavesMaestras | null {
  if (cacheClaves === undefined) {
    const valor = getConnectClavesMaestras()
    cacheClaves = valor ? parsearClavesMaestras(valor) : null
  }
  return cacheClaves
}

function aad(companyId: string): string {
  return `webhook:${companyId}`
}

/** ¿Este valor guardado es un sello, o el secreto en claro de antes? */
export function estaSellado(valor: string): boolean {
  return valor.startsWith(MARCA_SELLO)
}

/**
 * Sella un secreto para guardarlo. Sin clave maestra devuelve el secreto TAL
 * CUAL (fallo abierto): el webhook tiene que poder firmarse igual.
 */
export function sellarSecretoWebhook(companyId: string, secreto: string): string {
  const km = claves()
  return km ? sellar(km, secreto, aad(companyId)) : secreto
}

/**
 * Abre un secreto guardado para firmar con él. Un valor en claro pasa tal cual
 * —así una fila que aún no se ha sellado sigue funcionando—; uno sellado se abre.
 * Si está sellado y no se puede abrir (falta la clave que lo selló), se devuelve
 * como está: firmar con eso dará una firma que el receptor rechaza —visible— en
 * vez de un fallo silencioso, y el remedio (restaurar la clave) es el mismo que
 * para las credenciales de conexión.
 */
export function abrirSecretoWebhook(companyId: string, valor: string): string {
  if (!estaSellado(valor)) return valor
  const km = claves()
  if (!km) return valor
  const r = abrir(km, valor, aad(companyId))
  return r.ok ? r.datos : valor
}

/**
 * Abre los secretos de firma de una fila (el primario y, si hay rotación, el
 * anterior) para poder firmar con ellos. Es el paso que va JUSTO antes de
 * `secretosVivos`/`entregar`: a partir de ahí todo es texto en claro en memoria,
 * como antes de sellar.
 */
export function abrirSecretosFirma(companyId: string, fila: SecretosDeFirma): SecretosDeFirma {
  return {
    secreto: abrirSecretoWebhook(companyId, fila.secreto),
    secretoAnterior:
      fila.secretoAnterior !== null ? abrirSecretoWebhook(companyId, fila.secretoAnterior) : null,
    secretoAnteriorHasta: fila.secretoAnteriorHasta,
  }
}
