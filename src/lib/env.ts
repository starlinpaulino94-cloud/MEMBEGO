/**
 * Centralized environment variable validation. Imported by Supabase clients so
 * that a missing/wrong configuration fails loudly with a clear message instead
 * of throwing obscure errors deep inside the SDK at runtime.
 */

const REQUIRED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const REQUIRED_SERVER = ['SUPABASE_SERVICE_ROLE_KEY'] as const

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL')
  return url
}

export function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return key
}

export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing env var: SUPABASE_SERVICE_ROLE_KEY')
  return key
}

/**
 * JWT signing secret of the Supabase project (Auth → JWT settings).
 * Used to verify access tokens locally (edge middleware + server) without a
 * network round-trip. Not required yet: local verification degrades to the
 * SDK path when this variable is absent.
 */
export function getSupabaseJwtSecret(): string {
  const key = process.env.SUPABASE_JWT_SECRET
  if (!key) throw new Error('Missing env var: SUPABASE_JWT_SECRET')
  return key
}

/** Whether `SUPABASE_JWT_SECRET` is configured (allows skipping local JWT checks). */
export function hasSupabaseJwtSecret(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET)
}

/**
 * Signing key for the platform API access tokens (`/api/platform/v1`).
 *
 * Returns `null` when absent, and the API answers 503 instead of falling back
 * to a derived or default key. A weak default here would be the difference
 * between "the API is off" and "the API is on and anyone can mint a token" —
 * and only one of those two is visible from the outside.
 *
 * Generate with: `openssl rand -base64 48`.
 */
export function getPlatformTokenSecret(): string | null {
  const key = process.env.PLATFORM_TOKEN_SECRET
  return key && key.length >= 32 ? key : null
}

/**
 * Ed25519 private key used to sign outbound platform events.
 *
 * Returns the raw value; parsing lives in `modules/plataforma/firma.ts`.
 *
 * Absent is a supported state, and unlike `PLATFORM_TOKEN_SECRET` it does NOT
 * fail closed: without it, events keep going out signed with the shared-secret
 * HMAC exactly as they do today. Failing closed here would stop delivering
 * webhooks to satellites that never asked for the new signature.
 */
export function getPlatformEventPrivateKey(): string | undefined {
  return process.env.PLATFORM_EVENT_PRIVATE_KEY
}

/**
 * Claves maestras del cifrado de credenciales de Membego Connect
 * (AES-256-GCM, `modules/connect/cifrado.ts`).
 *
 * Formato: `1:<base64 de 32 bytes>` — y durante una rotación, varias separadas
 * por comas (`1:…,2:…`); se sella con la más alta y se abre con la que diga
 * cada sello. Generar con: `openssl rand -base64 32`.
 *
 * Ausente devuelve `null` y el almacén de credenciales FALLA CERRADO: sin
 * clave no se guarda ni se lee ninguna credencial de conector. Un valor por
 * defecto derivado aquí sería cifrado de mentira — la base y el «secreto»
 * vivirían en el mismo sitio.
 */
export function getConnectClavesMaestras(): string | null {
  const valor = process.env.CONNECT_CLAVES_MAESTRAS
  return valor && valor.trim() ? valor.trim() : null
}

/**
 * QUÉ LE FALTA A LA PLATAFORMA para completar un flujo OAuth de Connect: la
 * firma del `state` (`PLATFORM_TOKEN_SECRET`) y la clave con la que se sellan
 * los tokens que vuelven (`CONNECT_CLAVES_MAESTRAS`).
 *
 * Los conectores OAuth lo consultan en su `disponible()`. Antes cada pieza
 * comprobaba solo lo suyo: el catálogo ofrecía «Conectar» con las variables de
 * Google puestas, y el botón respondía 503 porque no había con qué firmar.
 * La puerta se cierra donde se ve, y el catálogo dice qué falta.
 */
export function faltantesConnectPlataforma(): string[] {
  const faltan: string[] = []
  if (!getPlatformTokenSecret()) faltan.push('PLATFORM_TOKEN_SECRET')
  if (!getConnectClavesMaestras()) faltan.push('CONNECT_CLAVES_MAESTRAS')
  return faltan
}

/**
 * Claves maestras con las que se sella la REFERENCIA DEL PROVEEDOR de identidad
 * (el id de la sesión de verificación; con él y la llave del proveedor se podrían
 * descargar los documentos). AES-256-GCM, mismo formato y misma rotación que
 * `CONNECT_CLAVES_MAESTRAS` (`1:<base64 de 32 bytes>[,2:…]`), pero en una
 * variable PROPIA: el secreto que protege la identidad de las personas no se
 * comparte con el de los conectores. Generar con: `openssl rand -base64 32`.
 *
 * Ausente devuelve `null` y la verificación FALLA CERRADA: sin clave no se
 * guarda ninguna referencia, así que no se empieza ninguna verificación.
 */
export function getIdentidadClavesMaestras(): string | null {
  const valor = process.env.IDENTIDAD_CLAVES_MAESTRAS
  return valor && valor.trim() ? valor.trim() : null
}

/**
 * El «pepper» del HMAC que detecta el mismo documento en dos cuentas
 * (`calcularHashDedupe`). Al menos 32 caracteres, secreto, FUERA de la base:
 * con él un volcado de `identidad_verificaciones` no permite probar números de
 * cédula contra los hashes. Generar con: `openssl rand -base64 48`.
 *
 * Ausente (o corto) devuelve `null` y la verificación FALLA CERRADA.
 */
export function getIdentidadPepper(): string | null {
  const valor = process.env.IDENTIDAD_PEPPER_DEDUPE?.trim()
  return valor && valor.length >= 32 ? valor : null
}

/**
 * Configuración del proveedor de verificación (Didit). Sin clave o sin flujo
 * devuelve `null` y la verificación FALLA CERRADA: no se crea ninguna sesión.
 *
 *  · `DIDIT_API_KEY`: la clave del servidor (cabecera `x-api-key`). Con los
 *    permisos `read:sessions` y `delete:sessions`. NUNCA llega a un cliente ni a un log.
 *  · `DIDIT_WORKFLOW_ID`: el flujo publicado en la consola de Didit. Debe incluir
 *    documento + prueba de vida + comparación facial (el worker no acepta una
 *    aprobación sin las tres) y conservar los datos lo mínimo (se borran al concluir).
 *  · `DIDIT_API_BASE` (opcional): por defecto `https://verification.didit.me`. Solo https.
 */
export function getDiditConfig(): { apiKey: string; workflowId: string; apiBase: string } | null {
  const apiKey = process.env.DIDIT_API_KEY?.trim()
  const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim()
  if (!apiKey || !workflowId) return null
  const base = (process.env.DIDIT_API_BASE?.trim() || 'https://verification.didit.me').replace(/\/+$/, '')
  if (!base.startsWith('https://')) return null
  return { apiKey, workflowId, apiBase: base }
}

/**
 * Los secretos con los que se verifica la firma de los avisos de Didit
 * (`secret_shared_key` del destino del webhook). Pueden convivir DOS para
 * rotar sin perder avisos: el actual y el anterior. Vacío = no se acepta ningún aviso.
 */
export function getDiditSecretosDeWebhook(): string[] {
  return [process.env.DIDIT_WEBHOOK_SECRET, process.env.DIDIT_WEBHOOK_SECRET_ANTERIOR]
    .map((v) => v?.trim() ?? '')
    .filter((v) => v.length >= 16)
}

/**
 * QUÉ LE FALTA al entorno para verificar identidades. La pantalla de plataforma
 * lo muestra para decir exactamente qué configurar, en vez de un «no disponible».
 * Incluye las variables del proveedor y del webhook: sin ellas no se enciende.
 */
export function faltantesIdentidad(): string[] {
  const faltan: string[] = []
  if (!getIdentidadClavesMaestras()) faltan.push('IDENTIDAD_CLAVES_MAESTRAS')
  if (!getIdentidadPepper()) faltan.push('IDENTIDAD_PEPPER_DEDUPE')
  if (!process.env.DIDIT_API_KEY?.trim()) faltan.push('DIDIT_API_KEY')
  if (!process.env.DIDIT_WORKFLOW_ID?.trim()) faltan.push('DIDIT_WORKFLOW_ID')
  if (getDiditSecretosDeWebhook().length === 0) faltan.push('DIDIT_WEBHOOK_SECRET')
  return faltan
}

/** Returns the list of missing required public env vars (for diagnostics). */
export function missingPublicEnv(): string[] {
  return REQUIRED_PUBLIC.filter((k) => !process.env[k])
}

/** Returns the list of missing required server env vars (for diagnostics). */
export function missingServerEnv(): string[] {
  return REQUIRED_SERVER.filter((k) => !process.env[k])
}
