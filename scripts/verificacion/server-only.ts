/**
 * `server-only` fuera de Next.
 *
 * Los módulos del servidor empiezan con `import 'server-only'` para que Next
 * falle el build si alguien los arrastra a un componente de cliente. Ese
 * paquete solo existe dentro de Next (`next/dist/compiled/server-only`), así
 * que un script de verificación que importe esos módulos DE VERDAD —en vez de
 * leerlos como texto— no puede resolverlo.
 *
 * Este archivo vacío ocupa su lugar, y solo para los scripts de verificación
 * (`tsconfig.verificacion.json`). La aplicación sigue usando el real.
 */
export {}
