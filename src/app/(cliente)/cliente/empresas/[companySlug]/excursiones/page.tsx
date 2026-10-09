import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SITE_NAME } from '@/lib/site'
import { cargarExcursionesDeEmpresa } from '@/modules/comercio/lista-excursiones'
import { ListaDeExcursionesDeEmpresa } from '@/components/excursiones/ListaDeExcursionesDeEmpresa'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Excursiones · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * Las excursiones de una empresa DENTRO DE LA APP. Es adonde llegan quien entra por el enlace corto de un vendedor
 * (`/e/[slug]`) y quien termina de registrarse con él. Misma presentación que la lista pública, con tarjetas que llevan
 * a la ficha de la app, donde se reserva. La sesión de CLIENTE la exige el layout de `/cliente`.
 */
export default async function ExcursionesDeEmpresaEnLaAppPage({
  params,
  searchParams,
}: {
  params: Promise<{ companySlug: string }>
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { companySlug } = await params
  const sp = searchParams ? await searchParams : {}
  const enlaceVendedor = typeof sp?.e === 'string' ? sp.e : undefined
  const datos = await cargarExcursionesDeEmpresa(companySlug)
  if (!datos) notFound()
  return <ListaDeExcursionesDeEmpresa datos={datos} espacio="app" enlaceVendedor={enlaceVendedor} />
}
