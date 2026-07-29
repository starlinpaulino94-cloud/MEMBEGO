# Pruebas de carga (k6)

Fase 4 de `docs/AUDITORIA-PRODUCCION.md`.

**Estos guiones no se han ejecutado contra nada.** No tengo acceso a un entorno
desplegado, y lanzar carga contra producción sin avisar es indistinguible de un
ataque. Están escritos para que los corras tú; los números de la auditoría
(«techo estimado 500-1.000 concurrentes») siguen siendo una **estimación de
ingeniería hasta que estos guiones la confirmen o la desmientan**.

## Antes de correrlos

1. **Contra un entorno de prueba**, no contra producción. Un `preview` de Vercel
   apuntando a un proyecto Supabase aparte.
2. **Avisa a Supabase y a Vercel** si vas a superar unos cientos de peticiones
   por segundo: los dos tienen protección contra abuso y pueden cortarte.
3. Los guiones **escriben datos** (registro, escaneo). Nunca contra la base real.

## Instalación

```bash
brew install k6      # macOS
# o https://k6.io/docs/get-started/installation/
```

## Los tres escenarios

| Guion | Qué mide | Umbral que debe pasar |
|---|---|---|
| `landing.js` | La portada pública, que es lo que recibe el golpe del lanzamiento | p95 < 800 ms, 0 % de error |
| `escaneo.js` | El canje de QR: la ruta que si cae, el car wash no atiende | p95 < 1.200 ms, 0 % de error |
| `mixto.js` | Los tres perfiles a la vez, subiendo hasta 5.000 usuarios | p95 < 2 s, < 1 % de error |

```bash
BASE_URL=https://preview.tu-dominio k6 run tests/carga/landing.js
```

## Qué mirar mientras corre

No solo la salida de k6. Al mismo tiempo:

- **Supabase → Database → Connection pooler**: si las conexiones activas se
  pegan al techo, el cuello es el pool. Revisa `connection_limit=1` en la
  cadena (el aviso de `src/lib/prisma.ts` lo comprueba al arrancar).
- **Supabase → Query Performance**: la consulta más lenta bajo carga es tu
  cuello de botella real, no la que tú creías.
- **Sentry → Performance**: el `prismaIntegration` ya está activo y marca las
  consultas por transacción. Un endpoint con veinte consultas es un N+1 que no
  se ve leyendo el código.

## Qué se hizo sin poder medir

Las tres correcciones de rendimiento de las fases anteriores se hicieron por
razonamiento sobre el código, no por medición:

- `/api/stats` hacía cuatro recorridos completos de tabla por visita anónima.
- El fan-out de notificaciones insertaba decenas de miles de filas en un request.
- El cron recorría todas las empresas en serie con 60 segundos.

Las tres son ciertas por construcción —se ven en el código— pero **cuánto**
mejoran solo lo dicen estos guiones.
