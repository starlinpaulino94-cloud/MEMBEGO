import { CAPABILITIES, scopesDe, type Capability } from './scopes'

/**
 * CONTRATOS · EL MANIFIESTO DE UN SISTEMA VERTICAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * La pregunta que la Fase 7 existe para contestar es una sola: **¿se integra un
 * sistema nuevo sin tocar el Core?** Mientras dar de alta un vertical exija
 * editar un `as const`, añadir un caso a un `switch` o desplegar MembeGo, la
 * respuesta es no — y con doscientos verticales esa deuda no es un inconveniente,
 * es el techo del negocio.
 *
 * El manifiesto es la alternativa: un vertical se declara en un archivo de
 * DATOS, y darlo de alta es escribir filas. El Core no se recompila, no se
 * despliega y no se entera de que existe un restaurante.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PIDEN CAPABILITIES, NO SCOPES — Y ESO ES LA SEGURIDAD
 *
 * Un manifiesto NO puede pedir `benefits:redeem`. Pide `BENEFIT_REDEMPTION`, y
 * el Core deriva los scopes con `scopesDe()`.
 *
 * La diferencia importa el día que alguien edite el archivo de un satélite y
 * añada una línea. Si el manifiesto llevara scopes, esa línea sería el permiso;
 * llevando capabilities, la lista de lo concedible está en el Core y un valor
 * que no esté en ella no concede nada — falla la validación en vez de conceder
 * algo que nadie revisó.
 *
 * También quita una decisión de las manos de quien integra: no hay que saber
 * qué scopes hacen falta para canjear. Se declara lo que el sistema HACE.
 */

export interface ManifiestoSistema {
  /** Identificador estable. Viaja en las URLs de SSO: no se renombra. */
  slug: string
  nombre: string
  /** Raíz del satélite. El SSO redirige a `{urlBase}/sso/membego?token=…`. */
  urlBase: string
  /** Códigos de tipo de negocio a los que sirve. Un POS puede servir a varios. */
  businessTypes: string[]
  /** Lo que el sistema HACE. Los scopes se derivan de aquí. */
  capabilities: Capability[]
  /** Destino de los webhooks firmados. Sin esto, el sistema solo recibe SSO. */
  webhookUrl?: string
  /**
   * ¿Toda empresa compatible lo obtiene sin habilitación explícita? Por defecto
   * `false`: un sistema nuevo no se le concede a nadie por existir.
   */
  autoHabilitar?: boolean
  /** ¿Hace falta que cada persona tenga acceso explícito? Por defecto `false`. */
  accesoPorUsuario?: boolean
}

/** Un slug es minúsculas, dígitos y guiones: va en URLs. */
const RE_SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/
/** Un código de tipo de negocio es MAYÚSCULAS con guion bajo: es un valor estable. */
const RE_CODIGO = /^[A-Z][A-Z0-9_]{1,38}$/

function esTexto(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Valida un manifiesto. Puro: sin base de datos y sin red, para que el satélite
 * pueda comprobar el suyo antes de mandárselo a nadie.
 *
 * Devuelve TODOS los errores, no el primero. Quien está dando de alta un
 * sistema está delante de una terminal: enseñarle los cinco problemas de una
 * vez le ahorra cinco intentos.
 */
export function validarManifiesto(
  m: unknown
): { ok: true; manifiesto: ManifiestoSistema } | { ok: false; errores: string[] } {
  const errores: string[] = []
  const o = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>

  if (!esTexto(o.slug) || !RE_SLUG.test(o.slug)) {
    errores.push('slug: minúsculas, dígitos y guiones, entre 3 y 40 caracteres.')
  }
  if (!esTexto(o.nombre)) errores.push('nombre: obligatorio.')

  if (!esTexto(o.urlBase)) {
    errores.push('urlBase: obligatoria.')
  } else {
    try {
      const u = new URL(o.urlBase)
      // Por ahí viaja un token SSO en la query. Sobre http lo lee cualquiera
      // que esté en medio, y con él entra. `localhost` se permite porque sin
      // eso no se puede desarrollar un satélite.
      if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
        errores.push('urlBase: tiene que ser https (salvo localhost).')
      }
    } catch {
      errores.push('urlBase: no es una URL válida.')
    }
  }

  if (o.webhookUrl !== undefined) {
    if (!esTexto(o.webhookUrl)) {
      errores.push('webhookUrl: si viene, no puede estar vacía.')
    } else {
      try {
        const u = new URL(o.webhookUrl)
        if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
          errores.push('webhookUrl: tiene que ser https (salvo localhost).')
        }
      } catch {
        errores.push('webhookUrl: no es una URL válida.')
      }
    }
  }

  const tipos = Array.isArray(o.businessTypes) ? o.businessTypes : []
  if (tipos.length === 0) {
    errores.push('businessTypes: al menos uno. Un sistema que no sirve a ningún vertical no lo abre nadie.')
  }
  for (const t of tipos) {
    if (!esTexto(t) || !RE_CODIGO.test(t)) {
      errores.push(`businessTypes: "${String(t)}" no es un código válido (MAYÚSCULAS_CON_GUION_BAJO).`)
    }
  }

  const caps = Array.isArray(o.capabilities) ? o.capabilities : []
  if (caps.length === 0) {
    errores.push('capabilities: al menos una. Sin ninguna, el sistema no puede pedir nada al Core.')
  }
  for (const c of caps) {
    if (!CAPABILITIES.includes(c as Capability)) {
      // Aquí es donde muere un scope inventado: lo concedible lo decide el
      // Core, no el archivo del satélite.
      errores.push(`capabilities: "${String(c)}" no existe. Válidas: ${CAPABILITIES.join(', ')}.`)
    }
  }

  for (const bandera of ['autoHabilitar', 'accesoPorUsuario'] as const) {
    if (o[bandera] !== undefined && typeof o[bandera] !== 'boolean') {
      errores.push(`${bandera}: tiene que ser true o false.`)
    }
  }

  if (errores.length) return { ok: false, errores }

  return {
    ok: true,
    manifiesto: {
      slug: (o.slug as string).trim(),
      nombre: (o.nombre as string).trim(),
      urlBase: (o.urlBase as string).trim().replace(/\/+$/, ''),
      businessTypes: [...new Set(tipos as string[])],
      capabilities: [...new Set(caps as Capability[])],
      ...(o.webhookUrl ? { webhookUrl: (o.webhookUrl as string).trim() } : {}),
      autoHabilitar: o.autoHabilitar === true,
      accesoPorUsuario: o.accesoPorUsuario === true,
    },
  }
}

/** Los scopes que el manifiesto concede. Derivados, nunca declarados. */
export function scopesDelManifiesto(m: ManifiestoSistema): string[] {
  return scopesDe(m.capabilities)
}
