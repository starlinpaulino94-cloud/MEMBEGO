import { Badge } from '@/components/ui/badge'

/**
 * El estado de una empresa, con LAS MISMAS PALABRAS en todo el sistema.
 *
 * El Centro de control decía «Inactiva» y el CRM «Suspendida» para el mismo
 * `isActive: false`. Dos palabras para un solo booleano obligan a traducir
 * mentalmente entre dos pantallas del mismo panel, y en una conversación por
 * teléfono con un cliente son dos cosas distintas.
 *
 * SON DOS EJES, NO UNO. Antes compartían un único hueco y la insignia de estado
 * tapaba la de visibilidad:
 *
 *   · ACTIVA / SUSPENDIDA  — si el negocio opera. Lo decide la plataforma.
 *   · PUBLICADA / SIN PUBLICAR — si aparece en el marketplace. Lo decide su
 *     ficha estar completa.
 *
 * Una empresa activa pero sin publicar es un caso muy real —acaba de darse de
 * alta y le falta el logo— y se veía idéntica a una publicada. Esa diferencia es
 * justo la que explica por qué sus clientes no la encuentran.
 *
 * La de práctica se marca aparte y se traga las otras dos: lo único que importa
 * de una empresa demo es que es demo.
 */
export const ESTADO_EMPRESA_LABEL = {
  activa: 'Activa',
  suspendida: 'Suspendida',
  publicada: 'Publicada',
  sinPublicar: 'Sin publicar',
  demo: 'Demo',
  practica: 'Práctica',
} as const

/**
 * Un solo estado, el que hay que atender primero: práctica, luego suspendida, luego sin publicar. Para las listas
 * densas (la tabla de Empresas), donde dos insignias por fila se leían como ruido.
 */
export function estadoUnicoEmpresa(e: { isActive: boolean; isPublished: boolean; esDemo: boolean }): {
  etiqueta: string
  variante: 'success' | 'warning' | 'destructive'
} {
  if (e.esDemo) return { etiqueta: ESTADO_EMPRESA_LABEL.practica, variante: 'warning' }
  if (!e.isActive) return { etiqueta: ESTADO_EMPRESA_LABEL.suspendida, variante: 'destructive' }
  if (!e.isPublished) return { etiqueta: ESTADO_EMPRESA_LABEL.sinPublicar, variante: 'warning' }
  return { etiqueta: ESTADO_EMPRESA_LABEL.publicada, variante: 'success' }
}

export function EstadoEmpresa({
  isActive,
  isPublished,
  esDemo,
  /** En listas densas basta con lo que NO es normal. */
  soloExcepciones = false,
  /** Una sola insignia (ver `estadoUnicoEmpresa`). */
  unico = false,
}: {
  isActive: boolean
  isPublished: boolean
  esDemo: boolean
  soloExcepciones?: boolean
  unico?: boolean
}) {
  if (unico) {
    const estado = estadoUnicoEmpresa({ isActive, isPublished, esDemo })
    return <Badge variant={estado.variante}>{estado.etiqueta}</Badge>
  }

  if (esDemo) {
    return <Badge variant="warning">{ESTADO_EMPRESA_LABEL.demo}</Badge>
  }

  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {!isActive ? (
        <Badge variant="destructive">{ESTADO_EMPRESA_LABEL.suspendida}</Badge>
      ) : soloExcepciones ? null : (
        <Badge variant="success">{ESTADO_EMPRESA_LABEL.activa}</Badge>
      )}
      {!isPublished ? (
        <Badge variant="warning">{ESTADO_EMPRESA_LABEL.sinPublicar}</Badge>
      ) : soloExcepciones ? null : (
        <Badge variant="secondary">{ESTADO_EMPRESA_LABEL.publicada}</Badge>
      )}
    </span>
  )
}
