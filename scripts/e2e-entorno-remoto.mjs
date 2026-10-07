/**
 * El entorno de los recorridos E2E contra un proyecto de Supabase AISLADO de pruebas.
 *
 * TODO sale de las variables de entorno de quien lo corre: aquí no hay ninguna clave, URL de
 * base de datos ni contraseña. (Antes `run-e2e-verify.mjs` y `run-auth-e2e.mjs` las llevaban
 * escritas —las claves `anon` y `service_role` y la contraseña del pooler—, en git desde
 * 2026-09-18; hallazgo C1 de la auditoría del 2026-10-07. Esas credenciales hay que ROTARLAS:
 * seguirán en el historial aunque este archivo ya no las tenga.) `tests/sin-credenciales.test.ts`
 * y el job `secretos` de CI vigilan que no vuelvan.
 *
 * Las dos aprobaciones (`E2E_ISOLATED_APPROVED`, `E2E_REMOTE_APPROVED`) también las pone una
 * persona: es ella quien confirma que el proyecto es de pruebas y no producción.
 */

/** Variables que el recorrido necesita y que NO tienen valor por defecto. */
export const VARIABLES_REQUERIDAS = [
  'E2E_ISOLATED_APPROVED',
  'E2E_ALLOWED_TEST_PROJECT_ID',
  'E2E_TEST_PROJECT_ID',
  'E2E_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'E2E_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'E2E_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'E2E_TEST_DATABASE_URL',
  'E2E_TEST_DIRECT_URL',
  'E2E_REMOTE_APPROVED',
  'DATABASE_URL',
  'DIRECT_URL',
];

/** Las únicas con valor por defecto: la app local que se levanta para el recorrido (sin secretos). */
const POR_DEFECTO = {
  E2E_BASE_URL: 'http://localhost:3210',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3210',
};

/** Arma el entorno desde `process.env` (lo que falte queda ausente: `verificarEntornoE2E` lo informa y no corre nada). */
export function entornoRemotoDesdeProceso(procesoEnv = process.env) {
  const env = { ...POR_DEFECTO };
  for (const nombre of [...VARIABLES_REQUERIDAS, ...Object.keys(POR_DEFECTO)]) {
    const v = procesoEnv[nombre];
    if (typeof v === 'string' && v.trim() !== '') env[nombre] = v;
  }
  return env;
}
