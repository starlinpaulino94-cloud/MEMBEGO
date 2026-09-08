import type { Segmentacion } from './esquema'
import { calcularDistanciaM } from '@/modules/geo/cercanos/distancia'

export interface ContextoAudienciaHome {
  readonly membresiaActiva: boolean
  readonly ubicacion: { readonly latitud: number; readonly longitud: number } | null
  readonly centro: { readonly latitud: number; readonly longitud: number } | null
}

/**
 * ¿Esta persona entra en el segmento de la composición publicada?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL RADIO SOLO PUEDE EXCLUIR A QUIEN SABEMOS DÓNDE ESTÁ
 *
 * La primera versión devolvía `false` cuando faltaba la ubicación de la
 * persona o las coordenadas del negocio. Con eso, el Inicio publicado quedaba
 * invisible para TODO EL MUNDO menos quien hubiera concedido geolocalización
 * de marketing — y el Inicio caía a la pantalla anterior sin avisar a nadie:
 * el administrador publicaba, veía su vista previa, y el cliente seguía viendo
 * la app vieja.
 *
 * La distancia es un filtro POSITIVO («muéstraselo a quien esté cerca»), no
 * una condición de acceso. Sin uno de los dos puntos no hay distancia que
 * comparar, así que no hay motivo para excluir: la composición es la de SU
 * empresa, y la cercanía solo afina el orden comercial.
 *
 * Lo que sí excluye siempre: la vigencia vencida y el segmento «solo quien
 * todavía no tiene plan».
 */
export function admiteAudienciaHome(segmento: Segmentacion, contexto: ContextoAudienciaHome, ahora: Date): boolean {
  if (segmento.hasta && Date.parse(segmento.hasta) <= ahora.getTime()) return false
  if (segmento.membresia === 'SIN_PLAN' && contexto.membresiaActiva) return false
  if (!contexto.ubicacion || !contexto.centro) return true
  const distancia = calcularDistanciaM(
    contexto.centro.latitud, contexto.centro.longitud,
    contexto.ubicacion.latitud, contexto.ubicacion.longitud,
  )
  // Una distancia que no se puede calcular tampoco es una distancia excesiva.
  if (!Number.isFinite(distancia)) return true
  return distancia <= segmento.radioKm * 1000
}
