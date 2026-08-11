# Membego global · Fase 0 — Auditoría y diseño técnico

**Alcance:** panel del cliente. **Estado:** auditoría terminada, sin código escrito.
**Fecha:** 2026-08-11

---

## 1 · El hallazgo que cambia el plan

Antes de nada, esto: **el problema no es el selector de la barra superior.**

Membego tiene un modo declarado —`src/modules/marketplace/marcaUnica.ts`— cuyo
comentario dice, literalmente:

> «De cara al cliente, la app se presenta como la app de UNA empresa (la
> principal): el registro entra directo a ella y la landing no habla de "muchas
> empresas" ni de categorías. Por dentro la plataforma sigue siendo
> multi-tenant.»

`esMarcaUnica()` devuelve `true` mientras haya **una sola empresa publicada**, y
en ese estado las pantallas multi-empresa **se saltan solas**:

```ts
// src/app/(cliente)/cliente/explorar/page.tsx:31
if (await esMarcaUnica()) redirect('/cliente/planes')
```

Es decir: **la arquitectura ya anticipó esta transición.** El comentario incluso
promete que las pantallas «reaparecen automáticamente cuando entre la segunda
empresa, sin migraciones».

### Por qué importa para el encargo

El prompt pide «eliminar la empresa obligatoria». La auditoría dice que hay
**dos problemas distintos** con soluciones distintas, y confundirlos haría el
trabajo el doble de grande:

| | Qué es | Cuánto cuesta |
|---|---|---|
| **A · Marca única** | Un interruptor que esconde el descubrimiento mientras haya una empresa | Decidir cuándo se apaga. Casi sin código |
| **B · La ficha activa** | `app_metadata.companyId` decide qué ve el cliente en 20 pantallas | El trabajo real de las fases 1-7 |

**Pregunta que necesito responderte para dimensionar todo:** ¿cuántas empresas
publicadas hay hoy en producción? Si es una, el cliente está viendo la app en
modo marca única y parte de lo que describes es ese modo, no un fallo.

---

## 2 · Dónde vive «la empresa seleccionada»

No es una cookie, ni un contexto de React, ni un store. Vive en el **token de
sesión de Supabase**:

```
app_metadata: { role, dbUserId, clienteId, companyId }
```

Lo escriben tres sitios:

| Archivo | Cuándo |
|---|---|
| `src/modules/cliente/actions.ts:66` (`switchCompany`) | El usuario cambia de empresa en el selector |
| `src/modules/cliente/actions.ts:189` (`afiliarmeAEmpresa`) | Se une a otra empresa |
| `src/lib/auth/reparar-contexto.ts:77` | **Automático, al entrar sin contexto** |

> Que viva en el token y no en el navegador es **una buena noticia** para este
> trabajo: no hay estado de cliente que sincronizar, y quitar la dependencia es
> dejar de leer un campo, no desmontar un sistema de estado.

### El nombre real de las cosas

El prompt sugiere buscar `selectedCompany`, `activeCompany`, `tenantId`… **Ninguno
existe.** Los nombres reales son:

```
user.metadata.companyId     la empresa activa
user.metadata.clienteId     la FICHA del cliente en esa empresa
conEmpresa(companyId, fn)   ejecuta con RLS acotado a esa empresa
sinEmpresa(motivo, fn)      lectura cross-tenant (app.omnisciente)
```

---

## 3 · La raíz más profunda: no existe un cliente sin empresa

`repararContextoCliente` (`src/lib/auth/reparar-contexto.ts:90-130`) hace esto
cuando alguien entra sin `clienteId`:

1. Busca `getEmpresaPrincipal()` — la destacada con menor `featuredOrder`, o la
   más antigua publicada.
2. **Le crea una ficha de `Cliente` en esa empresa.**
3. La sigue (`CompanyFollow`).
4. Le da el regalo de bienvenida de esa empresa.

No es un fallo: es lo que sostiene el modo marca única. Pero significa que **el
modelo actual no admite un cliente sin empresa**, y ese es el supuesto que el
encargo quiere invertir.

> **Esto es una decisión, no un detalle** (D-1 en § 9). Un cliente «de Membego y
> de nadie más» es un estado que hoy el sistema repara automáticamente para que
> deje de existir.

---

## 4 · Mapa de dependencias, medido

**33 pantallas de cliente. 20 dependen de la ficha o la empresa activa. 3 ya son
globales.**

| Pantalla | Depende de |
|---|---|
| `/cliente/inicio` | **empresa activa** (momentos, campañas, prueba social, gamificación) |
| `/cliente/planes` | ficha + empresa activa |
| `/cliente/pagos` | ficha + empresa activa |
| `/cliente/invita-y-gana` | ficha + empresa activa |
| `/cliente/regalos` (+3 subrutas) | ficha + empresa activa |
| `/cliente/citas`, `/historial`, `/vehiculos`, `/perfil`, `/ayuda` | ficha activa |
| `/cliente/empresas/[companySlug]` | ficha + empresa activa |
| `/mis-membresias`, `/membresia/[id]` | ficha activa |
| `/cliente/promociones/[id]` | empresa activa |
| **`/cliente/mis-promociones` (+2)** | **ya global** ✅ |
| `/cliente/explorar`, `/cerca`, `/promociones`, `/referidos`, `/ruleta`, `/dashboard` | ninguna ✅ |

Fuera de las pantallas: **48 módulos** de `src/modules` y `src/lib` leen
`metadata.companyId`.

### El precedente que ya funciona

`/cliente/mis-promociones` **ya es global**. Se hizo en esta misma sesión al
habilitar «adquirir recompensa de cualquier empresa», y el patrón que usa es
exactamente el que necesitan las otras 20:

```ts
const clienteIds = await misClienteIds(user.supabaseId)   // TODAS mis fichas
where: { clienteId: { in: clienteIds } }
```

Y destapó el fallo que se repetirá en cada pantalla que se migre:

> Al hacer global el listado, el **detalle** y el **paso de agendar** seguían
> comparando con la ficha activa y daban **404** — justo adonde redirige el
> botón nada más adquirir. Una pantalla no se migra sola: se migra con todo su
> camino.

---

## 5 · Aislamiento: qué NO se puede tocar

| Mecanismo | Estado |
|---|---|
| `conEmpresa()` → RLS por `app.company_id` | **675 llamadas.** Intacto |
| `sinEmpresa()` → `app.omnisciente` | **374 llamadas.** Es la puerta de las lecturas globales |
| RLS en base | `2026-07-rls-capa2-aislamiento.sql`, con `scripts/rls-cobertura.mjs` y `probar-rls.mjs` |

**La regla para todas las fases:** hacer una pantalla global significa cambiar
`conEmpresa(activa)` por una consulta acotada a **las fichas de la persona**, no
por `sinEmpresa`. `sinEmpresa` desactiva el aislamiento; usarlo para «ver más
cosas» sería exactamente el fallo que el prompt prohíbe en su § 4.2.

> Cada migración de pantalla tiene que decir explícitamente **qué acota la
> consulta** ahora que no la acota la empresa. Si la respuesta es «nada», la
> pantalla no está lista.

---

## 6 · Piezas que ya existen y no hay que construir

| Pieza | Qué hace | Estado |
|---|---|---|
| `CompanyFollow` | Seguir empresa, con `esFavorita` | ✅ Tabla y acciones |
| `misClienteIds(supabaseId)` | Todas las fichas de la persona | ✅ |
| `fichaEnEmpresa(supabaseId, companyId)` | Su ficha en UNA empresa | ✅ |
| `asegurarClienteEnEmpresa()` | Alta + seguimiento automático | ✅ |
| `getClienteCompanies()` | Lista de sus empresas | ✅ |
| `Cliente @@unique([supabaseId, companyId])` | Una persona, N empresas | ✅ **El modelo ya lo permite** |
| `/cliente/empresas/[companySlug]` | Página de empresa | ✅ Existe, hay que ampliarla |
| `/cliente/explorar`, `/cerca`, `/promociones` | Descubrimiento global | ✅ Existen |

**El modelo de datos no necesita migraciones para el núcleo de este trabajo.**
Lo que falta es de navegación y de consultas, no de esquema.

---

## 7 · Lo que se rompería si se hace mal

| Riesgo | Por qué |
|---|---|
| **El QR** | El prompt (§16) exige que valide el recurso exacto. Hoy el escáner resuelve contra la empresa; hay que auditarlo pantalla por pantalla **antes** de tocar nada |
| **Regalos y giftcards** | 4 rutas con ficha + empresa. Un regalo mal atribuido es dinero |
| **Invita y gana** | La campaña debe viajar en el enlace. Hoy depende de la empresa activa |
| **Pagos y facturas** | Comprobantes fiscales: no se puede perder el origen |
| **El panel de admin** | Usa el MISMO `metadata.companyId`. Tocarlo sin cuidado rompe el panel de empresa |
| **Marca única** | Apagarlo destapa pantallas que llevan tiempo sin usarse en producción |

---

## 8 · Plan por fases, ajustado al código real

Reordeno las del prompt según lo que la auditoría encontró. **Las dos primeras
son nuevas y salen del hallazgo del § 1.**

| Fase | Qué | Riesgo |
|---|---|---|
| **0** | Esta auditoría | — |
| **1** | **Decidir marca única.** Qué se apaga, cuándo, y verificar que las pantallas multi-empresa siguen vivas | Bajo |
| **2** | **Cliente sin empresa.** Que `repararContexto` no fuerce una ficha; el cliente existe en Membego, no en una empresa | **Alto** — toca el registro |
| **3** | Navegación global: menú agrupado, cabecera sin selector obligatorio, rutas base | Medio |
| **4** | Inicio global (§13 del prompt) | Medio |
| **5** | Mi Membego: migrar las 20 pantallas al patrón `misClienteIds`, **con su camino completo** | Medio, repetitivo |
| **6** | Explorar / ofertas / planes con filtros en URL | Medio |
| **7** | Perfil de empresa ampliado + seguir/dejar de seguir | Bajo |
| **8** | Invita y gana con campaña en el enlace | **Alto** — atribución de recompensas |
| **9** | Actividad global | Medio |
| **10** | Cerca de mí y sucursales | Bajo |
| **11** | Personalización por reglas + analítica | Bajo |
| **12** | QA final: rendimiento, accesibilidad, RLS, regresiones | — |

**Cada fase termina con:** typecheck, lint, `npm test`, build, y las guardias
nuevas que le correspondan. Igual que las siete fases de plataforma ya cerradas.

---

## 9 · Decisiones que necesito de ti

| # | Decisión | Por qué no la tomo yo |
|---|---|---|
| **D-1** | **¿Puede existir un cliente sin ninguna empresa?** Hoy el sistema le crea una ficha automáticamente al entrar | Cambia el registro, la bienvenida y el regalo de alta. Es el supuesto sobre el que está construido todo lo demás |
| **D-2** | **¿Cuántas empresas publicadas hay hoy?** Si es una, estás viendo el modo marca única | Dimensiona la mitad del trabajo |
| **D-3** | ¿Se apaga marca única ya, o cuando entre la segunda empresa? | Es un cambio visible en la app pública |
| **D-4** | El selector de empresa, ¿desaparece del cliente o queda como filtro? | El prompt dice filtro opcional; confirmar |
| **D-5** | ¿Qué pasa con el regalo de bienvenida si no hay empresa al registrarse? | Regla comercial |

---

## 10 · Lo que NO se hará sin autorización expresa

Siguiendo el § 27 del encargo: no se borrarán tablas ni columnas, no se
debilitará RLS, no se cambiará el funcionamiento del QR, no se tocarán reglas
comerciales ni estados financieros, y no habrá migraciones irreversibles.

Cualquiera de esas aparecerá como decisión antes de ejecutarse.

---

## Criterio de aceptación de esta fase

Debes poder entender **qué se cambiará, por qué y qué riesgos existen** antes de
que se modifique el proyecto.

**¿Apruebas esta fase para continuar con la siguiente?**
