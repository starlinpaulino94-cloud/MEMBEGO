import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { sinEmpresa } from '@/lib/tenant'
import { getTokensPublicConfig } from '@/lib/payments/cardnet-tokens'
import { formatearPrecio } from '@/modules/catalog/formato'
import { CARDNET_SESSION_STATES, validarCaptureUrl } from '@/modules/pagos/cardnetClientCore'
import { hashNonce } from '@/modules/pagos/cardnetClienteShared'
import type { DatosVentanaCardnet } from '@/modules/pagos/cardnetVentanaHtml'

/**
 * Los datos de la ventana de CardNET que la app abre en el navegador del teléfono (ver `cardnetVentanaHtml.ts`).
 *
 * La pestaña del navegador no lleva la sesión de la app, así que la ventana se abre con lo que solo la app de ESE cliente
 * tiene: el id de la sesión de captura y su nonce (que la base guarda como hash). Lo que la página enseña —llave pública,
 * `UniqueID`, `CaptureURL`, monto— ya se le entrega a la app; no hay nada secreto que filtrar. Y lo que cobra lo decide el
 * servidor después, con la sesión autenticada de la app (`/confirmar`) o leyendo el perfil nuevo en CardNET.
 *
 * Solo una sesión ABIERTA y sin vencer, del ambiente configurado: cualquier otra cosa da `null` (la misma respuesta para
 * «no existe», «ya se usó» o «nonce equivocado», para no servir de oráculo).
 */
export async function cargarVentanaCardnet(
  sessionId: string | null,
  nonce: string | null,
  ahora: Date = new Date()
): Promise<DatosVentanaCardnet | null> {
  if (!sessionId || !nonce || sessionId.length > 128 || nonce.length > 256) return null
  const config = getTokensPublicConfig()
  if (!config) return null

  const sesion = await sinEmpresa('CardNET cliente: abrir la ventana de captura en el navegador del teléfono', (tx) =>
    tx.cardnetCaptureSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        estado: true,
        venceAt: true,
        captureNonce: true,
        captureUrl: true,
        scriptUrl: true,
        publicKey: true,
        customerUniqueId: true,
        monto: true,
        moneda: true,
        company: { select: { name: true } },
      },
    })
  ).catch(() => null)

  if (
    !sesion ||
    sesion.estado !== CARDNET_SESSION_STATES.CAPTURE_OPEN ||
    sesion.venceAt.getTime() <= ahora.getTime() ||
    !sesion.captureNonce ||
    !mismoHash(sesion.captureNonce, hashNonce(nonce)) ||
    !sesion.captureUrl ||
    !sesion.customerUniqueId ||
    !validarCaptureUrl(sesion.captureUrl, config.captureUrl) ||
    sesion.scriptUrl !== config.scriptUrl ||
    sesion.publicKey !== config.publicKey
  ) {
    return null
  }

  return {
    sessionId: sesion.id,
    captureUrl: sesion.captureUrl,
    scriptUrl: config.scriptUrl,
    publicKey: config.publicKey,
    uniqueId: sesion.customerUniqueId,
    montoTexto: formatearPrecio(Number(sesion.monto), sesion.moneda),
    moneda: sesion.moneda,
    comercio: sesion.company.name,
  }
}

function mismoHash(guardado: string, calculado: string): boolean {
  const a = Buffer.from(guardado, 'utf8')
  const b = Buffer.from(calculado, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
