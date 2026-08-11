/**
 * PLATAFORMA · Fase 7 — LA IDENTIDAD DE UN CLIENTE QUE LLEGA SIN CUENTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES DEL CORE Y NO DE CADA VERTICAL
 *
 * Un lavadero anota a quien trae el carro. Un restaurante anota a quien se
 * sienta en la mesa 4. Los dos están creando LA MISMA COSA —un cliente de la
 * empresa— y hoy cada uno la crearía a su manera.
 *
 * Escrita tres veces, la identidad del cliente acaba con tres formas distintas:
 * uno pone el correo vacío, otro pone `null`, el tercero se olvida de marcarlo
 * como local y ese cliente aparece en un listado que no le corresponde. Cuando
 * eso pasa ya hay filas escritas y arreglarlo es una migración.
 *
 * Aquí está la parte que decide QUÉ se escribe. La que habla con la base vive
 * en `alta-cliente.ts`; esta es pura para poder probarse caso por caso.
 */

/** Prefijo que marca una identidad que NO viene de Supabase Auth. */
export const PREFIJO_LOCAL = 'local:'

/**
 * Identidad para un cliente que no tiene cuenta.
 *
 * Supabase solo emite UUID, así que un id con este prefijo JAMÁS puede salir de
 * una sesión real: esta ficha no puede iniciar sesión ni por accidente. No es
 * una comprobación que haya que acordarse de escribir en cada sitio — es
 * imposible por forma.
 */
export function nuevoIdLocal(): string {
  // Fecha + azar: no necesita ser criptográfico, solo único. La unicidad real
  // la garantiza el @@unique([supabaseId, companyId]) de la base.
  return `${PREFIJO_LOCAL}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export function esIdLocal(supabaseId: string | null | undefined): boolean {
  return !!supabaseId?.startsWith(PREFIJO_LOCAL)
}

/** Lo que un vertical puede mandar al dar de alta a alguien. */
export interface EntradaAlta {
  nombre?: string | null
  telefono?: string | null
  email?: string | null
}

/** Lo que se escribe, ya normalizado. */
export interface AltaNormalizada {
  nombre: string
  telefono: string | null
  /** Vacío, nunca `null`: la columna es obligatoria y `sendEmail` ya descarta destinatarios inválidos. */
  email: string
}

export const MAX_NOMBRE = 80
export const MAX_TELEFONO = 30
export const MAX_EMAIL = 160

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * SOLO EL NOMBRE ES OBLIGATORIO.
 *
 * Es la regla que ya seguía el mostrador de Car Wash, y la razón se sostiene
 * igual en un restaurante: exigir correo o documento en la puerta es la forma
 * más rápida de que el encargado deje de usar el sistema y vuelva al cuaderno.
 * Un cliente registrado con solo su nombre vale infinitamente más que un
 * cliente no registrado.
 *
 * El correo se guarda en minúsculas porque es con lo que se busca después. Si
 * uno entra como `Maria@X.com` y la búsqueda pregunta por `maria@x.com`, el
 * cliente existe y el sistema dice que no — el mismo fallo que la Fase 6
 * encontró en los teléfonos, en otra columna.
 */
export function normalizarAlta(
  entrada: EntradaAlta
): { ok: true; datos: AltaNormalizada } | { ok: false; motivo: string } {
  const nombre = texto(entrada.nombre, MAX_NOMBRE)
  if (!nombre) return { ok: false, motivo: 'name is required.' }

  const email = texto(entrada.email, MAX_EMAIL).toLowerCase()
  if (email && !email.includes('@')) {
    return { ok: false, motivo: 'email is not a valid address.' }
  }

  return {
    ok: true,
    datos: {
      nombre,
      telefono: texto(entrada.telefono, MAX_TELEFONO) || null,
      email,
    },
  }
}

/**
 * ¿Con qué se puede buscar si esta persona ya está?
 *
 * Sin identificador NO HAY NADA QUE DEDUPLICAR, y esa es la respuesta correcta,
 * no un hueco: dos «Juan» distintos en el mismo restaurante son dos personas, y
 * fusionarlos por el nombre mezclaría el historial de dos clientes reales. El
 * daño de ese error es peor y no tiene vuelta atrás.
 */
export function tieneIdentificador(datos: AltaNormalizada): boolean {
  return !!datos.email || !!datos.telefono
}
