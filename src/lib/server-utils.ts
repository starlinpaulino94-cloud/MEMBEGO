import { headers } from 'next/headers'
export { periodEnd } from '@/lib/periodos'

export async function getRequestMeta() {
  const h = await headers()
  return {
    ipAddress: h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent') ?? null,
  }
}
