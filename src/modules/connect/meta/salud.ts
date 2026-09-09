import 'server-only'
import { llamarGraph, tokenDeApp, type ResultadoGraph } from '@/modules/connect/meta/graph'
import { leerInspeccion, type InspeccionToken } from '@/modules/connect/meta/tokensNucleo'

/**
 * INSPECCIONAR UN TOKEN con `debug_token` (Fase 1).
 *
 * Es la única fuente fiable de tres cosas: si el token vale, qué permisos
 * concedió DE VERDAD la empresa (pueden ser menos que los pedidos) y sobre
 * qué cuentas (`granular_scopes.target_ids`). Se llama con el token de la
 * APP, no con el inspeccionado: por eso no lleva `appsecret_proof` (que es
 * para tokens de usuario/Página/negocio).
 */
export async function inspeccionarToken(token: string): Promise<ResultadoGraph<InspeccionToken>> {
  const app = tokenDeApp()
  if (!app) {
    return {
      ok: false,
      respuesta: { status: 0, requestId: null, mensaje: 'sin app de Meta configurada', codigo: null, subcodigo: null },
    }
  }
  const r = await llamarGraph<unknown>({
    ruta: '/debug_token',
    query: { input_token: token, access_token: app },
  })
  if (!r.ok) return r
  return { ok: true, datos: leerInspeccion(r.datos), requestId: r.requestId }
}
