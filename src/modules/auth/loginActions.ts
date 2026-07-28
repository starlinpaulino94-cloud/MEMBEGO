'use server'

/**
 * INICIO DE SESIÓN EN EL SERVIDOR (auditoría de producción · C-05).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ ESTABA MAL
 *
 * El login ocurría en el navegador: `supabase.auth.signInWithPassword(...)`
 * desde `LoginForm`. Al no pasar por el servidor de Next, ningún limitador
 * propio podía intervenir — de hecho `loginLimiter` llevaba tiempo definido en
 * `src/lib/rate-limit.ts` y sin un solo importador. El único freno era un
 * contador en `localStorage`, que es un recordatorio amable, no una defensa:
 * se borra con una pestaña de incógnito.
 *
 * Resultado: fuerza bruta de contraseñas y enumeración de usuarios a la
 * velocidad que aguantara Supabase.
 *
 * QUÉ HACE AHORA
 *
 * La comprobación de credenciales pasa por aquí. Antes de tocar Supabase se
 * consulta el limitador distribuido (Upstash, compartido entre todas las
 * instancias serverless) con DOS claves:
 *
 *   · por IP    — frena a quien prueba muchas cuentas desde un sitio,
 *   · por correo — frena a quien prueba muchas contraseñas de una cuenta
 *                  repartiendo el ataque entre muchas IP.
 *
 * Las dos hacen falta: cada una sola deja abierta la mitad del ataque.
 *
 * HASTA DÓNDE LLEGA ESTA DEFENSA — y conviene decirlo sin adornos
 *
 * La clave anónima de Supabase es pública por diseño (va en el navegador), así
 * que un atacante decidido puede llamar al endpoint de Auth de Supabase
 * DIRECTAMENTE y saltarse este archivo entero. Lo que se cierra aquí es el
 * camino de la aplicación, que es por donde va el 100 % del tráfico real y de
 * los ataques automatizados no dirigidos.
 *
 * El camino directo se cierra en Supabase, no en el código, y hay que hacerlo
 * a mano en el panel del proyecto (ver docs/SEGURIDAD-AUTH.md):
 *   · activar CAPTCHA (hCaptcha/Turnstile) en Auth,
 *   · bajar el rate limit de "Sign in / Sign up" de Auth,
 *   · activar la protección contra enumeración de usuarios.
 * Sin esos tres, este archivo es la mitad del trabajo.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { loginLimiter, getClientIdentifier } from '@/lib/rate-limit'
import { ROLE_HOME, type AppRole } from '@/types'

export interface LoginState {
  error?: string
  /** Destino al que debe navegar el cliente cuando la sesión ya está creada. */
  redirect?: string
}

/**
 * Mensaje de error uniforme para credenciales.
 *
 * "Correo o contraseña incorrectos" —nunca "ese correo no existe"— para no
 * convertir el formulario en un comprobador de qué cuentas están registradas.
 */
const CREDENCIALES = 'Correo o contraseña incorrectos.'

export async function iniciarSesion(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const redirectPedido = String(formData.get('redirect') ?? '')

  if (!email || !password) return { error: 'Escribe tu correo y tu contraseña.' }

  const h = await headers()
  const ip = getClientIdentifier({ headers: h })

  // Las dos claves se consultan SIEMPRE, aunque la primera ya haya denegado:
  // si se cortocircuitara, un ataque repartido por IP no gastaría cuota de la
  // clave por correo y esa mitad del freno no llegaría a activarse nunca.
  const [okIp, okEmail] = await Promise.all([
    loginLimiter(`ip:${ip}`),
    loginLimiter(`email:${email}`),
  ])
  if (!okIp || !okEmail) {
    return {
      error: 'Demasiados intentos de acceso. Espera unos minutos y vuelve a intentarlo.',
    }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // 429 y 5xx de Supabase no son "credenciales malas": decirle al usuario
      // que su contraseña está mal cuando el servicio está saturado le hace
      // cambiarla sin necesidad.
      if (error.status === 429) {
        return { error: 'El servicio de acceso está ocupado. Intenta de nuevo en un minuto.' }
      }
      if (!error.status || error.status >= 500) {
        return { error: 'No se pudo iniciar sesión ahora mismo. Intenta de nuevo en unos momentos.' }
      }
      if (error.message.toLowerCase().includes('email not confirmed')) {
        return { error: 'Confirma tu correo antes de entrar. Te enviamos un enlace al registrarte.' }
      }
      return { error: CREDENCIALES }
    }

    const role = (data.user?.app_metadata?.role ?? 'CLIENTE') as AppRole
    return { redirect: destinoSeguro(redirectPedido, ROLE_HOME[role] ?? '/') }
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : ''
    if (mensaje.includes('Missing env var')) {
      return {
        error: `Este entorno no está configurado (${mensaje.replace('Missing env var: ', 'falta ')}).`,
      }
    }
    console.error('[login] error inesperado:', e)
    return { error: 'No se pudo iniciar sesión. Intenta de nuevo en unos momentos.' }
  }
}

/**
 * Solo rutas internas. Un `?redirect=https://otro-sitio` convertiría el login
 * en un trampolín de phishing: la víctima ve el dominio de MembeGo, se
 * autentica de verdad, y acaba en la página del atacante creyendo que sigue
 * dentro. Se exige que empiece por una sola barra y que no empiece por dos
 * (`//evil.com` es una URL absoluta con protocolo heredado).
 */
function destinoSeguro(candidato: string, porDefecto: string): string {
  if (!candidato.startsWith('/') || candidato.startsWith('//')) return porDefecto
  return candidato
}
