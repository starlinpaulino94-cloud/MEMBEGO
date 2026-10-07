export type RuntimePlatform = 'web' | 'native'

export interface RuntimeUrlOptions {
  readonly configuredUrl?: string
  readonly platform: RuntimePlatform
  readonly hostUri?: string
  readonly nativeHost?: string
  readonly browserOrigin?: string
}

export class RuntimeUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeUrlConfigurationError'
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

function hostFromExpoUri(hostUri: string | undefined): string | undefined {
  const host = hostUri?.split(':')[0]?.trim()
  return host || undefined
}

function replaceLocalHost(url: string, host: string): string {
  const parsed = new URL(url)
  if (!LOCAL_HOSTNAMES.has(parsed.hostname)) return url

  parsed.hostname = host
  return parsed.toString().replace(/\/$/, '')
}

function portFromBrowserOrigin(origin: string): string {
  const parsed = new URL(origin)
  parsed.port = '3000'
  return parsed.origin
}

export function resolveSupabaseUrl(options: RuntimeUrlOptions): string {
  const configuredUrl = options.configuredUrl?.trim()
  if (!configuredUrl) {
    throw new RuntimeUrlConfigurationError(
      'Missing EXPO_PUBLIC_SUPABASE_URL. Configure the local Supabase URL before starting the client.'
    )
  }

  if (options.platform === 'web') return configuredUrl

  const deviceHost = options.nativeHost?.trim() || hostFromExpoUri(options.hostUri)
  return deviceHost ? replaceLocalHost(configuredUrl, deviceHost) : configuredUrl
}

export function resolveApiBaseUrl(options: RuntimeUrlOptions): string {
  const configuredUrl = options.configuredUrl?.trim()

  if (options.platform === 'native') {
    const deviceHost = options.nativeHost?.trim() || hostFromExpoUri(options.hostUri)
    if (configuredUrl) {
      return deviceHost ? replaceLocalHost(configuredUrl, deviceHost) : configuredUrl
    }
    if (deviceHost) return `http://${deviceHost}:3000`
    throw new RuntimeUrlConfigurationError(
      'Missing EXPO_PUBLIC_API_URL. Configure the Next.js BFF URL before starting the client.'
    )
  }

  if (configuredUrl) return configuredUrl
  if (options.browserOrigin) return portFromBrowserOrigin(options.browserOrigin)

  throw new RuntimeUrlConfigurationError(
    'Missing EXPO_PUBLIC_API_URL. Configure the Next.js BFF URL before starting the client.'
  )
}
