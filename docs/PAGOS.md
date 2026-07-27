# Cobros en línea — CardNET y retiro de la transferencia

Este documento explica cómo está montado el cobro en línea, qué falta para
encender CardNET y **en qué orden** hacer el cambio para no quedarse sin poder
cobrar en el intento.

---

## 1. El resumen de una línea

CardNET está construido **hasta donde se puede construir sin el manual de
integración**. Falta el protocolo exacto (URLs, campos, firma, códigos de
aprobación), que CardNET entrega al abrir la cuenta de comercio. Todo lo demás
—registro de intentos, idempotencia, ruta de retorno, activación del producto,
retiro seguro de la transferencia— ya está hecho y probado.

---

## 2. Qué existe hoy

| Pieza | Archivo | Estado |
| --- | --- | --- |
| Puerto de pagos (contrato) | `src/lib/payments/index.ts` | Listo |
| Proveedor transferencia | `src/lib/payments/index.ts` | En producción |
| Proveedor CardNET | `src/lib/payments/cardnet.ts` | **Incompleto a propósito** |
| Registro de intentos | `src/modules/pagos/intentos.ts` | Listo |
| Ruta de retorno | `src/app/api/pagos/cardnet/retorno/route.ts` | Listo (llama a la verificación, que aún lanza) |
| Qué método se ofrece | `src/modules/pagos/metodosDisponibles.ts` | Listo |
| Panel de estado | `src/components/admin/EstadoPasarelas.tsx` → `/admin/metodos-pago` | Listo |
| Tabla `pago_intentos` | `prisma/migrations/20260763_pago_intentos/` | Aditiva, pendiente de correr |
| Capacidades | `PAGO_TRANSFERENCIA` (encendida), `PAGO_CARDNET` (apagada) | Listas |

---

## 3. Las tres reglas que sostienen el cobro

### 3.1 La aprobación la decide el servidor, nunca el navegador

Lo que llega a `/api/pagos/cardnet/retorno` viaja por el navegador del cliente.
Cualquiera puede fabricar esa petición con `aprobado=true`. Por eso de todo lo
que llega **se toma un solo dato** —el identificador de sesión— y con él se le
pregunta a CardNET, servidor a servidor, si la transacción se aprobó.

Dar por cobrada una compra por lo que dice un parámetro de la URL es la forma
más común de regalar producto.

### 3.2 Todo se activa exactamente una vez

El retorno del navegador y el webhook describen el mismo cobro, pueden llegar
los dos, en cualquier orden y repetidos. `PagoIntento.activadoAt` se escribe con
un `updateMany` condicional (`activadoAt: null` en el WHERE). Quien gana la
carrera activa; el resto no hace nada. Sin eso, un cliente que recarga la página
de retorno se lleva dos membresías por un pago.

### 3.3 El monto se compara, no se confía

`confirmarIntento` compara lo que la pasarela dice haber cobrado contra el monto
que guardamos **antes** de mandar al cliente a pagar. Si no coincide, no activa:
marca `ERROR` para revisión humana.

Y si el cobro ocurrió pero la activación falló, **no se revierte `activadoAt`**
(eso abriría la puerta a un doble cobro en el reintento): se anota el fallo en
`motivoRechazo` para que un administrador complete la entrega a mano.

---

## 4. Retirar la transferencia sin romper nada

### El problema

Apagar el método de golpe deja atrapadas las compras que ya iban por ese camino:
el cliente no puede subir su comprobante y tú no puedes validarlo. Dinero
trabado por ambos lados.

### La regla que lo resuelve

Una compra **comprometida** con la transferencia —ya eligió cuenta bancaria o ya
subió comprobante— sigue funcionando aunque la capacidad esté apagada. Una
compra que no se comprometió ve solo los métodos encendidos hoy.

Es deliberado que el criterio **no** sea el estado de la compra. Una compra
creada un minuto después de apagar la capacidad también nace en `SOLICITADA`, así
que "está esperando pago, luego es antigua" dejaría la transferencia encendida
para siempre. El compromiso, en cambio, solo pudo ocurrir cuando el método aún
se ofrecía.

Lo implementa `ofrecerTransferencia(companyId, yaComprometida)`.

### El orden correcto del cambio

1. Recibir de CardNET el manual y las credenciales de **pruebas**.
2. Completar los `PENDIENTE-CARDNET` de `src/lib/payments/cardnet.ts`.
3. Correr la migración `20260763_pago_intentos`.
4. Cargar `CARDNET_*` en el entorno de pruebas y **probar de verdad**: pago
   aprobado, pago rechazado, cliente que cierra el navegador a mitad, cliente
   que recarga la pantalla de retorno.
5. Encender `PAGO_CARDNET` **con la transferencia todavía encendida**. Conviven
   sin problema; el cliente elige.
6. Verificar en producción con un cobro real pequeño.
7. Mirar `/admin/metodos-pago`: el panel dice cuántas compras siguen dependiendo
   de la transferencia.
8. Recién entonces apagar `PAGO_TRANSFERENCIA`.
9. Terminar de validar a mano las compras comprometidas que queden.

> No saltarse el paso 5. Apagar la transferencia antes de que CardNET esté
> probado deja al negocio sin ninguna forma de cobrar en línea, y no se nota
> hasta que un cliente lo intenta.

**El pago presencial no se toca.** Pagar en el local sigue existiendo siempre;
solo se retira la transferencia bancaria.

---

## 5. Encender y apagar

```bash
# Ver el estado actual
npm run cap -- estado cartown

# Encender CardNET (con transferencia todavía encendida)
npm run cap -- on PAGO_CARDNET cartown

# Ya probado: retirar la transferencia
npm run cap -- off PAGO_TRANSFERENCIA cartown
```

Con `sql` delante (`npm run cap -- sql off PAGO_TRANSFERENCIA cartown`) el
script imprime el `UPDATE` para pegarlo en el SQL Editor de Supabase, sin
conectarse a la base de datos.

---

## 6. Variables de entorno

```
CARDNET_MERCHANT_ID=
CARDNET_TERMINAL_ID=
CARDNET_AUTH_KEY=
CARDNET_AMBIENTE=pruebas   # 'pruebas' | 'produccion'
```

`CARDNET_AUTH_KEY` es un **secreto**: va en variables de entorno, nunca en la
base de datos (donde quedaría legible para cualquiera con acceso de lectura, y
en los respaldos) y nunca en logs.

Si faltan las credenciales, `cardnetConfigurado()` devuelve `false` y CardNET no
se ofrece **aunque la capacidad esté encendida**. Así una capacidad encendida por
error no deja al cliente en una pantalla rota.

---

## 7. Lo que falta (PENDIENTE-CARDNET)

Todo está marcado con ese texto en `src/lib/payments/cardnet.ts`:

- [ ] URLs de sesión y de la pasarela (pruebas y producción)
- [ ] Nombres exactos de los campos del request
- [ ] Algoritmo del hash/firma y sobre qué cadena se calcula
- [ ] Códigos de respuesta que significan "aprobado"
- [ ] Llamada de verificación servidor-a-servidor
- [ ] Nombre real del parámetro de sesión en el retorno
      (`SESION_CANDIDATOS` en la ruta de retorno recoge las variantes probables)

Ninguno de estos puntos se adivinó. Un error ahí no da un fallo visible: da
compras marcadas como pagadas que nunca se cobraron, o cobros que el cliente
hizo y el sistema no reconoce.

La documentación pública de CardNET
(`developers.cardnet.com.do`) bloquea el acceso automatizado, así que estos
datos tienen que salir del manual que entregan al abrir la cuenta de comercio.

---

## 8. Modalidad elegida: botón de pago con pantalla (POST + 3DS)

El cliente introduce la tarjeta **en la pantalla de CardNET**, no en la nuestra.
Los datos de tarjeta nunca tocan este servidor, que es lo que mantiene el alcance
PCI al mínimo. El 3D Secure lo resuelve el banco emisor en esa misma pantalla.
