# Seguimiento y control de beneficios gratis (lavados gratis / recompensas)

> Módulo del panel para **controlar de punta a punta** las recompensas gratuitas
> que la empresa entrega (lavado gratis de bienvenida, premios de ruleta,
> beneficios de referido, promos de campaña…): quién las tiene, quién NO ha
> usado su QR, quién sí lo usó (y quién se lo canjeó), contactar a los que no
> han venido, canjear internamente un QR dejando registro, y reportes.

## 1. Sobre qué maquinaria se monta (investigación)

Una **recompensa gratis con QR** ya existe en el sistema como una
`ProductoCompra`:

- `tipo = PROMOCION`, `promocionId` apuntando a la promo (ej. "Lavado gratis").
- `precioCongelado` en **0 o null** → es gratis (no pasó por caja).
- `estado`: `ACTIVA` (disponible) · `CONSUMIDA` (sin usos) · `EXPIRADA` (venció).
- `usosIncluidos` / `usosRestantes` (un lavado gratis = 1 uso).
- `fechaActivacion`, `fechaVencimiento`, `consumidaAt`.
- Un `QrToken` (de un solo uso) vinculado por `compraId`; al canjearse se
  invalida y —si quedan usos— se regenera.

**Cuándo se canjea un QR** (`confirmarCanjePromocion`, ya existente):
- Invalida el token, descuenta un uso, crea una `Transaction` `PROMOTION_USE`
  con `empleadoId`, sucursal, fecha/hora, y deja `AuditLog` `QR_USADO`.
- Eso significa que **ya sabemos quién lo canjeó y cuándo** — solo faltaba
  exponerlo y organizarlo en un módulo de control.

Fuentes de recompensas gratis (todas caen en el mismo modelo): regalo de
bienvenida de campaña, premios de ruleta, recompensas de referido / Growth,
y promos con precio 0.

### Estados de seguimiento derivados

| Estado          | Regla                                                                 |
|-----------------|-----------------------------------------------------------------------|
| **Sin usar**    | ACTIVA, `usosRestantes == usosIncluidos`, con QR activo, sin canje aún |
| **Usado (parcial)** | ACTIVA pero `usosRestantes < usosIncluidos`                       |
| **Usado (completo)** | CONSUMIDA (`consumidaAt` fijada)                                  |
| **Vencido**     | EXPIRADA, o `fechaVencimiento < hoy` sin haberse consumido             |

## 2. Qué debe llevar un módulo de control como este (alcance completo)

Más allá de lo pedido, un control serio de recompensas incluye:

1. **Inventario filtrable** de todas las recompensas otorgadas, con su estado,
   el cliente y su contacto, la promo, fechas (otorgado / vence / usado) y quién
   la canjeó.
2. **KPIs**: otorgadas, sin usar, usadas, vencidas, **tasa de uso** (%),
   antigüedad promedio de las no usadas (días desde que se otorgó).
3. **Segmentos accionables**: "sin usar y por vencer en X días", "sin usar hace
   más de N días" (candidatos a recordatorio), "vencidas sin usar" (perdidas).
4. **Contacto directo** por WhatsApp (con plantilla) y correo, individual, más
   **recordatorio in-app** (notificación) individual o masivo al segmento.
5. **Canje interno por el admin**: leer/canjear el QR sin el cliente presente
   (entrega en mostrador), dejando **registro auditable** de que fue un canje
   INTERNO, con el admin responsable y fecha/hora exacta (marca en el snapshot
   de la transacción + `AuditLog` con acción distinguible).
6. **Reportes** exportables (CSV) e imprimibles, por promoción y por período;
   métricas de conversión (otorgadas → usadas).
7. **Parametrización**: qué promos se rastrean, umbral de "por vencer",
   días para el recordatorio automático, plantilla del mensaje.
8. **Recordatorio automático** (colgado del cron existente): avisar a los que
   no han usado su recompensa antes de que expire.
9. **Trazabilidad**: toda acción del admin (canje interno, recordatorio
   enviado) queda en auditoría — nada se pierde.

## 3. Plan por fases

**Fase S1 — Datos + vista de control (base)** ✅ *entregada*
- `src/modules/seguimiento/queries.ts`: inventario de recompensas gratis con
  estado derivado, contacto del cliente, promo, fechas, canjeador; KPIs;
  opciones de filtro (promos gratis).
- Página `/admin/seguimiento`: KPIs + filtros (estado, promoción, búsqueda de
  cliente, rango de fechas) + tabla. Sección `seguimiento` en ADMIN_SECTIONS +
  entrada en el menú. Sin cambios de esquema.

**Fase S2 — Contacto + canje interno + auditoría** ✅ *entregada*
- Botones de WhatsApp (plantilla "tu lavado gratis te espera") y correo por
  cliente. Recordatorio in-app individual.
- Canje INTERNO por el admin desde la tabla: reutiliza `confirmarCanjePromocion`
  con marca `canjeInterno` + admin responsable; nueva distinción en auditoría
  (`QR_USADO` con `interno:true`), fecha/hora exacta. Diálogo con confirmación.

**Fase S3 — Reportes + parametrización + recordatorio automático** ✅ *entregada*
- Export CSV (`/admin/seguimiento/export`, mismos filtros, hasta 5000 filas) +
  reporte imprimible (`/admin/seguimiento/imprimir`) con conversión
  otorgadas → usadas por promoción y por período.
- `Company.seguimientoConfig` (JSON, migración `20260754_seguimiento_config`):
  umbral "por vencer", recordatorio automático (activo/días antes/frecuencia),
  plantilla del mensaje ({cliente} {empresa} {recompensa} {vence}) y promos
  excluidas del rastreo. Panel de configuración en la misma página. El módulo
  funciona con defaults aunque la migración no se haya corrido; solo GUARDAR
  la configuración la requiere.
- Recordatorio automático en el cron diario (`recordatoriosSeguimientoAuto`):
  avisa in-app a los "sin usar y por vencer", deduplicado por la frecuencia
  configurada (los recordatorios manuales también cuentan) y con rastro en
  auditoría (`NOTA_INTERNA` payload `RECORDATORIO_SEGUIMIENTO`, `auto:true`).

### Migración pendiente de correr (Supabase SQL Editor)

```sql
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "seguimientoConfig" JSONB;
```

## 5. Cita antes del QR (extensión)

La cita es una **sugerencia, no un requisito**. Al adquirir un beneficio se
ofrece agendar, y el cliente puede **omitirlo**: el QR se entrega siempre.

Antes esto era un candado (sin cita no había QR) y se retiró: bloquear el uso
de algo que el cliente ya adquirió es hostil y genera soporte. Agendar sigue
siendo valioso para el negocio, así que se ofrece en dos momentos:

- **Al adquirir** → `/cliente/mis-promociones/<id>/agendar`: pantalla con
  "Agendar mi cita" y "Omitir por ahora". Si la empresa no tiene agenda activa
  (o el cliente ya agendó), redirige sola al detalle y no añade un paso vacío.
- **En el detalle del beneficio** → tarjeta "¿Quieres agendar tu cita?" cuando
  aún no hay cita. El QR se muestra igual, debajo.

`reservarCita` vincula `citas.compraId` tras crear la cita (defensivo: si la
columna no existe aún, la cita se crea igual sin vínculo). Con cita activa (no
CANCELADA/NO_ASISTIO) el QR aparece junto a la fecha de la cita. Migración
`20260756_cita_compra`.

La capacidad `CITA_ANTES_DEL_QR` ya **no decide si se entrega el QR**: decide
si se INVITA a agendar. Apagarla oculta la invitación y nada más.


## 4. Decisiones tomadas

- **Alcance de "recompensa gratis"**: `ProductoCompra` gratis con promoción y QR
  (cubre el lavado gratis y todas las fuentes). Los beneficios sin QR
  (BenefitGrant) quedan fuera de la V1 por no tener canje por QR.
- **Sin cambios de esquema en S1/S2**: todo se apoya en lo existente
  (ProductoCompra, QrToken, Transaction, AuditLog). S3 añade un JSON de config.
- El canje interno **no crea un modelo nuevo**: es el mismo canje real con una
  marca, para que el reporte de ingresos/uso siga siendo uno solo.
