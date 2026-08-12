/**
 * Cuándo una empresa está «en silencio». Módulo PURO y compartido.
 *
 * El «hace X» que acompaña a este dato NO vive aquí: está en `@/lib/plural`,
 * porque ya lo piden tres pantallas y ninguna de ellas es de empresas.
 *
 * Lo usan el Centro de control (para el aviso y para marcar las tarjetas) y el
 * CRM de empresas (para el filtro y el orden). Vive aquí, en el dominio de
 * empresas, y no en el módulo del panel de plataforma: un dato de negocio no
 * debe obligar a importar un módulo `server-only` solo para leer un número.
 *
 * FIJO Y NO ATADO AL PERIODO QUE SE ESTÉ MIRANDO. El aviso tiene que significar
 * lo mismo con 7 días en pantalla que con 90. Si dependiera del selector,
 * cambiar el periodo cambiaría cuántas empresas «están en silencio», y ese es
 * exactamente el tipo de número que la gente deja de creerse.
 */
export const DIAS_SILENCIO = 14

/**
 * Regla única: sin señal de vida en `DIAS_SILENCIO`, estando ACTIVA.
 *
 * Lo de «activa» no es un detalle: una empresa dada de baja no está en
 * silencio, está cerrada. Mezclarlas convertiría el aviso en ruido permanente,
 * que es como muere un aviso.
 *
 * Se decide en un solo sitio porque el número del aviso y el resalte de cada
 * tarjeta tienen que coincidir siempre. Con la regla escrita dos veces, el día
 * que una cambie el panel dirá «3 en silencio» y solo dos tarjetas saldrán
 * marcadas — y nadie sabrá cuál de las dos miente.
 */
export function estaEnSilencio(
  opciones: { isActive: boolean; ultimaActividad: Date | null },
  ahora: Date = new Date()
): boolean {
  if (!opciones.isActive) return false
  if (!opciones.ultimaActividad) return true
  return ahora.getTime() - opciones.ultimaActividad.getTime() > DIAS_SILENCIO * 86_400_000
}
