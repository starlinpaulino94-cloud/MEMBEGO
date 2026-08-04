import { cache } from 'react'
import { supabaseAuthService } from '@/lib/auth/auth-service'
import type { SessionUser } from '@/types'

/**
 * User of the current request, validated against the Supabase server.
 *
 * Wrapped in React.cache(): within a single RSC request (layout + page +
 * guards) the network validation runs ONCE instead of once per guard/query
 * that needs the user.
 *
 * Failure semantics live in `supabaseAuthService.getUser()`: transient auth
 * outages (429/5xx/network) are retried once and, if they persist, fall back
 * to a locally verified access token instead of logging the user out. A real
 * rejection (401) returns `null`.
 */
export const getUser = cache((): Promise<SessionUser | null> => supabaseAuthService.getUser())

/** Auth provider abstraction used by server actions and middleware. */
export const authService = supabaseAuthService
