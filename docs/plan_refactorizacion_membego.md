# Plan de Implementación — Refactorización y Mejoras Arquitectónicas de MembeGo

Este documento presenta el plan de diseño técnico para ejecutar de manera ordenada las mejoras de arquitectura descritas en [docs/evaluacion_puntos_mejora_membego.md](file:///home/gbria/work/MEMBEGO/docs/evaluacion_puntos_mejora_membego.md). El objetivo principal es robustecer la plataforma en seguridad, rendimiento, tolerancia a fallos, asincronía y organización multi-tenant para prepararla de cara al crecimiento SaaS.

---

## Goal Description
El plan propone reestructurar el monolito de MembeGo mediante cambios secuenciales y modulares divididos en 7 componentes. Las modificaciones permitirán optimizar la carga del servidor y la base de datos, blindar la seguridad del aislamiento de empresas a nivel base de datos (RLS) y preparar el monorepo para separar físicamente la landing pública de la app privada.

---

## User Review Required

> [!IMPORTANT]
> **Puntos críticos que requieren confirmación o acción por parte de los administradores:**
> 1. **Activación de RLS (Capa 2) en Producción:** Habilitar Row Level Security a nivel base de datos requerirá aplicar sentencias SQL sobre Supabase. Esto impedirá de inmediato que cualquier consulta de la app que no envíe el contexto del tenant acceda a los datos.
> 2. **Transición a Monorepo:** La migración física de archivos para crear la estructura Turborepo reescribirá la ubicación de imports y configuraciones de Tailwind. Se requiere realizar un despliegue y pruebas visuales exhaustivas en un entorno de staging.
> 3. **Dependencia de Broker de Colas:** Se debe elegir la infraestructura para la ejecución asíncrona de tareas en segundo plano.

---

## Open Questions

> [!WARNING]
> **Preguntas abiertas clave para la aprobación del plan:**
> 1. **Broker de Colas asíncronas:** ¿Se prefiere usar **`pg-boss`** (aprovecha la misma base de datos Postgres de Supabase mediante colas basadas en tablas y Jobs asíncronos en Node.js, manteniendo simplicidad de infraestructura) o **`QStash` / `Upstash`** (completamente serverless por HTTP)?
> 2. **Timing del Corte de Dominios:** ¿Se planea realizar la separación de dominios (`membego.com` y `app.membego.com`) en la próxima ventana de mantenimiento, o se prefiere dejar la estructura de monorepo lista y posponer el cambio de DNS?

---

## Proposed Changes

El trabajo de refactorización se agrupa en los siguientes componentes lógicos:

### Componente 1: Autenticación y Middleware (Supabase Auth)
Optimizar la validación de sesión para erradicar las consultas redundantes y mitigar el error 429 (rate limits).

#### [MODIFY] `src/proxy.ts` (Middleware)
*   **Cambio:** Validar y decodificar localmente el JWT de Supabase extraído de las cookies mediante la firma criptográfica (usando `jose` o WebCrypto nativo) para rutas públicas o prefetches. No se realizarán llamadas HTTP a Supabase a menos que el token esté por expirar (menos de 5 minutos) o requiera refrescarse.
*   **Impacto:** Reducción del ~90% de llamadas API a Supabase en clicks y prefetches de navegación.

#### [NEW] `src/lib/auth/auth-service.ts`
*   **Cambio:** Crear un adaptador/abstracción `AuthService` para aislar las llamadas directas de la SDK de Supabase.
*   **Ejemplo de interfaz:**
    ```typescript
    export interface AuthService {
      getUser(): Promise<SessionUser | null>
      login(credentials: LoginInput): Promise<LoginResult>
      logout(): Promise<void>
    }
    ```

#### [MODIFY] `src/lib/auth/index.ts`
*   **Cambio:** Ajustar los reintentos automáticos para que no lancen redirecciones de logout ante fallos transitorios 5xx o 429 de red.

---

### Componente 2: Consultas N+1, pgBouncer y Paginación
Reducir el consumo de conexiones concurrentes y evitar los desbordamientos de memoria del servidor.

#### [MODIFY] `src/modules/admin/dashboardQueries.ts` y `src/modules/admin/queries.ts`
*   **Cambio:** Asegurar que las consultas pesadas usen el cargador de lotes y agrupaciones (`groupBy` de Prisma) para conteos y reportes financieros por empresa.
*   **Cambio:** Agregar cláusulas de paginación (`take: 50`, `skip`) a las queries de listados administrativos de pagos, clientes e historial de visitas.

#### [MODIFY] `.env` y configuración de Vercel
*   **Cambio:** Parametrizar el pooler agregando `&connection_limit=1&pool_timeout=20` en la cadena de conexión de producción de `DATABASE_URL` (pgBouncer puerto 6543).

---

### Componente 3: Aislamiento Tenant (RLS & Prisma Client Extensions)
Asegurar por contrato y a nivel base de datos que ninguna consulta acceda a datos de otra empresa.

#### [NEW] `prisma/migrations/20260803_enable_rls_policies/migration.sql`
*   **Cambio:** Migración SQL para habilitar RLS en las 33 tablas y definir políticas de aislamiento basadas en el `companyId` del contexto de la sesión.
*   **SQL de ejemplo:**
    ```sql
    ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation_policy ON "memberships"
      USING (company_id = current_setting('app.current_company_id', true));
    ```

#### [MODIFY] `src/lib/prisma.ts`
*   **Cambio:** Implementar una extensión del cliente Prisma (`prisma.$extends`) que inyecte de forma transparente en cada query el parámetro de base de datos `app.current_company_id` basado en el contexto de ejecución de la sesión actual.
*   **Ejemplo conceptual:**
    ```typescript
    export const prisma = new PrismaClient().$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            // Inyectar contexto del tenant en Postgres a nivel de transacción
            const companyId = getContextCompanyId()
            if (companyId) {
              await prisma.$executeRawUnsafe(`SET LOCAL app.current_company_id = '${companyId}';`)
            }
            return query(args)
          }
        }
      }
    })
    ```

---

### Componente 4: Separación en Monorepo (Turborepo)
Reorganizar la estructura de archivos para posibilitar despliegues independientes del Marketplace y la Aplicación Web.

#### [NEW] Estructura Monorepo (`package.json`, `turbo.json`, `pnpm-workspace.yaml` o workspaces de Bun)
*   **Cambio:** Crear workspaces en la raíz:
    ```
    ├── apps/
    │   ├── landing/       --> Web de marketing e ISR del Marketplace público
    │   └── app/           --> Aplicación privada (roles admin, cliente, empleado)
    └── packages/
        ├── ui/            --> UI compartida (shadcn y componentes de diseño base)
        └── shared/        --> Lógica común (tipos, validadores Zod, formateadores)
    ```

#### [MODIFY] `src/lib/site.ts`
*   **Cambio:** Habilitar el SSO cross-subdominio en cookies usando `sessionCookieDomain()` con el valor `.membego.com` para que el inicio de sesión persista al cambiar entre subdominios.

---

### Componente 5: Procesamiento Asíncrono y Bus de Eventos
Desacoplar la ejecución síncrona en las Server Actions de las tareas secundarias o de red.

#### [NEW] `src/lib/queue/` (Trabajo en segundo plano)
*   **Cambio:** Configurar el procesador de colas seleccionado (ej: `pg-boss` o adaptador HTTP).
*   **Cambio:** Rediseñar `src/lib/automation/` para que los desencadenadores de automatizaciones empujen un payload JSON ligero a la cola de trabajos en vez de evaluar y procesar en el hilo del request.
*   **Tareas a procesar asíncronamente:**
    *   Envío de emails transaccionales (Resend).
    *   Cálculo y asignación de hitos de referidos.
    *   Generación de logs de auditoría masivos.

---

### Componente 6: Validación de Datos Zod y Logs en Server Actions
Blindar los puntos de entrada de mutaciones de datos del backend.

#### [MODIFY] Server Actions en `src/modules/*`
*   **Cambio:** Reemplazar los chequeos manuales y ad-hoc en las acciones de registro, cobros, visitas y tickets por esquemas Zod estrictos.
*   **Cambio:** Envolver las mutaciones críticas en bloques try/catch que registren de manera automática las excepciones imprevistas en Sentry (`Sentry.captureException`) y devuelvan mensajes de error de cara al usuario seguros y sanitizados.

---

### Componente 7: Monetización SaaS
Añadir el control de planes y límites para las empresas en la plataforma.

#### [MODIFY] `prisma/schema/membresias.prisma` (u otros aplicables)
*   **Cambio:** Registrar los modelos `PlatformPlan` y `CompanyBilling` para registrar qué plan (Básico, Pro, Enterprise) tiene contratado cada tenant.
*   **MODIFY `src/proxy.ts` / layouts:** Agregar comprobaciones de quota para evitar que una empresa con plan expirado o superado en límites pueda crear nuevos empleados o sucursales.

---

## Verification Plan

### Automated Tests
*   **Ejecución de Pruebas Unitarias de Motores:**
    ```bash
    bun test
    ```
*   **Verificación del tipado estricto y compilación:**
    ```bash
    bun run db:generate && bun run build
    ```
*   **Auditoría de Esquema Prisma:**
    ```bash
    npx prisma validate
    ```

### Manual Verification
1.  **Redirecciones y Sesión:**
    *   Iniciar sesión como Administrador y verificar que no hay cierres de sesión aleatorios y que las cookies se fijan bajo el dominio `.membego.com`.
2.  **Verificación de Aislamiento Tenant (RLS):**
    *   Iniciar sesión como `admin.cartown@membego.com` e intentar consultar registros de otra empresa modificando IDs de forma maliciosa. Verificar que la base de datos deniega el acceso a nivel RLS devolviendo error de acceso.
3.  **Monitoreo del Pooler de Conexiones:**
    *   Cargar el dashboard administrativo ráfagas de veces consecutivas y observar los logs del servidor para confirmar la ausencia de errores `P2024` (exhaustion del pooler).
