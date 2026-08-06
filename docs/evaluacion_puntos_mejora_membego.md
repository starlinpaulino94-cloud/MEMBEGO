# Evaluación y Puntos de Mejora Arquitectónicos — MembeGo

Este documento detalla una evaluación profunda de la arquitectura actual del ecosistema **MembeGo** (Next.js 16 + Supabase + Prisma). Aunque el sistema cuenta con bases sólidas, como el desacoplamiento de motores en `src/lib/`, existen áreas críticas de mejora en rendimiento, seguridad, escalabilidad de datos y preparación para un crecimiento SaaS multi-tenant.

---

## 1. Gestión de Autenticación y Sobrecarga en la Sesión (Supabase Auth)

### Situación Actual
La validación de la sesión del usuario (`getUser()`) recurre a llamadas directas al endpoint `/auth/v1/user` de Supabase. A pesar de haber introducido mejoras como `React.cache()` para memorizar solicitudes en una misma petición RSC, el flujo sigue expuesto a bloqueos transitorios por rate limits (HTTP 429) o latencia añadida.

### Puntos de Mejora
1. **Decodificación Local del JWT en el Middleware (`proxy.ts`)**: 
   Para peticiones públicas, prefetches RSC y recursos estáticos, el middleware no debería realizar llamadas de red para verificar si hay sesión. Debe decodificar y validar la firma del token JWT localmente utilizando la clave secreta de Supabase en el borde (*Edge*). Solo debe llamar a la red si necesita refrescar un token expirado.
2. **Abstracción del Proveedor de Autenticación (`AuthProvider`)**: 
   Actualmente, el código de autenticación está acoplado de forma directa a las APIs de Supabase. Encapsular la lógica en una interfaz genérica `AuthService` facilitará migrar de proveedor de identidad en el futuro (ej: Clerk, Auth0, Firebase Auth) sin alterar la UI ni el middleware.
3. **Manejo Resiliente de Errores de Red**:
   Cuando la API de autenticación de Supabase responde con un error de red (5xx) o límite de tasa (429), el sistema actual asume que el usuario "no tiene sesión" y lo expulsa al login. Se debe diferenciar un error de red o timeout de una sesión genuinamente inválida (401), aplicando reintentos o permitiendo un acceso *fail-safe* temporal basado en la cookie de sesión si esta tiene firma válida.

---

## 2. Optimización de Base de Datos y Pool de Conexiones

### Situación Actual
La base de datos utiliza pgBouncer en modo de transacción para maximizar conexiones concurrentes. No obstante, ráfagas de consultas pesadas e ineficientes pueden agotar los recursos disponibles del pooler, provocando timeouts (error Prisma P2024).

### Puntos de Mejora
1. **Reemplazo de Consultas N+1 por Agrupaciones (`groupBy`)**:
   En páginas como `/superadmin/reportes` y `/admin/dashboard`, el código realiza bucles de consultas concurrentes para obtener estadísticas por empresa o por plan. Estas operaciones deben centralizarse en queries únicas que utilicen agregaciones nativas de base de datos (`groupBy`, `_count`, `_sum`) en Prisma.
2. **Paginación Obligatoria en Tablas Calientes**:
   Muchas vistas del panel administrativo realizan consultas `findMany` sin limitar el número de filas (`take`), lo que provoca que toda la tabla se cargue en la memoria del servidor a medida que el negocio escala. Se debe forzar una paginación por cursor o desplazamiento (*offset*) en todos los listados de visitas, membresías e historial de pagos.
3. **Optimización del Cron de Automatizaciones**:
   El cron diario de automatizaciones realiza consultas de manera secuencial por cada empresa. Para escalar a cientos de tenants, este flujo debe rediseñarse para procesar en lotes (*batching*) paralelos controlados o diferirse a una cola de trabajo, evitando que expire por timeout de la función Serverless.

---

## 3. Fortalecimiento del Aislamiento Multi-tenant (Capa RLS)

### Situación Actual
El aislamiento de los datos por empresa (`companyId`) depende en gran medida de que el desarrollador recuerde incluir filtros `where: { companyId }` en las consultas Prisma. Esto representa un alto riesgo de fuga de información si ocurre un descuido técnico.

### Puntos de Mejora
1. **Políticas RLS en Base de Datos (Row-Level Security)**:
   Se debe completar la migración de políticas RLS de Capa 2. Esto consiste en definir en PostgreSQL que ningún rol de la aplicación (salvo el superadmin) pueda leer o escribir filas cuyo `companyId` no coincida con el almacenado en la sesión del usuario.
2. **Uso de un Contexto de Prisma Seguro**:
   Implementar extensiones de Prisma que inyecten el parámetro del tenant de forma automática en cada consulta (`prisma.$extends`). De este modo, la consulta base siempre incluye el filtro de aislamiento `companyId` de forma transparente para el desarrollador, reduciendo el error humano a cero.

---

## 4. Separación Física de Dominios (Marketplace vs. App)

### Situación Actual
La landing page de marketing y el marketplace conviven en el mismo monolito junto con la aplicación transaccional del dashboard. Comparten dependencias de bundles, middleware y políticas CSP (Content Security Policy).

```
[ Actualmente: Monolito Único ]
membego.com (Landing, Marketplace, Auth, Dashboard, Scanner, Admin)
```

### Puntos de Mejora (Separación a Monorepo)
Se propone avanzar hacia una separación física utilizando un monorepo administrado por **Turborepo**:

```
[ Monorepo Objetivo ]
├── apps/
│   ├── landing/       --> membego.com (ISR, SSR, SEO, contenido estático)
│   └── app/           --> app.membego.com (Paneles de cliente, admin, empleado, superadmin)
└── packages/
    ├── ui/            --> Sistema de diseño compartido (componentes shadcn/ui)
    └── shared/        --> Utilidades comunes de formato, tipos y validación Zod
```

*   **Ventajas en Rendimiento**: La landing se servirá de forma súper rápida con estrategias de Generación Estática Incremental (ISR/SSG) en la red de borde (CDN).
*   **Seguridad**: La aplicación en `app.membego.com` puede aplicar una política CSP sumamente restrictiva, mientras que la landing conserva políticas flexibles para scripts de marketing o analíticas (ej. Google Analytics).
*   **SSO Unificado**: La sesión de login se conserva compartiendo la cookie de Supabase configurando el dominio de la cookie como `.membego.com` (wildcard).

---

## 5. Arquitectura Asíncrona (Event-Driven & Workers)

### Situación Actual
Los flujos pesados —como enviar correos con Resend, evaluar reglas de fidelización o procesar referidos— ocurren de forma síncrona dentro del ciclo de vida de la petición HTTP del usuario (Server Actions). Si un servicio externo responde lento, el usuario experimenta demoras o la petición se cancela.

### Puntos de Mejora
1. **Introducción de una Cola de Mensajes (Message Broker)**:
   Adoptar una infraestructura de colas de tareas asíncronas ligera (como `pg-boss` para usar las colas en la misma base de datos Postgres, o servicios SaaS serverless como `QStash`).
2. **Arquitectura Dirigida por Eventos**:
   Al confirmar un pago o registrar una visita, la acción del servidor solo debe persistir el registro y emitir un evento rápido al bus (ej: `EVENTO_PAGO_CONFIRMADO`). Los procesos secundarios (notificación por email, generación de facturas PDF, asignación de puntos) deben consumirse de forma asíncrona mediante *background workers*:

```
[Acción de Usuario] ──► [Base de Datos]
                         │
                         └──► [Emitir Evento en Cola]
                                  │
                                  ├─► [Worker 1: Enviar Email] (Async)
                                  ├─► [Worker 2: Procesar Referido] (Async)
                                  └─► [Worker 3: Generar PDF] (Async)
```

---

## 6. Estandarización de Validación y Manejo de Errores

### Situación Actual
Muchas Server Actions reciben datos del frontend mediante `FormData` crudo o payloads de tipo genérico y aplican validaciones condicionales dispersas, acompañadas de capturas de error que tragan la excepción devolviendo valores nulos en silencio.

### Puntos de Mejora
1. **Adopción Sistemática de Zod en Server Actions**:
   Fijar un estándar de desarrollo donde toda acción defina obligatoriamente un esquema Zod de entrada. Las validaciones se ejecutan de manera uniforme y los errores de esquema se devuelven estructurados al frontend antes de tocar la base de datos o lógica de negocio.
2. **Gestión de Errores y Logs Estructurados**:
   Se debe evitar el silenciamiento de catch-blocks (`catch(() => null)`). Toda excepción imprevista debe:
    *   Registrarse en un sistema de logs estructurado con metadatos contextuales (tenant, rol, operación).
    *   Enviarse a Sentry en producción para alertas tempranas (`Sentry.captureException`).
    *   Retornar al cliente un mensaje genérico junto con un ID de correlación único para que soporte pueda rastrear el fallo en los servidores.

---

## 7. Preparación para Monetización SaaS y Límites por Plan

### Situación Actual
La base de datos y la arquitectura no contemplan límites de uso por empresa ni un esquema de facturación. Todas las empresas operan con acceso completo e ilimitado.

### Puntos de Mejora
1. **Esquema de Suscripción en Empresa (`Company`)**:
   Añadir al modelo de base de datos la vinculación de cada empresa con un "Plan de Plataforma" (ej: *Basic, Pro, Enterprise*), gestionando fechas de validez y ciclos de cobro mediante integraciones tipo Stripe o Cardnet.
2. **Middleware / Guards de Quotas**:
   Diseñar un motor interceptor a nivel de layouts o Server Actions que verifique los límites asignados al plan del cliente antes de permitir ejecuciones críticas:
    *   Número máximo de sucursales creadas.
    *   Número de empleados autorizados.
    *   Número de transacciones o QR procesados al mes.
    *   Acceso a playbooks premium de automatización.
