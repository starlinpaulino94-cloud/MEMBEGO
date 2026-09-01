import { NextResponse, type NextRequest } from 'next/server'
import { generarOpenApi } from '@membego/contracts'

export const dynamic = 'force-dynamic'

/**
 * OPENAPI de la API pública (Membego Connect · Fase 8).
 *
 * PÚBLICO, y es la decisión correcta: describe la FORMA de la API, no sus
 * datos. Quien integra necesita poder importarlo en Postman, Zapier o Make
 * antes de tener credenciales — pedir un token para leer la documentación es
 * el mismo círculo que ya se resolvió en `.well-known/keys`.
 *
 * No revela nada que no se pueda averiguar probando rutas: qué recursos
 * existen y qué permiso pide cada uno. Lo que NO aparece aquí es el
 * diagnóstico de operación (`/diag`), que no es contrato.
 *
 * Se genera desde el inventario de `@membego/contracts` en cada petición: así
 * no puede quedarse viejo, y el servidor sale de la propia URL de la petición
 * en vez de una variable que alguien tenga que acordarse de cambiar.
 */
export async function GET(req: NextRequest) {
  // `no-store` como TODA la API v1. Esta respuesta no lleva datos de nadie y
  // podría cachearse sin riesgo, pero la regla es absoluta a propósito: las
  // demás respuestas van acotadas a una empresa y un intermediario que las
  // guarde se las serviría al siguiente que pregunte. Una regla sin
  // excepciones se sostiene sola; una con una excepción hay que recordarla — y
  // el ahorro de cachear un documento que se consulta dos veces en la vida no
  // compensa ese riesgo.
  return NextResponse.json(generarOpenApi(req.nextUrl.origin), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
