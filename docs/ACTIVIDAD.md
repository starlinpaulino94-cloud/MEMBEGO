# Bitácora de actividad — fecha Y hora de cada acción

Regla de la plataforma: **toda acción registrable queda guardada con su fecha y
su hora exactas**, y se muestra así en la interfaz. Nunca "solo la fecha".

## Cómo se guarda

La tabla `audit_logs` (modelo `AuditLog`) guarda cada acción con:

| Campo | Qué es |
|---|---|
| `createdAt` | Momento exacto — `DateTime` con fecha, hora, minuto y segundo (UTC). |
| `accion` | Qué pasó (enum `AuditAccion`). |
| `userId` | Quién lo hizo (null = el sistema, p. ej. un cron). |
| `companyId` | De qué negocio. |
| `entidadTipo` / `entidadId` | Sobre qué objeto. |
| `payload` | Detalle libre: motivo, valores antes/después, placa, etc. |
| `ipAddress` / `userAgent` | Desde dónde. |

Postgres almacena en UTC; la interfaz convierte a la zona horaria de la empresa
(`Company.zonaHoraria`). Por eso una acción hecha a las 3:15 p. m. en Santo
Domingo se ve como 3:15 p. m., no como 19:15.

## Dónde se ve

| Pantalla | Quién | Qué muestra |
|---|---|---|
| `/admin/actividad` | Admin y supervisor del negocio | Las acciones de SU empresa, con hora exacta, filtros (acción, texto, rango de fechas) y export CSV. |
| `/superadmin/auditoria` | Superadmin | Lo mismo para TODAS las empresas, con columna de empresa. |
| `/admin/registros` | Admin | El ledger de transacciones (ventas, canjes, visitas) con fecha y hora. |

## Regla al programar

En `src/lib/format.ts`:

- **`formatDateTime(fecha, prefs)`** — úsalo siempre que muestres CUÁNDO OCURRIÓ
  algo: un cobro, un canje, una visita, una nota, un movimiento de inventario,
  un registro de cliente. Fecha + hora y minuto.
- **`formatDateTimeExacto(fecha, prefs)`** — igual pero CON SEGUNDOS. Para
  bitácoras de auditoría, donde el orden entre dos acciones seguidas importa.
- **`formatDate(fecha, prefs)`** — solo para conceptos que son de DÍA COMPLETO y
  donde una hora sería ruido o incluso engañosa: vencimiento de una membresía,
  fecha de nacimiento, vigencia de una promoción, límites de un período.

Al registrar una acción nueva, sigue el patrón que ya usan los módulos:

```ts
const meta = await getRequestMeta()          // ip + userAgent
await prisma.auditLog.create({
  data: {
    companyId,
    userId: user.metadata.dbUserId ?? null,
    accion: 'NOTA_INTERNA',                  // o la del enum que corresponda
    entidadTipo: 'Membership',
    entidadId: membership.id,
    payload: { tipo: 'AJUSTE_LAVADOS', antes, despues, motivo },
    ...meta,
  },
}).catch(() => {})                           // nunca tumbar la acción principal
```

`createdAt` se llena solo con el momento exacto — no hay que pasarlo.

Si tu acción usa `NOTA_INTERNA` como contenedor genérico, pon un `payload.tipo`
y agrégalo a `SUBTIPO_LABEL` en `src/modules/auditoria/queries.ts` para que la
bitácora lo muestre con nombre legible en vez del código crudo.
