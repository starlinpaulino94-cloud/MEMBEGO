import { pathToFileURL } from 'node:url'

const STUB = new URL('./shim-next-stub.cjs', import.meta.url).href
const SUSTITUIDOS = /^next\/(headers|navigation|cache)(\.js)?$/

export async function resolve(specifier, context, next) {
  if (SUSTITUIDOS.test(specifier)) return { url: STUB, format: 'commonjs', shortCircuit: true }
  return next(specifier, context)
}
void pathToFileURL
