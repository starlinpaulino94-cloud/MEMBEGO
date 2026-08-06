'use server'

import { redirect } from 'next/navigation'
import { authService } from '@/lib/auth'

export async function logout() {
  await authService.logout()
  redirect('/login')
}
