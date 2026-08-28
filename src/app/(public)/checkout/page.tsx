import { getUser } from '@/lib/auth'
import { CheckoutClient } from './CheckoutClient'
import { ExcursionCarritoWrapper } from '@/components/excursiones/ExcursionCarritoWrapper'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const user = await getUser()
  const isAuthenticated = !!user

  return (
    <ExcursionCarritoWrapper>
      <CheckoutClient isAuthenticated={isAuthenticated} />
    </ExcursionCarritoWrapper>
  )
}
