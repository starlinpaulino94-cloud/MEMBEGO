import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveApiBaseUrl,
  resolveSupabaseUrl,
} from '../apps/client/src/lib/runtimeUrls'

test('web Supabase keeps the configured localhost URL unchanged', () => {
  assert.equal(
    resolveSupabaseUrl({
      configuredUrl: 'http://localhost:54321',
      platform: 'web',
    }),
    'http://localhost:54321'
  )
})

test('native Supabase rewrites localhost only when Expo provides a device host', () => {
  assert.equal(
    resolveSupabaseUrl({
      configuredUrl: 'http://localhost:54321',
      platform: 'native',
      hostUri: '192.168.1.25:8081',
    }),
    'http://192.168.1.25:54321'
  )
})

test('native local service URLs use the configured device host instead of the Expo tunnel host', () => {
  const options = {
    platform: 'native' as const,
    hostUri: 'anonymous-123.exp.direct:8081',
    nativeHost: '10.0.0.161',
  }

  assert.equal(
    resolveSupabaseUrl({
      ...options,
      configuredUrl: 'http://localhost:54321',
    }),
    'http://10.0.0.161:54321'
  )
  assert.equal(
    resolveApiBaseUrl({
      ...options,
      configuredUrl: 'http://localhost:3000',
    }),
    'http://10.0.0.161:3000'
  )
})

test('missing Supabase URL fails with an actionable configuration error', () => {
  assert.throws(
    () =>
      resolveSupabaseUrl({
        platform: 'web',
      }),
    /EXPO_PUBLIC_SUPABASE_URL/
  )
})

test('web API uses the configured localhost BFF before the browser origin', () => {
  assert.equal(
    resolveApiBaseUrl({
      configuredUrl: 'http://localhost:3000',
      platform: 'web',
      browserOrigin: 'http://127.0.0.1:8081',
    }),
    'http://localhost:3000'
  )
})

test('web API derives port 3000 from localhost when no API env is present', () => {
  assert.equal(
    resolveApiBaseUrl({
      platform: 'web',
      browserOrigin: 'http://localhost:8081',
    }),
    'http://localhost:3000'
  )
})

test('missing API URL fails instead of falling back to a machine IP', () => {
  assert.throws(
    () => resolveApiBaseUrl({ platform: 'web' }),
    /EXPO_PUBLIC_API_URL/
  )
})
