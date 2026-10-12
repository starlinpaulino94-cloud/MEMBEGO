/**
 * El tsconfig raíz NO compila `apps/client` (la app de Expo tiene sus propias dependencias), pero varias pruebas importan
 * archivos de allí (`apps/client/src/lib/*.ts`) para comprobar sus reglas puras, y TypeScript los sigue y no encuentra
 * estos paquetes (no están instalados en la raíz). Aquí se declaran SIN tipos, solo para que `npx tsc --noEmit` de la
 * raíz no falle; dentro de `apps/client` mandan los tipos reales de cada paquete.
 */
declare module 'react-native'
declare module 'expo-constants'
declare module 'expo-secure-store'
