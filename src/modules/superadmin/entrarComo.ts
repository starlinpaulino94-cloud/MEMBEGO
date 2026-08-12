import { createHash } from 'node:crypto'

/**
 * LA HUELLA DE UN ENLACE DE SUPLANTACIÓN. Módulo PURO a propósito.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA
 *
 * «Entrar como» generaba el enlace y escribía `ENTRAR_COMO_GENERADO`. Ahí se
 * acababa el rastro. Si alguien ABRÍA el enlace, lo que quedaba activa era la
 * sesión del usuario suplantado, y desde ese instante todo lo que se hiciera
 * entraba en la bitácora **a nombre de él**.
 *
 * Traducido a la conversación que algún día toca tener: un cliente dice «yo no
 * cancelé esa membresía» y la bitácora dice que la canceló él. El único indicio
 * de lo contrario es una línea anterior que dice que *se preparó un enlace* —
 * que no prueba que se usara, ni cuándo, ni desde dónde.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE CIERRA
 *
 * Al generar, se guarda en el payload la HUELLA del token. Al canjearlo,
 * `/confirmar` calcula la huella del token que le llega y busca esa línea: si
 * aparece, la suplantación ocurrió de verdad y se escribe `ENTRAR_COMO_USADO`
 * **atribuido al superadmin**, no al suplantado.
 *
 * POR QUÉ UNA HUELLA Y NO EL TOKEN.
 *
 * El `hashed_token` de Supabase no es un identificador: ES LA CREDENCIAL. Es
 * exactamente lo que viaja en la URL, y quien lo tenga abre la sesión de esa
 * persona. Guardarlo en `audit_logs` convertiría la bitácora —la tabla que más
 * gente puede leer, y la que se exporta a CSV— en un almacén de credenciales
 * vivas. SHA-256 va en un solo sentido: sirve para reconocer un token que ya
 * tienes en la mano, y no sirve para fabricarlo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO NO TOCA LA BASE DE DATOS
 *
 * Para poder probarlo sin ella. La parte que consulta y escribe vive en
 * `entrarComoUso.ts`; aquí solo está la regla, que es la que hay que poder
 * comprobar: que la huella no sea el token, que sea estable, y que dos tokens
 * distintos no compartan huella.
 */

/**
 * Huella irreversible de un `hashed_token` de Supabase.
 *
 * Se normaliza el espacio en blanco porque el token viaja por una URL y vuelve
 * decodificado: un salto de línea o un espacio de más al copiar el enlace a
 * mano no puede romper la correspondencia.
 */
export function huellaToken(hashedToken: string): string {
  return createHash('sha256').update(hashedToken.trim()).digest('hex')
}

/**
 * Cuánto hacia atrás se busca el enlace al canjearlo.
 *
 * `/confirmar` es el MISMO callback que la verificación de correo normal, así
 * que esta búsqueda corre en cada confirmación de cuenta, no solo en las
 * suplantaciones. Por eso se acota: la consulta filtra por `accion` (que está
 * indexada) y por `createdAt` (idem), y solo dentro de esa ventana mira el
 * payload —que no lo está—. Sin la ventana, cada usuario que verifica su correo
 * pagaría un recorrido de toda la bitácora.
 *
 * Siete días es holgado a propósito: los enlaces de Supabase caducan en horas,
 * así que el margen sobra para cualquier configuración razonable y la ventana
 * sigue siendo diminuta.
 */
export const VENTANA_CANJE_MS = 7 * 24 * 60 * 60 * 1000
