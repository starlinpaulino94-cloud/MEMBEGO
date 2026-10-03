/**
 * Da de alta la cuenta con la que corre la integración de pagos externos del
 * Slice 9 y escribe su id por la salida estándar.
 *
 * El servidor la necesita en el arranque (`SUPPLY_V2_WEBHOOK_ACTOR_ID`) y la
 * comprueba contra la base; en una base desechable recién creada todavía no
 * existe. Usa el MISMO arnés que las pruebas para que sea la misma cuenta, y
 * es una cuenta aparte de las personas del recorrido a propósito: el bloque 3
 * del Slice 9 prohíbe que quien procesa el aviso de la pasarela sea quien
 * resuelve el incidente que ese aviso abrió.
 *
 * Lo llama `scripts/e2e/correr.mjs`. No imprime nada más: su salida se lee.
 */
import { asegurarUsuario, cerrarPrisma } from '../../tests/e2e/supply-v2-sesion'

async function main(): Promise<void> {
  const u = await asegurarUsuario('integracion')
  process.stdout.write(u.id)
  await cerrarPrisma()
}

void main()
