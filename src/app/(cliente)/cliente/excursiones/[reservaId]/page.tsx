import { redirect } from 'next/navigation'

interface ReservaRedirectProps {
  params: Promise<{ reservaId: string }>
}

export default async function ReservaRedirectPage({ params }: ReservaRedirectProps) {
  const { reservaId } = await params
  redirect(`/cliente/mis-excursiones/${reservaId}`)
}