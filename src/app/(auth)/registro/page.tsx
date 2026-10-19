import { redirect } from 'next/navigation'
import { getEmpresaPrincipal } from '@/modules/marketplace/marcaUnica'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Crear cuenta - MembeGo',
  description: 'Crea tu cuenta y activa tu membresía digital en minutos',
}

/** La consulta de la petición, tal cual: `next`, `utm`, `ref`… viajan al registro, que valida lo que obedece. */
function consultaDe(params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const [clave, valor] of Object.entries(params)) {
    for (const v of Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]) q.append(clave, v)
  }
  const texto = q.toString()
  return texto ? `?${texto}` : ''
}

/**
 * Modo MARCA ÚNICA: el registro entra DIRECTO a la empresa principal, sin
 * elegir empresa ni categorías. El registro por empresa (/registro/[slug])
 * sigue siendo la maquinaria real, así que cuando la plataforma tenga más
 * empresas solo hay que volver a mostrar el selector.
 *
 * Es una pieza del ACCESO, no de la landing: vive en `(auth)` junto a `/registro/[slug]` y `/registro/cuenta`
 * (la URL no cambia). Conserva la consulta: antes un `/registro?next=…` perdía su `next`.
 */
export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const consulta = consultaDe(await searchParams)
  const empresa = await getEmpresaPrincipal()
  if (empresa) redirect(`/registro/${empresa.slug}${consulta}`)
  // Sin empresa publicada aún: cuenta general (sin membresía).
  redirect(`/registro/cuenta${consulta}`)
}
