/**
 * Integraciones · DIAGNÓSTICO DE LA SONDA — núcleo puro.
 *
 * Por qué existe: cuando el webhook de un satélite falla, lo único que guarda
 * el outbox es `HTTP 404`. Ese número solo, sin cuerpo, no distingue tres
 * problemas que se arreglan de formas MUY distintas:
 *
 *   · el dominio no apunta a ningún despliegue     → lo arregla el DNS/Vercel
 *   · el dominio sirve la app pero la ruta no está → lo arregla el código
 *   · la ruta está y rechaza el POST               → lo arregla el secreto
 *
 * Tres días parados por no poder distinguirlos. Este módulo convierte dos
 * respuestas crudas (un GET y un POST a la misma URL) en una frase que dice
 * QUÉ pasa y A QUIÉN le toca. Sin red ni Prisma: se prueba entero.
 */

/** Lo que se obtuvo al tocar la URL. `status: 0` = ni siquiera hubo respuesta. */
export interface RespuestaSonda {
  status: number
  /** Primeros caracteres del cuerpo: sirve para reconocer páginas de error. */
  cuerpo: string
  /** Mensaje de red cuando no hubo respuesta (DNS, TLS, timeout). */
  error?: string
}

export type Gravedad = 'ok' | 'aviso' | 'falla'

export interface Diagnostico {
  gravedad: Gravedad
  /** Qué está pasando, en una línea. */
  titulo: string
  /** Por qué se concluye eso, a partir de lo que respondió el servidor. */
  detalle: string
  /** Qué hacer ahora, y de qué lado. */
  siguiente: string
}

/** Un 2xx es lo único que cuenta como entrega. */
function llego(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Vercel devuelve 404 con un código propio cuando el dominio no está atado a
 * ningún despliegue. Ese cuerpo distingue «no hay app» de «hay app sin ruta».
 */
function esCuerpoDePlataforma(cuerpo: string): boolean {
  return /DEPLOYMENT_NOT_FOUND|NOT_FOUND[^A-Za-z]|no such app|The deployment could not be found/i.test(
    cuerpo
  )
}

/**
 * Traduce el par (GET, POST) a un diagnóstico.
 *
 * El GET no se hace por capricho: en Next.js una ruta que solo exporta `POST`
 * responde **405** a un GET. Por eso el GET es la pregunta «¿existe el
 * archivo?» y el POST es «¿funciona?». Cruzarlos separa el problema de ruta
 * del problema de handler, que es justo lo que un 404 a secas esconde.
 */
export function diagnosticarSonda(get: RespuestaSonda, post: RespuestaSonda): Diagnostico {
  // 1. Ni respuesta: el problema es de red/DNS, ni siquiera se llegó a la app.
  if (post.status === 0) {
    return {
      gravedad: 'falla',
      titulo: 'No se pudo conectar con el satélite',
      detalle: post.error
        ? `El servidor no obtuvo respuesta: ${post.error}`
        : 'El servidor no obtuvo respuesta.',
      siguiente:
        'Revisa que el dominio exista y tenga certificado. Es un problema de DNS o del proveedor, no del código.',
    }
  }

  // 2. Entregado: no hay nada que diagnosticar.
  if (llego(post.status)) {
    return {
      gravedad: 'ok',
      titulo: `El webhook responde ${post.status}`,
      detalle: 'El satélite aceptó el POST firmado.',
      siguiente: 'Fuerza el reenvío de los eventos pendientes y confirma que pasen a ENVIADO.',
    }
  }

  // 3. 404 en ambos con cuerpo de plataforma: el dominio no sirve la app.
  if (post.status === 404 && (esCuerpoDePlataforma(post.cuerpo) || esCuerpoDePlataforma(get.cuerpo))) {
    return {
      gravedad: 'falla',
      titulo: 'El dominio no está atado a ningún despliegue',
      detalle:
        'La respuesta viene de la plataforma de alojamiento, no de la aplicación: no hay app sirviendo ese dominio.',
      siguiente:
        'Que el equipo del satélite conecte el dominio a su proyecto y vuelva a desplegar. Nada que tocar en MembeGo.',
    }
  }

  // 4. 404 en el POST y 404 en el GET: la app está viva pero la ruta no existe.
  if (post.status === 404 && get.status === 404) {
    return {
      gravedad: 'falla',
      titulo: 'La ruta del webhook no existe',
      detalle:
        'La URL responde 404 tanto a GET como a POST: el dominio sirve una aplicación, pero no tiene ese endpoint.',
      siguiente:
        'Del lado del satélite: crear `app/api/membego/webhook/route.ts` exportando `export async function POST(req)` — con nombre, no `export default` — y desplegar.',
    }
  }

  // 5. El GET dice que la ruta existe (405) pero el POST da 404: el 404 lo
  //    produce el propio handler, no el enrutador. Es un caso distinto y se
  //    confunde muy fácil con el anterior.
  if (post.status === 404 && get.status === 405) {
    return {
      gravedad: 'falla',
      titulo: 'La ruta existe, pero el handler responde 404',
      detalle:
        'El GET devuelve 405 (la ruta está y solo acepta POST), pero el POST devuelve 404: el 404 lo está devolviendo el código del handler, no el enrutador.',
      siguiente:
        'Del lado del satélite: revisar qué devuelve 404 dentro del handler — normalmente una empresa no encontrada o un tipo de evento desconocido.',
    }
  }

  // 6. 401/403: la ruta está y el problema es la firma → el secreto.
  if (post.status === 401 || post.status === 403) {
    return {
      gravedad: 'falla',
      titulo: 'La ruta existe y rechaza la firma',
      detalle: `El POST devolvió ${post.status}: el satélite recibió la petición y no aceptó el HMAC.`,
      siguiente:
        'Comparen el largo y el md5 del secreto a ambos lados, y confirmen que el HMAC se calcula sobre el cuerpo crudo exacto, sin volver a serializar el JSON.',
    }
  }

  // 7. 405 al POST: la ruta existe pero no acepta POST.
  if (post.status === 405) {
    return {
      gravedad: 'falla',
      titulo: 'La ruta no acepta POST',
      detalle: 'El POST devolvió 405: el archivo de ruta existe pero no exporta un handler POST.',
      siguiente: 'Del lado del satélite: exportar `POST` en ese archivo de ruta.',
    }
  }

  // 8. 5xx: la ruta está y revienta. Es progreso respecto a un 404.
  if (post.status >= 500) {
    return {
      gravedad: 'falla',
      titulo: 'La ruta existe pero falla al procesar',
      detalle: `El POST devolvió ${post.status}: la petición llegó al código del satélite y ahí explotó.`,
      siguiente:
        'Del lado del satélite: revisar los logs de esa función. La conexión ya está bien; el fallo es interno.',
    }
  }

  return {
    gravedad: 'falla',
    titulo: `El webhook respondió ${post.status}`,
    detalle: post.cuerpo
      ? `Respuesta inesperada. Cuerpo: ${post.cuerpo}`
      : 'Respuesta inesperada, sin cuerpo.',
    siguiente: 'Manda este código y este cuerpo al equipo del satélite.',
  }
}
