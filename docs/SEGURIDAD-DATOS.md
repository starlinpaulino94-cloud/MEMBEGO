# Aislamiento de datos y credenciales

Fase 3 de `docs/AUDITORIA-PRODUCCION.md`.

## A-01 · Reclasificado de ALTO a CRÍTICO

El informe decía que el aislamiento multiempresa era "100 % aplicativo" y lo
clasificaba como defensa en profundidad pendiente. **Me quedé corto**, y la
comprobación que lo demuestra es de una línea:

```bash
grep -rn "GRANT\|REVOKE\|ENABLE ROW LEVEL SECURITY" prisma/migrations*/
```

No devuelve nada. Ninguna migración tocó jamás los privilegios de los roles
`anon` y `authenticated`, y ninguna tabla tiene RLS.

Eso importa porque Supabase **expone por PostgREST todas las tablas del esquema
`public`** y sus privilegios por defecto se los concede a esos dos roles. La
clave anónima viaja en el navegador: es pública por diseño. Si los privilegios
están puestos, esto lee la tabla entera saltándose la aplicación, los guards y
todo el filtrado por `companyId`:

```bash
curl 'https://<proyecto>.supabase.co/rest/v1/clientes?select=*' \
     -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>"
```

No es una fuga entre dos empresas: son todas las empresas a la vez.

**Haz ese `curl` antes de aplicar nada.** Si devuelve datos, estabas expuesto.
Si devuelve 401, ya estabas protegido y lo de abajo añade la segunda barrera.

### El arreglo

`prisma/migrations_manual/2026-07-cerrar-postgrest.sql`:

1. Revoca privilegios de `anon` y `authenticated` sobre el esquema `public`.
2. Cambia los **privilegios por defecto**, para que la próxima tabla que cree
   Prisma nazca cerrada. Este es el paso que se olvida y por el que el agujero
   reaparece tres migraciones después.
3. Activa RLS **sin políticas** en todas las tablas. Sin `FORCE`, así que el
   dueño (Prisma) sigue pasando; cualquier otro rol queda fuera aunque alguien
   vuelva a conceder privilegios por error.

**Por qué es seguro para la aplicación:** el navegador de MembeGo nunca consulta
tablas por PostgREST. Solo usa Supabase para Auth y Storage, que viven en otros
esquemas. Verificado: `grep -rn "supabase.from(" src` no devuelve nada fuera de
`storage.from(...)`.

### Lo que NO se hizo, y por qué

RLS **con políticas** por `companyId` —la versión completa— exige que cada
petición fije `app.company_id` en la sesión de base de datos, envolviendo cada
consulta en una transacción con `SET LOCAL`. Son ~150 archivos de módulos y un
riesgo real de romper escrituras en producción. RLS a medias es peor que nada.
Queda como trabajo propio, no colgado del final de otra fase.

## La red automática: `tests/aislamiento.test.ts`

Análisis estático que falla si una lectura múltiple sobre un modelo de empresa
no está acotada. Se ejecuta en cada `npm test` y en cada PR.

**Su alcance está medido, no supuesto.** La primera versión marcó 29 consultas
y **ninguna era una fuga**: todas estaban acotadas por una variable construida
arriba, por un helper, o por un identificador verificado en la línea anterior.
Resolver variables bajó a 20; resolver funciones y parámetros tipados, a 3; las
tres últimas eran del mismo tipo.

De ahí el alcance final: detecta con certeza la lectura **sin ningún filtro** y
las que no mencionan ninguna forma de acotado. No puede decidir si un
`where: { id }` estaba verificado arriba — eso exige entender el flujo del
programa. Es una red contra el descuido más común, no una demostración.

Una prueba con veinte falsos positivos no se arregla: se ignora, o alguien la
vacía. Por eso hay dos pruebas de guardia que fallan si se vacía la lista de
modelos o si una exención se añade sin motivo escrito.

## A-02 · Tokens QR

Venían de `@default(cuid())`. cuid está hecho para no **colisionar**, no para no
**adivinarse**: marca de tiempo + contador + huella de máquina + cuatro
caracteres al azar. Un token QR no es un identificador, es una credencial al
portador — vale un lavado, se manda por WhatsApp, se fotografía.

Ahora: 24 bytes de `randomBytes` en base64url (192 bits) generados por la
aplicación, y **caducidad a 90 días**. Antes un token vivía para siempre hasta
usarse: un QR compartido hace ocho meses seguía siendo canjeable.

90 días y no 7 a propósito: el QR de una membresía anual se enseña muchas veces
sin regenerarse. Una caducidad corta convertiría "mi QR no funciona" en el
problema más frecuente del negocio, y la respuesta del personal sería regenerar
sin mirar — que es peor que no tener caducidad.

Migración `20260769_qr_token_seguro`. Los tokens ya emitidos siguen funcionando;
solo se les pone fecha (90 días desde la migración, no desde su creación, para
no invalidar de golpe el QR que un cliente lleva hoy en el teléfono).

## A-04 · CSP

`'unsafe-eval'` fuera, sustituido por `'wasm-unsafe-eval'`. Lo único que
necesitaba evaluación dinámica era el decodificador wasm del escáner;
`'unsafe-eval'` habilitaba eso **y** `eval()` sobre cualquier cadena, que es la
primitiva que convierte un XSS en ejecución de código arbitrario.

`'unsafe-inline'` **se queda**, y conviene decirlo en vez de fingir que está
resuelto: el runtime de Next inyecta scripts inline para la hidratación.
Quitarlo exige CSP por nonce en todas las respuestas. El nonce **ya se emite**
(`src/proxy.ts`), así que el último paso es cambiar una cadena en
`next.config.ts` — pero necesita verificación en navegador de que ni la
hidratación ni el escáner se rompen. Activarlo a ciegas deja la aplicación en
blanco, y una pantalla en blanco no es más segura.

## Pendiente de esta fase

**Pentest externo** del flujo de pago y del canje QR. No es algo que se resuelva
escribiendo código: hace falta alguien de fuera intentando romperlo.
