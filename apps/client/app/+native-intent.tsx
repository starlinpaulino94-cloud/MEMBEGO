import { isCardnetWindowReturn } from '../src/components/pagos/cardnet/security'

/**
 * Enlaces que entran a la app desde fuera (Expo Router los procesa aquí antes de navegar).
 *
 * La vuelta de la ventana de CardNET (`membego://pago-cardnet?...`) la recoge `WebBrowser.openAuthSessionAsync` en la
 * pantalla de pago; no es una ruta. Sin esto, el router intentaba navegar a `/pago-cardnet`, que no existe, y sacaba al
 * cliente de su pago. Con `null` el router no navega y la app se queda donde estaba.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  // El router a veces entrega la URL completa y a veces solo la ruta: se reconocen las dos formas.
  const esVueltaDeCardnet = isCardnetWindowReturn(path) || /^\/?pago-cardnet(?:[/?#]|$)/.test(path)
  if (!esVueltaDeCardnet) return path
  return initial ? '/' : null
}
