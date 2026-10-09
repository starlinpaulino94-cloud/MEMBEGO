import Module, { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const serviceStubUrl = new URL('./cardnet-postgres-service-stub.mjs', import.meta.url)
const serverOnlyStubUrl = new URL('./server-only-stub.mjs', import.meta.url)
const serviceStubPath = fileURLToPath(serviceStubUrl)
const serverOnlyStubPath = fileURLToPath(serverOnlyStubUrl)
const providerModules = new Set([
  '@/lib/payments/cardnet-tokens',
  '@/modules/pagos/cardnetToken',
  '@/modules/pagos/cardnet3ds',
])

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return serverOnlyStubPath
  if (providerModules.has(request)) return serviceStubPath
  return originalResolveFilename.call(this, request, ...rest)
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return { url: serverOnlyStubUrl.href, shortCircuit: true }
    if (providerModules.has(specifier)) return { url: serviceStubUrl.href, shortCircuit: true }
    return next(specifier, context)
  },
})
