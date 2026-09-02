import { CODIGOS_ERROR } from './errores'
import { INVENTARIO_API, type RecursoApi } from './inventario'

/**
 * CONTRATOS · OpenAPI 3.1 generado desde el INVENTARIO.
 *
 * Se genera, no se escribe: un OpenAPI mantenido a mano se separa del código
 * a la tercera semana, y entonces es peor que no tenerlo — quien integra
 * confía en él y falla por una razón que no aparece en ningún sitio.
 *
 * Deliberadamente NO describe los esquemas de respuesta campo a campo. Eso
 * sería prometer una forma exacta que hoy no está congelada, y una promesa
 * rota en un contrato público cuesta más que una descripción incompleta. Lo
 * que sí describe con precisión es lo que quien integra necesita para empezar:
 * qué recursos hay, qué permiso pide cada uno, cómo autenticarse y qué errores
 * puede recibir.
 */

const BASE = '/api/platform/v1'

interface Operacion {
  summary: string
  operationId: string
  security: Record<string, string[]>[]
  parameters?: unknown[]
  responses: Record<string, unknown>
  tags: string[]
}

function idDeOperacion(r: RecursoApi): string {
  const limpio = r.ruta.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `${r.metodo.toLowerCase()}_${limpio || 'raiz'}`
}

function etiqueta(ruta: string): string {
  const primera = ruta.split('/').filter(Boolean)[0] ?? 'general'
  return primera.replace(/[{}.]/g, '')
}

/** Los parámetros de ruta que la propia ruta declara (`{id}`). */
function parametrosDeRuta(ruta: string): unknown[] {
  return [...ruta.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
}

function respuestas(r: RecursoApi): Record<string, unknown> {
  const salida: Record<string, unknown> = {
    '200': { description: 'Correcto.' },
    '401': { description: 'Falta el token o la clave, o no es válida.', ...refError() },
    '429': { description: 'Demasiadas peticiones.', ...refError() },
  }
  if (r.scope) {
    salida['403'] = { description: 'El permiso concedido no incluye el scope requerido.', ...refError() }
  }
  if (r.principal === 'sistema-o-empresa' || r.principal === 'sistema') {
    salida['403'] = { description: 'Sin permiso sobre esa empresa, o principal no admitido.', ...refError() }
  }
  if (r.idempotente) {
    salida['400'] = { description: 'Falta la cabecera Idempotency-Key, o se reutilizó con otro cuerpo.', ...refError() }
  }
  return salida
}

function refError() {
  return {
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  }
}

function seguridadDe(r: RecursoApi): Record<string, string[]>[] {
  switch (r.principal) {
    case 'publico':
      return []
    case 'sistema':
      return [{ tokenDeSistema: r.scope ? [r.scope] : [] }]
    case 'sistema-o-empresa':
      // Dos alternativas, no dos requisitos: en OpenAPI, entradas distintas
      // del array son un O lógico.
      return [{ tokenDeSistema: r.scope ? [r.scope] : [] }, { claveDeEmpresa: [] }]
    case 'superadmin':
      return [{ sesionDeSuperadmin: [] }]
  }
}

export function generarOpenApi(servidor: string): Record<string, unknown> {
  const paths: Record<string, Record<string, Operacion>> = {}

  for (const r of INVENTARIO_API) {
    // Lo que pide sesión de superadmin es operación de la plataforma, no
    // contrato público: no se documenta como si alguien pudiera construir
    // encima. Hoy no queda ninguna ruta así —`/diag` era la última y se borró
    // en la #440—, pero la regla se queda: sin ella, la siguiente entraría
    // sola en el OpenAPI público.
    if (r.principal === 'superadmin') continue

    const ruta = r.ruta
    paths[ruta] ??= {}
    const parametros = parametrosDeRuta(ruta)
    if (r.idempotente) {
      parametros.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description:
          'Identificador único de ESTA operación. Repetir la llamada con la misma clave devuelve la misma respuesta sin volver a ejecutar nada.',
        schema: { type: 'string' },
      })
    }
    paths[ruta][r.metodo.toLowerCase()] = {
      summary: r.resumen,
      operationId: idDeOperacion(r),
      security: seguridadDe(r),
      ...(parametros.length ? { parameters: parametros } : {}),
      responses: respuestas(r),
      tags: [etiqueta(ruta)],
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MembeGo · API de plataforma',
      version: '1.0.0',
      description:
        'API con la que un sistema satélite o un tercero autorizado consulta y escribe datos de UNA empresa. ' +
        'Las respuestas no se describen campo a campo a propósito: su forma todavía puede crecer, y una promesa ' +
        'rota en un contrato público cuesta más que una descripción incompleta.',
    },
    servers: [{ url: `${servidor}${BASE}` }],
    components: {
      securitySchemes: {
        tokenDeSistema: {
          type: 'oauth2',
          description:
            'Credencial de un sistema satélite. Pide un token en POST /oauth/token y mándalo como Bearer.',
          flows: {
            clientCredentials: {
              tokenUrl: `${servidor}${BASE}/oauth/token`,
              scopes: {},
            },
          },
        },
        claveDeEmpresa: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Clave de API de UNA empresa (empieza por mbk_). La empresa va atada a la clave: no hace falta ' +
            'mandar companyId, y si se manda, debe coincidir.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: Object.keys(CODIGOS_ERROR) },
                message: { type: 'string' },
                requestId: {
                  type: 'string',
                  description: 'Va también en la cabecera X-Request-Id. Guárdalo en tu log.',
                },
                requiredScope: { type: 'string' },
              },
              required: ['code', 'message', 'requestId'],
            },
          },
        },
      },
    },
    paths,
  }
}
