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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN ÁRBOL, DOS VOCABULARIOS (hallazgo A-4)
 *
 * La misma pregunta se la hacen dos personas muy distintas: el superadmin, que
 * habla con el equipo del satélite y quiere oír «falta el handler POST en
 * route.ts», y la dueña de un negocio, que puso la URL de su propio servidor en
 * `/admin/integraciones` y a quien «exportar POST» no le dice absolutamente
 * nada.
 *
 * `clasificarSonda` decide QUÉ pasó y es la única que lo decide; `diagnosticar`
 * y `diagnosticarParaEmpresa` solo lo CUENTAN, cada una en su idioma. Duplicar
 * el árbol para cambiar las palabras habría dado dos verdades sobre el mismo
 * 404 — y la que primero se queda vieja es siempre la que menos se mira.
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
 * QUÉ PASÓ, sin decir aún a quién se lo contamos.
 *
 * Es el árbol de decisión entero y el único sitio donde se decide. Cada caso
 * lleva lo que las dos redacciones necesitan (el código, el cuerpo) para que
 * ninguna tenga que volver a mirar las respuestas crudas y sacar su propia
 * conclusión.
 */
export type CasoSonda =
  | { caso: 'sin_conexion'; error?: string }
  | { caso: 'entregado'; status: number }
  | { caso: 'dominio_sin_app' }
  | { caso: 'ruta_inexistente' }
  | { caso: 'handler_404' }
  | { caso: 'firma_rechazada'; status: number }
  | { caso: 'sin_post'; status: number }
  | { caso: 'error_interno'; status: number }
  | { caso: 'inesperado'; status: number; cuerpo: string }

/**
 * Clasifica el par (GET, POST).
 *
 * El GET no se hace por capricho: en Next.js una ruta que solo exporta `POST`
 * responde **405** a un GET. Por eso el GET es la pregunta «¿existe el
 * archivo?» y el POST es «¿funciona?». Cruzarlos separa el problema de ruta
 * del problema de handler, que es justo lo que un 404 a secas esconde.
 */
export function clasificarSonda(get: RespuestaSonda, post: RespuestaSonda): CasoSonda {
  // 1. Ni respuesta: el problema es de red/DNS, ni siquiera se llegó a la app.
  if (post.status === 0) return { caso: 'sin_conexion', error: post.error }

  // 2. Entregado: no hay nada que diagnosticar.
  if (llego(post.status)) return { caso: 'entregado', status: post.status }

  // 3. 404 en ambos con cuerpo de plataforma: el dominio no sirve la app.
  if (
    post.status === 404 &&
    (esCuerpoDePlataforma(post.cuerpo) || esCuerpoDePlataforma(get.cuerpo))
  ) {
    return { caso: 'dominio_sin_app' }
  }

  // 4. 404 en el POST y 404 en el GET: la app está viva pero la ruta no existe.
  if (post.status === 404 && get.status === 404) return { caso: 'ruta_inexistente' }

  // 5. El GET dice que la ruta existe (405) pero el POST da 404: el 404 lo
  //    produce el propio handler, no el enrutador. Es un caso distinto y se
  //    confunde muy fácil con el anterior.
  if (post.status === 404 && get.status === 405) return { caso: 'handler_404' }

  // 6. 401/403: la ruta está y el problema es la firma → el secreto.
  if (post.status === 401 || post.status === 403) {
    return { caso: 'firma_rechazada', status: post.status }
  }

  // 7. 405 al POST: la ruta existe pero no acepta POST.
  if (post.status === 405) return { caso: 'sin_post', status: post.status }

  // 8. 5xx: la ruta está y revienta. Es progreso respecto a un 404.
  if (post.status >= 500) return { caso: 'error_interno', status: post.status }

  return { caso: 'inesperado', status: post.status, cuerpo: post.cuerpo }
}

/**
 * EL IDIOMA DEL SUPERADMIN: habla con el equipo del satélite, así que los
 * próximos pasos nombran archivos, handlers y despliegues.
 */
export function diagnosticarSonda(get: RespuestaSonda, post: RespuestaSonda): Diagnostico {
  const c = clasificarSonda(get, post)
  switch (c.caso) {
    case 'sin_conexion':
      return {
        gravedad: 'falla',
        titulo: 'No se pudo conectar con el satélite',
        detalle: c.error
          ? `El servidor no obtuvo respuesta: ${c.error}`
          : 'El servidor no obtuvo respuesta.',
        siguiente:
          'Revisa que el dominio exista y tenga certificado. Es un problema de DNS o del proveedor, no del código.',
      }
    case 'entregado':
      return {
        gravedad: 'ok',
        titulo: `El webhook responde ${c.status}`,
        detalle: 'El satélite aceptó el POST firmado.',
        siguiente: 'Fuerza el reenvío de los eventos pendientes y confirma que pasen a ENVIADO.',
      }
    case 'dominio_sin_app':
      return {
        gravedad: 'falla',
        titulo: 'El dominio no está atado a ningún despliegue',
        detalle:
          'La respuesta viene de la plataforma de alojamiento, no de la aplicación: no hay app sirviendo ese dominio.',
        siguiente:
          'Que el equipo del satélite conecte el dominio a su proyecto y vuelva a desplegar. Nada que tocar en MembeGo.',
      }
    case 'ruta_inexistente':
      return {
        gravedad: 'falla',
        titulo: 'La ruta del webhook no existe',
        detalle:
          'La URL responde 404 tanto a GET como a POST: el dominio sirve una aplicación, pero no tiene ese endpoint.',
        siguiente:
          'Del lado del satélite: crear `app/api/membego/webhook/route.ts` exportando `export async function POST(req)` — con nombre, no `export default` — y desplegar.',
      }
    case 'handler_404':
      return {
        gravedad: 'falla',
        titulo: 'La ruta existe, pero el handler responde 404',
        detalle:
          'El GET devuelve 405 (la ruta está y solo acepta POST), pero el POST devuelve 404: el 404 lo está devolviendo el código del handler, no el enrutador.',
        siguiente:
          'Del lado del satélite: revisar qué devuelve 404 dentro del handler — normalmente una empresa no encontrada o un tipo de evento desconocido.',
      }
    case 'firma_rechazada':
      return {
        gravedad: 'falla',
        titulo: 'La ruta existe y rechaza la firma',
        detalle: `El POST devolvió ${c.status}: el satélite recibió la petición y no aceptó el HMAC.`,
        siguiente:
          'Comparen el largo y el md5 del secreto a ambos lados, y confirmen que el HMAC se calcula sobre el cuerpo crudo exacto, sin volver a serializar el JSON.',
      }
    case 'sin_post':
      return {
        gravedad: 'falla',
        titulo: 'La ruta no acepta POST',
        detalle: 'El POST devolvió 405: el archivo de ruta existe pero no exporta un handler POST.',
        siguiente: 'Del lado del satélite: exportar `POST` en ese archivo de ruta.',
      }
    case 'error_interno':
      return {
        gravedad: 'falla',
        titulo: 'La ruta existe pero falla al procesar',
        detalle: `El POST devolvió ${c.status}: la petición llegó al código del satélite y ahí explotó.`,
        siguiente:
          'Del lado del satélite: revisar los logs de esa función. La conexión ya está bien; el fallo es interno.',
      }
    case 'inesperado':
      return {
        gravedad: 'falla',
        titulo: `El webhook respondió ${c.status}`,
        detalle: c.cuerpo
          ? `Respuesta inesperada. Cuerpo: ${c.cuerpo}`
          : 'Respuesta inesperada, sin cuerpo.',
        siguiente: 'Manda este código y este cuerpo al equipo del satélite.',
      }
  }
}

/**
 * EL IDIOMA DE LA EMPRESA: la URL es de SU servidor, así que el próximo paso
 * siempre es algo que ella o su programador pueden hacer.
 *
 * Tres reglas que esta redacción cumple y la otra no:
 *
 *  1. NO se dice «satélite», «handler» ni «enrutador». Son palabras de quien
 *     escribió el servidor, y quien lee esto puede no serlo.
 *  2. El próximo paso dice a QUIÉN le toca cuando no le toca a ella. «Pásale
 *     esto a quien programó tu servidor» es una respuesta útil; «revisar el
 *     handler» a una dueña de salón no lo es.
 *  3. NUNCA se sugiere tocar nada de Membego cuando el problema es del otro
 *     lado. Si no, el siguiente paso es un ticket de soporte a nosotros.
 */
export function diagnosticarParaEmpresa(
  get: RespuestaSonda,
  post: RespuestaSonda
): Diagnostico {
  const c = clasificarSonda(get, post)
  switch (c.caso) {
    case 'sin_conexion':
      return {
        gravedad: 'falla',
        titulo: 'No pudimos conectar con tu servidor',
        detalle: c.error
          ? `No hubo respuesta desde esa dirección: ${c.error}`
          : 'No hubo respuesta desde esa dirección.',
        siguiente:
          'Comprueba que la dirección esté bien escrita, que el dominio siga activo y que tenga certificado de seguridad (https).',
      }
    case 'entregado':
      return {
        gravedad: 'ok',
        titulo: 'Tu servidor recibió la prueba',
        detalle: `Respondió ${c.status}: la prueba llegó y la aceptó, firma incluida.`,
        siguiente: 'No hay nada que hacer. Los eventos de verdad llegarán igual que esta prueba.',
      }
    case 'dominio_sin_app':
      return {
        gravedad: 'falla',
        titulo: 'Ese dominio no tiene ninguna aplicación',
        detalle:
          'La respuesta viene del proveedor donde está alojado el dominio, no de un programa tuyo: ahí no hay nada escuchando.',
        siguiente:
          'Confirma con quien administra tu servidor que la aplicación está publicada en ese dominio.',
      }
    case 'ruta_inexistente':
      return {
        gravedad: 'falla',
        titulo: 'Esa dirección no existe en tu servidor',
        detalle:
          'El dominio responde, pero en esa dirección concreta no hay nada. Suele ser una errata en la ruta.',
        siguiente:
          'Revisa la dirección que escribiste. Si está bien, pídele a quien programó tu servidor que la ponga a escuchar ahí.',
      }
    case 'handler_404':
      return {
        gravedad: 'falla',
        titulo: 'Tu servidor recibió la prueba y la rechazó',
        detalle:
          'La dirección existe y la prueba llegó, pero tu programa respondió que no encuentra algo.',
        siguiente:
          'Pásale esto a quien programó tu servidor: la conexión funciona, el rechazo viene de dentro de su código.',
      }
    case 'firma_rechazada':
      return {
        gravedad: 'falla',
        titulo: 'Tu servidor no aceptó nuestra firma',
        detalle: `Respondió ${c.status}: recibió la prueba y no reconoció el secreto con el que la firmamos.`,
        siguiente:
          'Copia otra vez el secreto de este webhook en tu servidor, sin espacios ni saltos de línea al final. La firma se calcula sobre el cuerpo tal cual llega, sin volver a convertirlo.',
      }
    case 'sin_post':
      return {
        gravedad: 'falla',
        titulo: 'Esa dirección no acepta envíos',
        detalle:
          'La dirección existe, pero solo admite consultas y no envíos. Los avisos se mandan como envío (POST).',
        siguiente: 'Pídele a quien programó tu servidor que acepte peticiones POST en esa dirección.',
      }
    case 'error_interno':
      return {
        gravedad: 'falla',
        titulo: 'Tu servidor recibió la prueba y falló',
        detalle: `Respondió ${c.status}: la prueba llegó a tu programa y ahí se produjo un error.`,
        siguiente:
          'La conexión ya está bien. Pásale el código de error a quien programó tu servidor para que mire sus registros.',
      }
    case 'inesperado':
      return {
        gravedad: 'falla',
        titulo: `Tu servidor respondió ${c.status}`,
        detalle: c.cuerpo
          ? `Esperábamos una confirmación y respondió otra cosa: ${c.cuerpo}`
          : 'Esperábamos una confirmación y respondió otra cosa, sin explicación.',
        siguiente: 'Pásale este código y esta respuesta a quien programó tu servidor.',
      }
  }
}

/**
 * Ancla de la tarjeta de un sistema dentro del panel.
 *
 * Vive en el módulo puro para que la usen los dos lados: la tarjeta (cliente)
 * la pone y el aviso de cabecera (servidor) enlaza a ella. Escrita dos veces
 * sería exactamente el tipo de cadena que se desincroniza en silencio — el
 * enlace no rompe nada, solo deja de llevar a ningún sitio.
 */
export function anclaSistema(slug: string): string {
  return `sistema-${slug.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
