/**
 * UN DIDIT FALSO para las pruebas contra PostgreSQL: se instala en `globalThis.fetch` y responde como la
 * documentación pública de Didit (22-oct-2026). Lo comparten las pruebas del proveedor y las de la persona.
 * También captura los correos que saldrían por Resend. Datos sintéticos: ningún documento real.
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { canonizar } from '../../../src/modules/identidad/proveedor/diditMapeo'

// ── El Didit falso ──────────────────────────────────────────────────────────

export interface SesionFalsa {
  id: string
  token: string
  vendorData: string
  status: string
  riesgos: string[]
  /** ¿trae documento + vida + rostro aprobados cuando se aprueba? */
  completa: boolean
  cedula: string | null
  borrada: boolean
  callback: string
}
export interface Llamada {
  metodo: string
  ruta: string
  cuerpo: Record<string, unknown> | null
  apiKey: string | null
  redirect: string | undefined
}

export class DiditFalso {
  constructor(private readonly sufijo: string) {}

  sesiones = new Map<string, SesionFalsa>()
  llamadas: Llamada[] = []
  /** Los correos que habría enviado Resend (con RESEND_API_KEY puesta en la prueba). */
  correos: Record<string, unknown>[] = []
  /** Las próximas N llamadas responden 503. */
  caidas = 0
  /** Todas las llamadas responden este estado (p. ej. 401). */
  siempre: number | null = null
  private aprobaciones = 0

  manejar = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url)
    const metodo = (init?.method ?? 'GET').toUpperCase()
    const cuerpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const cabeceras = (init?.headers ?? {}) as Record<string, string>
    this.llamadas.push({ metodo, ruta: url.pathname, cuerpo, apiKey: cabeceras['x-api-key'] ?? null, redirect: init?.redirect })
    if (url.hostname === 'api.resend.com') {
      this.correos.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ id: 'correo-sintetico' }), { status: 200 })
    }
    if (this.caidas > 0) {
      this.caidas--
      return new Response('{"detail":"caido"}', { status: 503 })
    }
    if (this.siempre !== null) return new Response('{"detail":"no"}', { status: this.siempre })
    const json = (status: number, o: unknown) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

    if (metodo === 'POST' && url.pathname === '/v3/session/') {
      const vendorData = String(cuerpo?.vendor_data ?? '')
      // Idempotente: la misma referencia devuelve la sesión SIN TERMINAR.
      let s = [...this.sesiones.values()].find((x) => x.vendorData === vendorData && ['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted'].includes(x.status))
      if (!s) {
        s = { id: randomUUID(), token: randomBytes(12).toString('hex'), vendorData, status: 'Not Started', riesgos: [], completa: true, cedula: null, borrada: false, callback: String(cuerpo?.callback ?? '') }
        this.sesiones.set(s.id, s)
      }
      return json(201, { session_id: s.id, url: `https://verification.didit.me/session/${s.token}`, status: s.status, vendor_data: s.vendorData })
    }
    const m = url.pathname.match(/^\/v3\/session\/([^/]+)\/(decision|delete)\/$/)
    if (m) {
      const s = this.sesiones.get(m[1])
      if (!s || s.borrada) return json(404, { detail: 'not found' })
      if (m[2] === 'decision' && metodo === 'GET') return json(200, this.decisionDe(s))
      if (m[2] === 'delete' && metodo === 'DELETE') {
        s.borrada = true
        return json(200, { session_id: s.id, face_retention_outcome: 'deleted' })
      }
    }
    if (metodo === 'POST' && url.pathname === '/v3/users/delete/') return json(200, { ok: true })
    return json(404, { detail: 'ruta desconocida' })
  }

  private decisionDe(s: SesionFalsa): Record<string, unknown> {
    const base = { session_id: s.id, status: s.status, vendor_data: s.vendorData, workflow_id: 'wf' }
    const aviso = (risk: string) => ({ risk, log_type: 'error', short_description: 'x' })
    if (s.status === 'Approved') {
      return {
        ...base,
        id_verifications: [{ node_id: 'n1', status: 'Approved', document_type: 'Identity Card', issuing_state: 'DOM', personal_number: s.cedula, document_number: 'T-0001', warnings: [] }],
        liveness_checks: s.completa ? [{ node_id: 'n2', status: 'Approved', score: 99, warnings: [] }] : null,
        face_matches: s.completa ? [{ node_id: 'n3', status: 'Approved', score: 93, warnings: [] }] : null,
      }
    }
    if (s.status === 'Declined' || s.status === 'In Review') {
      return { ...base, id_verifications: [{ node_id: 'n1', status: s.status, warnings: s.riesgos.map(aviso) }], liveness_checks: null, face_matches: null }
    }
    return base
  }

  // ── Para dirigir el escenario ──
  sesionDe(intentoId: string): SesionFalsa {
    const s = [...this.sesiones.values()].find((x) => x.vendorData === intentoId)
    assert.ok(s, `el proveedor no tiene sesión para ${intentoId}`)
    return s
  }
  aprobar(intentoId: string, opciones: { cedula?: string; completa?: boolean } = {}): SesionFalsa {
    const s = this.sesionDe(intentoId)
    s.status = 'Approved'
    s.cedula = opciones.cedula ?? `001-${this.sufijo}-${++this.aprobaciones}`
    s.completa = opciones.completa ?? true
    return s
  }
  poner(intentoId: string, status: string, riesgos: string[] = []): SesionFalsa {
    const s = this.sesionDe(intentoId)
    s.status = status
    s.riesgos = riesgos
    return s
  }
  cuantas(metodo: string, fragmento?: string): number {
    return this.llamadas.filter((l) => l.metodo === metodo && (!fragmento || l.ruta.includes(fragmento))).length
  }
  reiniciarLlamadas(): void {
    this.llamadas = []
  }
}

/** Un aviso FIRMADO como lo manda Didit (V2, sobre el cuerpo canónico). */
export function crearAvisoFirmado(secretoPorDefecto: string) {
  return function avisoFirmado(
  s: { id: string; vendorData: string },
  opciones: { estado?: string; tipo?: string; eventoId?: string; instante?: Date; secreto?: string; sesionId?: string } = {}
) {
  const cuerpo = {
    event_id: opciones.eventoId ?? randomUUID(),
    webhook_type: opciones.tipo ?? 'status.updated',
    timestamp: Math.floor((opciones.instante ?? new Date()).getTime() / 1000),
    session_id: opciones.sesionId ?? s.id,
    status: opciones.estado ?? 'Approved',
    vendor_data: s.vendorData,
    environment: 'sandbox',
    decision: { id_verifications: [{ document_number: 'NO-DEBE-GUARDARSE', score: 100.0 }] },
  }
  const crudo = JSON.stringify(cuerpo)
  const firma = createHmac('sha256', opciones.secreto ?? secretoPorDefecto).update(canonizar(cuerpo), 'utf8').digest('hex')
  return { cuerpoCrudo: crudo, cabeceras: { 'x-signature-v2': firma, 'x-timestamp': String(cuerpo.timestamp) } as Record<string, string | null>, cuerpo }
}
}
