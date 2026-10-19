import * as WebBrowser from 'expo-web-browser'
import { api } from './api'

/**
 * Abre el comprobante de pago en el navegador del teléfono.
 *
 * La app no imprime: imprime el navegador (Chrome/Safari tienen «Imprimir» y
 * «Guardar como PDF»). Como esa pestaña no tiene la sesión de la app, primero
 * se pide al servidor —con la sesión— un enlace firmado y de vida corta.
 */
export async function abrirComprobante(transactionId: string): Promise<void> {
  const { url } = await api.getComprobanteEnlace(transactionId)
  await WebBrowser.openBrowserAsync(url)
}
