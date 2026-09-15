declare var process: {
  env: {
    NODE_ENV?: 'development' | 'production' | 'test'
    EXPO_PUBLIC_SUPABASE_URL?: string
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string
    EXPO_PUBLIC_API_URL?: string
    NEXT_PUBLIC_SUPABASE_URL?: string
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: string
    [key: string]: string | undefined
  }
}

declare module '*.css'
