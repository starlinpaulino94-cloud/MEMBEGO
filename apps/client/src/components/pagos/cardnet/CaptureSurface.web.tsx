import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { LockKeyhole, ShieldCheck } from 'lucide-react-native'
import { colors } from '../../../theme/tokens'
import { Button } from '../../ui/Button'
import type { CardnetCaptureSurfaceProps } from './capture.types'
import {
  createCardnetTokenGate,
  extractCardnetToken,
  isAllowedCardnetFrameUrl,
  isValidOneTimeToken,
} from './security'

interface PWCheckoutSDK {
  Bind: (event: 'tokenCreated', callback: (payload: unknown) => void) => void
  SetProperties: (properties: Record<string, unknown>) => void
  OpenIframeCustom: (url: string, uniqueId: string) => void
  Iframe?: { Close?: (...args: unknown[]) => unknown }
}

/**
 * El `Iframe.Close` del widget revienta con «Cannot read properties of null (reading 'parentNode')» cuando intenta cerrar
 * una ventana ya cerrada, y la entrega del token viene justo DESPUÉS del Close en ese mismo manejador: el token se pierde
 * dentro del widget. Es un fallo conocido (la pantalla web de pago ya lo blinda). Envolverlo deja que su código continúe.
 */
function guardWidgetClose(sdk: PWCheckoutSDK) {
  const iframe = sdk.Iframe
  if (!iframe || typeof iframe.Close !== 'function') return
  const current = iframe.Close as ((...args: unknown[]) => unknown) & { guarded?: boolean }
  if (current.guarded) return
  const original = current.bind(iframe)
  const safe = ((...args: unknown[]) => {
    try {
      return original(...args)
    } catch {
      return undefined
    }
  }) as ((...args: unknown[]) => unknown) & { guarded?: boolean }
  safe.guarded = true
  iframe.Close = safe
}

type WindowWithCardnetCheckout = Window & { PWCheckout?: PWCheckoutSDK }

function getCardnetSdk(): PWCheckoutSDK | undefined {
  return (window as WindowWithCardnetCheckout).PWCheckout
}

let installedSdk: PWCheckoutSDK | null = null
let activeTokenHandler: ((payload: unknown) => void) | null = null

function bindSdkOnce(sdk: PWCheckoutSDK) {
  if (installedSdk === sdk) return
  sdk.Bind('tokenCreated', (payload) => activeTokenHandler?.(payload))
  installedSdk = sdk
}

export default function CardnetCaptureSurface({
  session,
  config,
  disabled = false,
  onToken,
  onError,
}: CardnetCaptureSurfaceProps) {
  const [ready, setReady] = useState(false)
  const [opened, setOpened] = useState(false)
  // Se vio alguna vez la ventana de captura de ESTA sesión. El widget la cierra ANTES de entregar el token, así que exigir
  // que siga en el documento descartaba el token real.
  const frameSeen = useRef(false)
  const consumedRef = useRef(false)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    let mounted = true
    const gate = createCardnetTokenGate(session)
    const originalOpen = window.open
    const rejectPopup = ((..._args: Parameters<typeof window.open>) => null) as typeof window.open
    window.open = rejectPopup

    const refreshActiveFrame = () => {
      const iframe = Array.from(document.querySelectorAll('iframe')).find((candidate) =>
        isAllowedCardnetFrameUrl(candidate.src, config, session)
      )
      if (iframe) frameSeen.current = true
    }
    const observer = new MutationObserver(refreshActiveFrame)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['src'],
      childList: true,
      subtree: true,
    })
    refreshActiveFrame()

    const handleToken = (payload: unknown) => {
      if (!mounted || consumedRef.current) return
      refreshActiveFrame()
      // Un texto suelto ES el token cuando lo entrega el SDK (`tokenCreated`); el payload puede venir plano, envuelto o en JSON.
      const token = extractCardnetToken(payload, true)
      if (!token || !frameSeen.current) {
        onErrorRef.current('provider_message_rejected')
        return
      }
      const accepted = gate(token)
      if (!accepted) return
      consumedRef.current = true
      onTokenRef.current(accepted.token)
    }

    // Plan B: con autoSubmit apagado el widget también deja el token en el campo oculto del formulario.
    const fieldWatch = window.setInterval(() => {
      if (consumedRef.current || !frameSeen.current) return
      const value = (document.getElementById('PWToken') as HTMLInputElement | null)?.value
      if (isValidOneTimeToken(value)) handleToken(value)
    }, 500)

    const loadWidget = () => {
      if (!mounted) return
      const sdk = getCardnetSdk()
      if (!sdk || typeof sdk.Bind !== 'function' || typeof sdk.OpenIframeCustom !== 'function') {
        onErrorRef.current('widget_unavailable')
        return
      }
      try {
        guardWidgetClose(sdk)
        bindSdkOnce(sdk)
        activeTokenHandler = handleToken
        setReady(true)
      } catch {
        onErrorRef.current('widget_unavailable')
      }
    }

    if (getCardnetSdk()) {
      loadWidget()
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-cardnet-checkout="1"]')
      if (existing && existing.src !== config.scriptUrl) existing.remove()
      let script = document.querySelector<HTMLScriptElement>('script[data-cardnet-checkout="1"]')
      if (!script) {
        script = document.createElement('script')
        script.src = config.scriptUrl
        script.async = true
        script.dataset.cardnetCheckout = '1'
        document.head.appendChild(script)
      }
      script.addEventListener('load', loadWidget, { once: true })
      script.addEventListener('error', () => {
        if (mounted) onErrorRef.current('script_load_failed')
      }, { once: true })
    }

    return () => {
      mounted = false
      window.clearInterval(fieldWatch)
      if (window.open === rejectPopup) window.open = originalOpen
      observer.disconnect()
      frameSeen.current = false
      if (activeTokenHandler === handleToken) activeTokenHandler = null
    }
  }, [config, session])

  const openCapture = useCallback(() => {
    if (!ready || disabled) return
    const sdk = getCardnetSdk()
    if (!sdk) {
      onError('widget_unavailable')
      return
    }
    try {
      guardWidgetClose(sdk)
      sdk.SetProperties({
        button_label: 'Continuar con CardNET',
        checkout_card: 1,
        currency: session.currency,
        description: 'Pago seguro',
        empty: true,
        form_id: 'cardnet_capture_form',
        lang: 'ESP',
        amount: String(session.amount),
        autoSubmit: false,
      })
      sdk.OpenIframeCustom(config.iframeUrl, session.uniqueId)
      setOpened(true)
    } catch {
      onError('widget_unavailable')
    }
  }, [config, disabled, onError, ready, session])

  return (
    <View className="gap-3">
      <View className={`min-h-[164px] items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 ${opened ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/60'}`}>
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-card">
          {opened ? <ShieldCheck size={19} color={colors.primary.DEFAULT} /> : <LockKeyhole size={19} color={colors.primary.DEFAULT} />}
        </View>
        <Text className="text-center text-sm font-inter-semibold text-foreground">
          {opened ? 'Completa el formulario dentro de CardNET' : 'El formulario seguro se abrirá en CardNET'}
        </Text>
        <Text className="max-w-[340px] text-center text-sm leading-5 text-muted-foreground">
          {ready ? 'Esta pantalla nunca solicita ni almacena el número de tarjeta o el código de seguridad.' : 'Conectando con el formulario protegido…'}
        </Text>
      </View>
      <Button disabled={!ready || disabled} onPress={openCapture} variant="outline">
        {ready ? 'Abrir formulario de CardNET' : 'Preparando formulario seguro'}
      </Button>
      <View className="flex-row items-center justify-center gap-1.5">
        <ShieldCheck size={14} color={colors.surface.mutedForeground} />
        <Text className="text-xs text-muted-foreground">Conexión protegida por CardNET</Text>
      </View>
      <form id="cardnet_capture_form" hidden>
        <input id="PWToken" name="PWToken" type="hidden" />
      </form>
    </View>
  )
}
