/**
 * CONTRATOS · el INVENTARIO de la API pública.
 *
 * Una sola fuente que describe cada recurso: método, ruta, scope, qué
 * principal lo puede usar y qué hace. De aquí sale la documentación para
 * desarrolladores Y el OpenAPI que cualquiera puede importar en Zapier, Make o
 * Postman.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESCRITO A MANO Y NO DERIVADO DEL CÓDIGO
 *
 * Derivarlo del código automáticamente parece más limpio y no lo es: el código
 * sabe qué scope pide, pero no sabe explicar QUÉ HACE el recurso ni para qué
 * sirve — y eso es la mitad de una documentación útil. Lo que sí se automatiza
 * es la vigilancia: una prueba compara este inventario con las rutas que hay
 * en el disco, así que una ruta nueva sin documentar rompe la CI. La
 * documentación no se queda vieja porque no puede.
 *
 * En inglés las rutas y los scopes (son el contrato, viajan por el cable); en
 * español los resúmenes, que los lee una persona.
 */

/** Quién puede llamar a un recurso. */
export type PrincipalPermitido =
  /** Solo la credencial OAuth2 de un sistema satélite. */
  | 'sistema'
  /** Un satélite O una clave de API de empresa. */
  | 'sistema-o-empresa'
  /**
   * SOLO una clave de API de empresa.
   *
   * Existe para los recursos que administran la CONFIGURACIÓN de una empresa —
   * sus suscripciones de webhook— y que a un satélite no le corresponden: un
   * sistema que atiende a veinte empresas no tiene por qué poder decidir a
   * quién avisan ellas, ni mucho menos apuntar sus avisos a otro sitio.
   */
  | 'empresa'
  /** Nadie: es público (reparte credenciales o publica claves). */
  | 'publico'
  /** Operación de la plataforma: sesión de superadmin. */
  | 'superadmin'

export interface RecursoApi {
  /**
   * `DELETE` se admite desde que hay un recurso que de verdad se retira (una
   * suscripción de webhook). Antes solo había `GET` y `POST`, y añadirlo por
   * gusto habría sido documentar un verbo que ninguna ruta usaba; hacerlo con
   * un `/delete` al final de la ruta, en cambio, sería entrenar a quien importe
   * este OpenAPI a escribir una API que no es la que queremos tener.
   */
  metodo: 'GET' | 'POST' | 'DELETE'
  /** Ruta bajo `/api/platform/v1`, con `{id}` para los parámetros. */
  ruta: string
  /** Scope exigido, o null si basta con estar autenticado. */
  scope: string | null
  principal: PrincipalPermitido
  /** Qué hace, en una línea. Lo lee quien integra. */
  resumen: string
  /** ¿Escribe? Las escrituras exigen `Idempotency-Key`. */
  idempotente?: boolean
  /**
   * ¿Es un listado paginado por cursor? (B-6.)
   *
   * Marca las colecciones que pueden crecer sin techo: acepta `?limit=` y
   * `?cursor=`, y su respuesta trae `page.nextCursor`. Los catálogos pequeños y
   * acotados (sucursales, tipos de vehículo) NO lo llevan: se devuelven enteros
   * en una llamada, y decirlo aquí evita que un cliente pagine una lista que
   * nunca tendrá una segunda página.
   */
  paginado?: boolean
}

export const INVENTARIO_API: readonly RecursoApi[] = [
  // ── Identidad de quien llama ────────────────────────────────────────────
  {
    metodo: 'POST',
    ruta: '/oauth/token',
    scope: null,
    principal: 'publico',
    resumen: 'Emite un token de acceso a partir de las credenciales de un sistema satélite.',
  },
  {
    metodo: 'GET',
    ruta: '/.well-known/keys',
    scope: null,
    principal: 'publico',
    resumen: 'Clave pública con la que se verifica la firma Ed25519 de los webhooks.',
  },
  {
    metodo: 'GET',
    ruta: '/systems/me',
    scope: null,
    principal: 'sistema',
    resumen: 'Ficha del sistema que llama: su estado, sus verticales y sus scopes.',
  },
  {
    metodo: 'GET',
    ruta: '/entitlements',
    scope: null,
    principal: 'sistema',
    resumen: 'Empresas que tienen habilitado el sistema que llama.',
  },
  // ── Empresa y catálogo ──────────────────────────────────────────────────
  {
    metodo: 'GET',
    ruta: '/companies/{id}',
    scope: null,
    principal: 'sistema-o-empresa',
    resumen: 'Datos públicos de una empresa: nombre, moneda y zona horaria.',
  },
  {
    metodo: 'GET',
    ruta: '/branches',
    scope: 'branches:read',
    principal: 'sistema-o-empresa',
    resumen: 'Sucursales de la empresa.',
  },
  {
    metodo: 'GET',
    ruta: '/promotions',
    scope: 'promotions:read',
    principal: 'sistema-o-empresa',
    resumen: 'Promociones vigentes de la empresa.',
    paginado: true,
  },
  {
    metodo: 'GET',
    ruta: '/vehicle-types',
    scope: 'benefits:read',
    principal: 'sistema-o-empresa',
    resumen: 'Tipos de vehículo y su nivel tarifario.',
  },

  // ── Clientes ────────────────────────────────────────────────────────────
  {
    metodo: 'GET',
    ruta: '/customers/{id}',
    scope: 'customers:read',
    principal: 'sistema-o-empresa',
    resumen: 'Ficha de un cliente de la empresa.',
  },
  {
    metodo: 'GET',
    ruta: '/customers/search',
    scope: 'customers:read',
    principal: 'sistema-o-empresa',
    resumen: 'Busca clientes por nombre, teléfono o correo.',
  },
  {
    metodo: 'GET',
    ruta: '/customers/resolve',
    scope: 'customers:read',
    principal: 'sistema-o-empresa',
    resumen: 'Resuelve un cliente por su identificador exacto (teléfono, correo o QR).',
  },
  {
    metodo: 'POST',
    ruta: '/customers',
    scope: 'customers:write',
    principal: 'sistema',
    resumen: 'Da de alta un cliente (deduplica: si ya existía, devuelve el suyo).',
    idempotente: true,
  },
  {
    metodo: 'GET',
    ruta: '/vehicles',
    scope: 'customers:read',
    principal: 'sistema-o-empresa',
    resumen: 'Vehículos de un cliente.',
  },
  {
    metodo: 'GET',
    ruta: '/vehicles/by-plate',
    scope: 'customers:read',
    principal: 'sistema-o-empresa',
    resumen: 'Encuentra un vehículo y su dueño por la placa.',
  },

  // ── Membresías, beneficios y citas ──────────────────────────────────────
  {
    metodo: 'GET',
    ruta: '/memberships',
    scope: 'memberships:read',
    principal: 'sistema-o-empresa',
    resumen: 'Membresías de la empresa.',
    paginado: true,
  },
  {
    metodo: 'GET',
    ruta: '/memberships/active',
    scope: 'memberships:read',
    principal: 'sistema-o-empresa',
    resumen: 'Membresía activa de un cliente, con su plan y sus saldos.',
  },
  {
    metodo: 'POST',
    ruta: '/benefits/evaluate',
    scope: 'benefits:read',
    principal: 'sistema-o-empresa',
    resumen: 'Dice si un cliente puede consumir un beneficio AHORA, y por qué no si no puede.',
  },
  {
    metodo: 'GET',
    ruta: '/appointments',
    scope: 'appointments:read',
    principal: 'sistema-o-empresa',
    resumen: 'Citas de la empresa en un rango de fechas.',
    paginado: true,
  },

  // ── Escrituras (solo satélites) ─────────────────────────────────────────
  {
    metodo: 'POST',
    ruta: '/redemptions',
    scope: 'benefits:redeem',
    principal: 'sistema',
    resumen: 'Consume un beneficio de un cliente. Deja constancia de qué sistema lo hizo.',
    idempotente: true,
  },
  {
    metodo: 'POST',
    ruta: '/redemptions/{id}/reverse',
    scope: 'benefits:redeem',
    principal: 'sistema',
    resumen: 'Deshace un consumo y devuelve el beneficio al cliente.',
    idempotente: true,
  },
  {
    metodo: 'POST',
    ruta: '/promotions/redeem',
    scope: 'benefits:redeem',
    principal: 'sistema',
    resumen: 'Canjea una promoción de un cliente (consume un uso). Deja constancia de qué sistema lo hizo.',
    idempotente: true,
  },
  {
    metodo: 'POST',
    ruta: '/transactions',
    scope: 'transactions:write',
    principal: 'sistema',
    resumen: 'Registra una transacción realizada en el sistema satélite.',
    idempotente: true,
  },
  // ── Suscripciones de webhook (solo claves de empresa) ───────────────────
  //
  // Son lo que necesita un constructor de flujos —Zapier, Make— para funcionar
  // como se espera: al montar el flujo crea la suscripción, al apagarlo la
  // retira. Sin API habría que entrar al panel a mano cada vez, que es justo lo
  // que nadie hace.
  {
    metodo: 'GET',
    ruta: '/webhooks',
    scope: 'webhooks:manage',
    principal: 'empresa',
    resumen: 'Lista las suscripciones de webhook de la empresa que presenta la clave.',
  },
  {
    metodo: 'POST',
    ruta: '/webhooks',
    scope: 'webhooks:manage',
    principal: 'empresa',
    resumen: 'Crea una suscripción de webhook y devuelve su secreto de firma.',
  },
  {
    metodo: 'DELETE',
    ruta: '/webhooks/{id}',
    scope: 'webhooks:manage',
    principal: 'empresa',
    resumen: 'Retira una suscripción de webhook. Deja de entregarse de inmediato.',
  },
  {
    metodo: 'POST',
    ruta: '/sso/redeem',
    scope: null,
    principal: 'sistema',
    resumen: 'Canjea un token SSO de un solo uso y devuelve la identidad de quien entra.',
  },
] as const

/** Lo que una clave de API de empresa puede usar. */
export function recursosParaClaveDeEmpresa(): RecursoApi[] {
  return INVENTARIO_API.filter((r) => r.principal === 'sistema-o-empresa')
}
