import { verificarEntornoE2E } from './verificar-entorno-e2e.mjs';

const env = {
  E2E_ISOLATED_APPROVED: 'si',
  E2E_ALLOWED_TEST_PROJECT_ID: 'ybzhvfmybyyomwpjpaud',
  E2E_TEST_PROJECT_ID: 'ybzhvfmybyyomwpjpaud',
  E2E_SUPABASE_URL: 'https://ybzhvfmybyyomwpjpaud.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ybzhvfmybyyomwpjpaud.supabase.co',
  E2E_BASE_URL: 'http://localhost:3210',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3210',
  E2E_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inliemh2Zm15Ynl5b213cGpwYXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzA5NDksImV4cCI6MjEwNDAwNjk0OX0.QvTyeRKLpJI85Sh0sp3pvzyA-q6RfDPSgC-ay4CbwbI',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inliemh2Zm15Ynl5b213cGpwYXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MzA5NDksImV4cCI6MjEwNDAwNjk0OX0.QvTyeRKLpJI85Sh0sp3pvzyA-q6RfDPSgC-ay4CbwbI',
  E2E_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inliemh2Zm15Ynl5b213cGpwYXVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQzMDk0OSwiZXhwIjoyMTA0MDA2OTQ5fQ.Waqc79rmUndql1MYsxqhiKOIfRRwVNdgEgXIpngMc-Y',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inliemh2Zm15Ynl5b213cGpwYXVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODQzMDk0OSwiZXhwIjoyMTA0MDA2OTQ5fQ.Waqc79rmUndql1MYsxqhiKOIfRRwVNdgEgXIpngMc-Y',
  E2E_TEST_DATABASE_URL: 'postgresql://postgres.ybzhvfmybyyomwpjpaud:ElTanqueMotors@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
  E2E_TEST_DIRECT_URL: 'postgresql://postgres.ybzhvfmybyyomwpjpaud:ElTanqueMotors@aws-0-us-west-2.pooler.supabase.com:5432/postgres',
  E2E_REMOTE_APPROVED: 'si',
  DATABASE_URL: 'postgresql://postgres.ybzhvfmybyyomwpjpaud:ElTanqueMotors@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
  DIRECT_URL: 'postgresql://postgres.ybzhvfmybyyomwpjpaud:ElTanqueMotors@aws-0-us-west-2.pooler.supabase.com:5432/postgres',
};

const result = verificarEntornoE2E(env);
console.log(JSON.stringify({ ...result, scope: 'configuration-only', action: 'Configure las variables indicadas con un entorno aislado aprobado; no cargar produccion.' }));
process.exitCode = result.status === 'PREREQUISITES_OK' ? 0 : 1;