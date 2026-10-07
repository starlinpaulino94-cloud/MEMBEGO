import { verificarEntornoE2E } from './verificar-entorno-e2e.mjs';
import { entornoRemotoDesdeProceso } from './e2e-entorno-remoto.mjs';

// Todo sale del entorno de quien lo corre (ver scripts/e2e-entorno-remoto.mjs): aquí no hay credenciales.
const env = entornoRemotoDesdeProceso();
const result = verificarEntornoE2E(env);
console.log(JSON.stringify({ ...result, scope: 'configuration-only', action: 'Configure las variables indicadas con un entorno aislado aprobado; no cargar produccion.' }));
process.exitCode = result.status === 'PREREQUISITES_OK' ? 0 : 1;