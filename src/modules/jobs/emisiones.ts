import type { EmailPayload } from '@/lib/email'
import { encolar } from '@/modules/jobs/cola'

/**
 * EMISORES DE TRABAJO (Fase 4 · Componente 5).
 *
 * Puntos únicos para encolar los trabajos de Fase 4 desde las server actions,
 * sin que cada llamador conozca el catálogo (`tipos.ts`). `encolar` ya degrada
 * a ejecución en línea cuando QStash no está configurado.
 */

/** Correo transaccional fuera del request. Los que NO son de prueba. */
export function encolarEmail(payload: EmailPayload): Promise<'cola' | 'en-linea'> {
  return encolar({
    tipo: 'email',
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    companyId: payload.companyId,
  })
}

/** Cálculo de recompensas de referido para una conversión concreta. */
export function encolarRecompensas(datos: {
  companyId: string
  referenteClienteId: string
  referidoId: string
}): Promise<'cola' | 'en-linea'> {
  return encolar({ tipo: 'recompensas-referido', ...datos })
}
