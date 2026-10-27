/**
 * LA MARCA DE «VENGO DEL ASISTENTE» (auditoría admin · fase 7, 7.5). Módulo aparte y sin dependencias porque lo usan el servidor (los
 * enlaces de cada paso, `onboarding.ts`) y el navegador (la franja `RetornoAlAsistente`): importarlo desde `onboarding.ts` arrastraría la
 * base de datos al cliente.
 */
export const PARAM_DESDE_ONBOARDING = 'desde'
export const VALOR_DESDE_ONBOARDING = 'onboarding'

/** El mismo enlace con la marca de «vengo del asistente», conservando lo que ya trae (consulta y ancla). */
export function conRetornoAlAsistente(href: string): string {
  const [sinAncla = '', ...ancla] = href.split('#')
  const [ruta = '', consulta = ''] = sinAncla.split('?')
  const params = new URLSearchParams(consulta)
  params.set(PARAM_DESDE_ONBOARDING, VALOR_DESDE_ONBOARDING)
  return `${ruta}?${params.toString()}${ancla.length ? `#${ancla.join('#')}` : ''}`
}
