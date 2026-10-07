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
  matchesActiveCaptureFrame,
} from './security'

interface PWCheckoutSDK {
  Bind: (event: 'tokenCreated', callback: (payload: unknown) => void) => void
  SetProperties: (properties: Record<string, unknown>) => void
  OpenIframeCustom: (url: string, uniqueId: string) => void
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
  const frameWindow = useRef<Window | null>(null)
  const trustedToken = useRef<string | null>(null)
  const consumedRef = useRef(false)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)
  onTokenRef.current = onToken
  onErrorRef.current = onError

  useEffect(() => {
    let mounted = true
    const gate = createCardnetTokenGate(session)
    const messageListener = (event: MessageEvent<unknown>) => {
      if (!matchesActiveCaptureFrame(event, config.origin, frameWindow.current)) return
      trustedToken.current = extractCardnetToken(event.data)
    }
    window.addEventListener('message', messageListener)
    const originalOpen = window.open
    const rejectPopup = ((..._args: Parameters<typeof window.open>) => null) as typeof window.open
    window.open = rejectPopup

    const refreshActiveFrame = () => {
      const iframe = Array.from(document.querySelectorAll('iframe')).find((candidate) =>
        isAllowedCardnetFrameUrl(candidate.src, config, session)
      )
      frameWindow.current = iframe?.contentWindow ?? null
      if (!frameWindow.current) trustedToken.current = null
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
      const token = extractCardnetToken(payload)
      if (!token || trustedToken.current !== token || !frameWindow.current) {
        onErrorRef.current('provider_message_rejected')
        return
      }
      const accepted = gate(token)
      if (!accepted) return
      consumedRef.current = true
      trustedToken.current = null
      onTokenRef.current(accepted.token)
    }

    const loadWidget = () => {
      if (!mounted) return
      const sdk = getCardnetSdk()
      if (!sdk || typeof sdk.Bind !== 'function' || typeof sdk.OpenIframeCustom !== 'function') {
        onErrorRef.current('widget_unavailable')
        return
      }
      try {
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
      window.removeEventListener('message', messageListener)
      if (window.open === rejectPopup) window.open = originalOpen
      observer.disconnect()
      frameWindow.current = null
      trustedToken.current = null
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
