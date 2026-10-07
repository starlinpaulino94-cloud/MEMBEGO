export const Platform = { OS: 'web' }

export default { expoConfig: null }

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
  },
}

export function resolveApiBaseUrl() {
  return 'https://api.invalid'
}
