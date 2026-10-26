import { registrarEvento, aEtiqueta } from '@/modules/observabilidad/eventos'

/**
 * ACCESOS A LAS RUTAS QUE LA CONSOLIDACIÓN DEL MENÚ DEJÓ SIN ENTRADA (auditoría admin · fase 6, tarea 6.4; 03 · D.4).
 *
 * La auditoría propone retirar cuatro rutas —`/admin/whatsapp` (una redirección), `/admin/campanas` como módulo,
 * `/admin/excursiones/reportes` y `/admin/referidos`— «previa verificación de uso en producción». Esa verificación no se puede hacer
 * desde un asistente: hace falta saber si alguien las abre. Esto es el instrumento: cada acceso deja un evento estructurado
 * (`navegacion · ruta_legada`) que se puede contar en el log, y NINGUNA de las cuatro cambia de comportamiento ni de destino.
 *
 * Qué decide el dueño con el dato: si en unas semanas una ruta no registra accesos, se convierte en redirección; si los registra,
 * se queda donde está (sigue siendo una pestaña de su módulo). Retirar una pantalla que alguien usa es lo que NO se hace aquí.
 *
 * El evento no lleva persona: solo la ruta, en etiqueta, y la empresa (`companyId` es el único identificador que admiten los
 * eventos). Nunca lanza: observar no puede tumbar la pantalla que observa.
 */
export const RUTAS_LEGADAS = [
  '/admin/whatsapp',
  '/admin/campanas',
  '/admin/excursiones/reportes',
  '/admin/referidos',
] as const

export type RutaLegada = (typeof RUTAS_LEGADAS)[number]

export function registrarAccesoLegado(ruta: RutaLegada, companyId?: string | null): void {
  registrarEvento({
    dominio: 'navegacion',
    accion: 'ruta_legada',
    ok: true,
    companyId: companyId ?? null,
    extra: { ruta: aEtiqueta(ruta) },
  })
}
