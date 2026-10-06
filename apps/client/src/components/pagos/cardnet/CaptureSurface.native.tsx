import React, { useCallback, useMemo, useRef } from 'react'
import { Text, View } from 'react-native'
import WebView from 'react-native-webview'
import type { CardnetCaptureSurfaceProps } from './capture.types'
import { buildCardnetCaptureDocument } from './captureDocument.native'
import {
  createCardnetTokenGate,
  isAllowedCardnetFrameUrl,
  parseNativeCardnetMessage,
} from './security'

export default function CardnetCaptureSurface({
  session,
  config,
  disabled = false,
  onToken,
  onError,
}: CardnetCaptureSurfaceProps) {
  const consumed = useRef(false)
  const html = useMemo(() => buildCardnetCaptureDocument(session, config), [config, session])
  const tokenGate = useMemo(() => createCardnetTokenGate(session), [session])

  const shouldStartNavigation = useCallback((request: { readonly url: string; readonly isTopFrame: boolean }) => {
    if (request.isTopFrame) {
      if (request.url === 'about:blank') return true
      onError('navigation_rejected')
      return false
    }
    const allowed = isAllowedCardnetFrameUrl(request.url, config, session)
    if (!allowed) onError('navigation_rejected')
    return allowed
  }, [config, onError, session])

  const receiveMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    if (consumed.current) return
    const message = parseNativeCardnetMessage(event.nativeEvent.data, session)
    if (!message) {
      onError('provider_message_rejected')
      return
    }
    const accepted = tokenGate(message.token)
    if (!accepted) return
    consumed.current = true
    onToken(accepted.token)
  }, [onError, onToken, session, tokenGate])

  if (disabled) {
    return (
      <View className="min-h-[180px] items-center justify-center rounded-xl border border-border bg-muted px-4 py-6">
        <Text className="text-center text-sm text-muted-foreground">La captura segura está cerrada.</Text>
      </View>
    )
  }

  return (
    <View className="overflow-hidden rounded-xl border border-border bg-card">
      <View className="flex-row items-center gap-2 border-b border-border px-3 py-2.5">
        <View className="h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Text className="text-sm font-inter-bold text-primary">◈</Text>
        </View>
        <View className="flex-1">
          <Text className="text-sm font-inter-semibold text-foreground">Formulario protegido de CardNET</Text>
          <Text className="text-xs text-muted-foreground">MembeGo no recibe los datos de tu tarjeta.</Text>
        </View>
      </View>
      <WebView
        allowFileAccess={false}
        allowsBackForwardNavigationGestures={false}
        cacheEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        javaScriptEnabled
        mixedContentMode="never"
        onError={() => onError('script_load_failed')}
        onMessage={receiveMessage}
        onShouldStartLoadWithRequest={shouldStartNavigation}
        originWhitelist={['*']}
        saveFormDataDisabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        source={{ html, baseUrl: 'about:blank' }}
        style={{ height: 284, opacity: 1 }}
      />
    </View>
  )
}
