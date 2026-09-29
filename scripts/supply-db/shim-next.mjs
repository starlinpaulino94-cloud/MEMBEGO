/**
 * Sustituye los módulos de runtime de Next.js (`next/headers`,
 * `next/navigation`, `next/cache`) por un stub, en los DOS cargadores: el de
 * ESM (hook de resolución) y el de CommonJS (que es por donde tsx carga el
 * código TypeScript del proyecto).
 *
 * Las pruebas de tests/postgres/ ejercen el DOMINIO contra PostgreSQL, sin servidor
 * Next. Algún módulo de dominio arrastra `@/lib/auth` (redirect, cookies) por
 * una dependencia indirecta; fuera de Next esos módulos no se pueden cargar y
 * tampoco hacen falta: ninguna prueba pasa por ellos.
 */
import Module, { register } from 'node:module'
import { fileURLToPath } from 'node:url'

const STUB = fileURLToPath(new URL('./shim-next-stub.cjs', import.meta.url))
const SUSTITUIDOS = /^next\/(headers|navigation|cache)(\.js)?$/

const original = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (SUSTITUIDOS.test(request)) return STUB
  return original.call(this, request, ...rest)
}

register('./shim-next-hooks.mjs', import.meta.url)
