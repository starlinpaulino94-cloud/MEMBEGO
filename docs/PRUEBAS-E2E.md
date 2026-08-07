# Pruebas de extremo a extremo

Cierra parcialmente el punto **26** del plan de `docs/AUDITORIA-PRODUCCION.md`
(*E2E del recorrido completo del cliente*) — Fase 7.

---

## 1. Por qué hacían falta

Antes de esta fase, MembeGo tenía 164 pruebas y **ninguna había abierto una
página nunca**. Todas son sobre funciones puras: la firma de QStash, el
presupuesto de error, la cola sin conexión. Son buenas pruebas y no ven la
clase de fallo que más duele en producción:

- La portada responde 200 y sale en blanco porque un error de hidratación
  rompió React.
- El botón de "Iniciar sesión" desapareció en móvil tras un cambio de CSS.
- Una ruta protegida deja de redirigir al login.
- El listado de empresas revienta cuando la base está vacía.

Ninguna de esas cosas produce un error en Sentry. El servidor responde
correctamente; lo que está roto es lo que ve la persona.

---

## 2. Cómo se ejecutan

### En CI

`.github/workflows/e2e.yml`, en cada PR y al mezclar en `main`: levanta un
PostgreSQL, aplica el esquema, construye, arranca y recorre con Chromium.

### En local

```bash
# 1) Una base desechable
createdb membego_e2e
export DATABASE_URL="postgresql://localhost:5432/membego_e2e"
export DIRECT_URL="$DATABASE_URL"
npx prisma db push --skip-generate --accept-data-loss

# 2) La aplicación construida (no `dev`: se prueba lo que se despliega)
npm run build
npx next start -p 3210 &

# 3) El recorrido
npm run e2e
```

Con un Chromium ya instalado en el sistema:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/ruta/a/chrome npm run e2e
```

Para ver qué pasó en un fallo: `npx playwright show-trace test-results/…/trace.zip`.

---

## 3. Qué se comprueba hoy

**28 pruebas** (14 escenarios × móvil y escritorio), verdes contra una
aplicación real con una base real.

| Grupo | Qué protege |
|---|---|
| Landing | Responde 200, lleva la marca, ofrece un camino visible para entrar, no deja errores de JavaScript en consola, y carga en menos de 8 s |
| Marketplace | Los listados de empresas y promociones cargan **aunque estén vacíos** |
| Acceso | El formulario tiene sus campos, una ruta protegida redirige al login conservando el destino, y no se acepta un `redirect` externo |
| Sistema | 404 con página propia, pantalla sin conexión, `/api/health` responde, `/api/metricas` **no** es público, el manifiesto de la PWA apunta al escáner |
| Seguridad | La portada llega con `X-Content-Type-Options`, CSP y `Referrer-Policy` |

Dos de ellas son **pruebas de regresión de arreglos anteriores**: la del
`redirect` externo protege el arreglo de la Fase 1 (C-05), y la de
`/api/metricas` protege la decisión de la Fase 6 de no exponer datos de negocio.
Ese es el tipo de detalle que un refactor se lleva por delante sin que nadie lo
note.

### Móvil primero

Los dos perfiles son un Pixel 7 y un Chrome de escritorio, en ese orden. El
grueso del tráfico de MembeGo es un teléfono; probar solo en 1920×1080 sería
probar el caso que casi nadie usa. La primera versión de la prueba de la landing
lo demostró: pasaba en escritorio y fallaba en móvil.

---

## 4. Lo que falta, y qué haría falta para tenerlo

**No está cubierto el recorrido autenticado**: registro → compra → pago → QR →
canje. Es decir, justo el que mueve dinero.

El motivo es concreto y no se arregla escribiendo más pruebas: la autenticación
la hace **Supabase Auth**, un servicio externo. Sin un proyecto de Supabase no
hay forma de crear una sesión, y usar el de producción para pruebas automáticas
significaría crear y borrar usuarios de verdad en la misma base donde están los
clientes reales.

Para cerrarlo hacen falta tres cosas, ninguna de código:

1. **Un proyecto de Supabase de pruebas**, separado del de producción. En el
   plan gratuito basta.
2. **Sus claves como secretos del repositorio** (`E2E_SUPABASE_URL`,
   `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`).
3. **Un juego de datos sembrado** antes de cada ejecución: una empresa, un plan,
   un empleado, un cliente con membresía activa y su QR. `prisma/seed.ts` ya
   existe y sería el punto de partida.

Con eso, el recorrido que habría que escribir —en este orden de valor— es:

1. Un empleado escanea un QR válido y registra una visita. **El más importante:
   es la operación central del negocio.**
2. El mismo QR escaneado dos veces se rechaza la segunda (idempotencia).
3. Un cliente compra una promoción y le llega su QR.
4. Un canje descuenta el uso y deja la compra consumida.
5. Abrir y cerrar una sesión de caja cuadrando el efectivo.
6. **Conversión desde el mapa (Fase 4)**: un car wash sin vehículo lo registra
   desde la oferta del mapa y vuelve al negocio; adquiere una promoción y el
   contexto de ubicación se conserva hasta volver al mapa. Ya está escrito y
   gateado en `tests/e2e/fase4-conversion.spec.ts` (se activa solo cuando
   existe `E2E_SUPABASE_URL`); es el criterio de aceptación §15 de
   `docs/GEOLOCALIZACION.md`.

Mientras tanto, decir "E2E del recorrido completo del cliente" sería falso.
Estas 28 pruebas cubren la puerta de entrada; el interior sigue sin red.

---

## 5. Reglas para escribir más

Aprendidas escribiendo estas, no en abstracto:

- **Selecciona por destino o por rol, no por texto.** La primera versión de la
  prueba de la landing buscaba `/iniciar sesión|entrar|acceder/` y falló porque
  el botón dice "Ingresar". Era un fallo de la prueba, no del producto: el texto
  es cosa de marketing y cambia cuando quiere; el `href="/login"` no puede
  cambiar sin romper el producto.
- **Prueba el vacío.** La base de CI nace sin datos en cada ejecución, y eso es
  una ventaja: obliga a que las pantallas vacías estén bien resueltas.
- **Ignora el ruido de servicios externos.** En CI no hay Supabase ni Sentry;
  sus errores de red en consola no son defectos del código que se prueba. Están
  filtrados explícitamente, no silenciados en general.
- **Una prueba sin aserción de negocio no vale.** Comprobar que una página
  devuelve 200 y nada más solo protege del error 500 — que es el único que sí
  aparece en Sentry.
