import React, { useCallback, useMemo, useRef } from 'react'
import { Text, View } from 'react-native'
import WebView from 'react-native-webview'
import type { CardnetCaptureSurfaceProps } from './capture.types'
import { buildCardnetCaptureDocument } from './captureDocument.native'
import {
  CARDNET_CAPTURE_DOCUMENT_PATH,
  createCardnetTokenGate,
  isAllowedCardnetNavigation,
  parseCardnetDiagnosticMessage,
  parseNativeCardnetMessage,
  resolveCardnetMerchantOrigin,
  sanitizeCardnetDiagnosticLocation,
  type CardnetDiagnosticStage,
} from './security'

function logCardnetDiagnostic(stage: CardnetDiagnosticStage, url?: string, code?: number): void {
  const location = url ? sanitizeCardnetDiagnosticLocation(url) : null
  const details = {
    stage,
    ...(location ?? {}),
    ...(code === undefined ? {} : { code }),
  }
  const isFailure = stage === 'sdk_script_failed' ||
    stage === 'sdk_unavailable' ||
    stage === 'sdk_setup_failed' ||
    stage === 'capture_open_failed' ||
    stage === 'navigation_rejected' ||
    stage === 'webview_error' ||
    stage === 'webview_http_error'
  if (isFailure) console.warn('[CardNET]', details)
  else console.info('[CardNET]', details)
}

export default function CardnetCaptureSurface({
  session,
  config,
  merchantOrigin,
  disabled = false,
  onToken,
  onError,
}: CardnetCaptureSurfaceProps) {
  const consumed = useRef(false)
  const html = useMemo(() => buildCardnetCaptureDocument(session, config), [config, session])
  const tokenGate = useMemo(() => createCardnetTokenGate(session), [session])
  const trustedMerchantOrigin = useMemo(
    () => resolveCardnetMerchantOrigin(merchantOrigin),
    [merchantOrigin],
  )

  const shouldStartNavigation = useCallback((request: { readonly url: string; readonly isTopFrame?: boolean }) => {
    const allowed = trustedMerchantOrigin !== null &&
      isAllowedCardnetNavigation(request, trustedMerchantOrigin, config, session)
    logCardnetDiagnostic(allowed ? 'navigation_allowed' : 'navigation_rejected', request.url)
    if (!allowed) onError('navigation_rejected')
    return allowed
  }, [config, onError, session, trustedMerchantOrigin])

  const receiveMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const diagnostic = parseCardnetDiagnosticMessage(event.nativeEvent.data)
    if (diagnostic) {
      const target = diagnostic.stage.startsWith('sdk_')
        ? config.scriptUrl
        : diagnostic.stage.startsWith('capture_')
          ? config.iframeUrl
          : merchantOrigin
      logCardnetDiagnostic(diagnostic.stage, target)
      if (diagnostic.stage === 'sdk_script_failed') onError('script_load_failed')
      if (diagnostic.stage === 'sdk_unavailable' || diagnostic.stage === 'sdk_setup_failed' || diagnostic.stage === 'capture_open_failed') {
        onError('widget_unavailable')
      }
      return
    }
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
  }, [config.iframeUrl, config.scriptUrl, merchantOrigin, onError, onToken, session, tokenGate])

  if (disabled) {
    return (
      <View className="min-h-[180px] items-center justify-center rounded-xl border border-border bg-muted px-4 py-6">
        <Text className="text-center text-sm text-muted-foreground">La captura segura está cerrada.</Text>
      </View>
    )
  }

  if (!trustedMerchantOrigin) {
    return (
      <View className="min-h-[180px] items-center justify-center rounded-xl border border-border bg-muted px-4 py-6">
        <Text className="text-center text-sm text-muted-foreground">El origen seguro de la tienda no es válido.</Text>
      </View>
    )
  }

  // '*' only routes requests through our strict callback; a non-matching originWhitelist opens URLs in the OS.
  return (
    <View className="flex-1 bg-background">
      <WebView
        allowFileAccess={false}
        allowsBackForwardNavigationGestures={false}
        cacheEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        javaScriptEnabled
        key={session.captureNonce}
        mixedContentMode="never"
        onError={(event) => {
          logCardnetDiagnostic('webview_error', event.nativeEvent.url, event.nativeEvent.code)
          onError('script_load_failed')
        }}
        onHttpError={(event) => {
          logCardnetDiagnostic('webview_http_error', event.nativeEvent.url, event.nativeEvent.statusCode)
        }}
        onLoadEnd={(event) => logCardnetDiagnostic('webview_load_end', event.nativeEvent.url)}
        onLoadStart={(event) => logCardnetDiagnostic('webview_load_start', event.nativeEvent.url)}
        onMessage={receiveMessage}
        onShouldStartLoadWithRequest={shouldStartNavigation}
        originWhitelist={['*']}
        saveFormDataDisabled
        scrollEnabled
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        source={{ html, baseUrl: `${trustedMerchantOrigin}${CARDNET_CAPTURE_DOCUMENT_PATH}` }}
        style={{ flex: 1, opacity: 1 }}
      />
    </View>
  )
}
