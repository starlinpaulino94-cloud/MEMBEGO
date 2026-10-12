# Prueba de campo del piloto

Lista de verificación para una persona con teléfonos, un lector y una impresora **reales**. Nada de esto lo
puede probar un agente ni la CI: aquí es donde se decide si el piloto sale. Cada fila se marca ✅ / ❌ y se anota
el dispositivo, la hora y, si falla, una captura. Un ❌ en una fila **[BLOQUEA]** detiene el piloto; el resto se
registra y se prioriza.

> **Antes de empezar.** (1) Una empresa de prueba **no demo** con `CATALOGO_UNIFICADO`, `PEDIDOS_MEMBEGO` y
> `POS_MEMBEGO` encendidas (y `DEALS_MARKETPLACE` si se prueba la sección 3.4), una sucursal activa, 3 productos
> con existencias y 1 servicio. (2) Un cliente con sesión en cada dispositivo. (3) Un empleado con rol de escáner
> y un administrador de la empresa. (4) El superadmin, para la verificación bancaria. (5) La cuenta de cobro de la
> empresa en `/superadmin/facturacion` con el modelo `HYBRID` (CPA RD$ 100, 8 %): **encender la capacidad en una
> empresa real es empezar a cobrarle**; usa una de práctica o avísale. (6) La base y las claves **no** son las de
> producción hasta que el usuario lo decida (`docs/IMPLEMENTATION_STATUS.md` §16).

Dónde mirar mientras se prueba: `/admin/pedidos-membego` (empresa), `/cliente/pedidos` (cliente),
`/empleado/caja` (caja), `/admin/facturacion-membego` (lo que se le cobra a la empresa),
`/superadmin/facturacion/[empresa]` (libro y verificación bancaria), `/superadmin/conciliacion` (debe quedar
**sin hallazgos de severidad alta** al terminar la jornada).

---

## 1 · Consumidor

| # | Prueba | Resultado esperado | Bloquea | Dispositivo / nota | ✅/❌ |
|---|---|---|:-:|---|:-:|
| 1.1 | Android (Chrome y la app Expo): registrarse / entrar, ver la vitrina de la empresa, abrir un producto | Carga sin errores, precios y existencias coherentes con el panel | ✔ | | |
| 1.2 | iPhone (Safari y la app Expo): lo mismo | Igual; el teclado no tapa los botones de pago | ✔ | | |
| 1.3 | Wi-Fi estable: carrito → «Pedir» con pago al recoger | Pedido «Esperando a la empresa»; la empresa lo ve y recibe el aviso | ✔ | | |
| 1.4 | Datos móviles (4G): el mismo recorrido | Igual; sin pantallas en blanco | | | |
| 1.5 | Conexión **lenta** (3G simulado / una barra): pedir, confirmar el monto | Muestra «procesando», **no permite pedir dos veces**; si llega tarde, un solo pedido | ✔ | | |
| 1.6 | Perder la red a mitad de «Pedir» y recuperarla; reintentar | Un solo pedido (misma clave de idempotencia); ningún cobro doble | ✔ | | |
| 1.7 | Cliente ve «Mis pedidos»: confirma el monto ajustado por la empresa | Estado «El cliente confirmó»; el QR aparece cuando la empresa marca «Listo» | ✔ | | |
| 1.8 | Pedir «pagaré por transferencia»: abrir el pedido en «Mis pedidos» | Se ven las cuentas de la empresa y la referencia a usar; **el pedido sigue sin pago registrado** hasta que la empresa lo anote (ver 3.3) | ✔ | | |
| 1.9 | Cancelar su propio pedido antes de que esté listo | Se libera lo apartado; la existencia vuelve | | | |
| 1.10 | Una oferta con presupuesto (si aplica): reclamar | Un solo reclamo; el cupón/QR llega; sin presupuesto, mensaje claro | | | |

## 2 · QR (los casos que más dinero mueven)

Se prueba con el QR de un pedido **Listo** (vigencia 7 días) y, aparte, con el de una compra de Supply (5 min).

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 2.1 | QR **válido**, sucursal correcta | Cobra y cierra una vez; el cliente ve «Completado»; el stock baja una vez | ✔ | |
| 2.2 | QR **vencido** (pedido listo hace más de 7 días, o QR de Supply tras 5 min) | Rechazado con mensaje claro; **ningún** cambio de stock ni de dinero; el cliente puede renovar el QR (`renovarQrDeMiPedido`) | ✔ | |
| 2.3 | QR **reutilizado** (se escanea otra vez el mismo ya cobrado) | «Ya completado» / «no corresponde a ningún pedido»; **un solo** cobro, **una sola** comisión | ✔ | |
| 2.4 | **Captura de pantalla** del QR enviada por mensaje y escaneada por otra persona | Funciona **una sola vez** (el que llega primero); el segundo falla como 2.3. Anotar si el negocio acepta ese riesgo: el QR es portador | ✔ | |
| 2.5 | Dos empleados escanean el **mismo QR a la vez** (dos dispositivos) | Uno cobra, el otro recibe «ya completado»; sin dos comisiones | ✔ | |
| 2.6 | QR de **otra sucursal / otra empresa** | «Pertenece a otra empresa» o «sucursal incorrecta»; no cobra | ✔ | |
| 2.7 | QR inventado o texto cualquiera (o un código de barras de producto) | «No corresponde a ningún pedido»; sin efecto | | |
| 2.8 | Cliente con pedido en `AWAITING_MERCHANT`/`IN_PROGRESS` (sin QR): intentar cobrar por otra vía | No se puede cerrar sin QR ni pasar por «Listo» | | |

## 3 · Comerciante

### 3.1 Scanner y recogida (pickup)

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 3.1.1 | Empresa acepta → ajusta el monto (con motivo) → marca «Listo» | El cliente debe **volver a confirmar** si el monto cambió; el QR nace al marcar «Listo» | ✔ | |
| 3.1.2 | Entrega en mostrador: el cliente enseña el QR, el empleado escanea (cámara) | «Cobrado y entregado»; aparece en «Últimos cobros del turno» con su ticket | ✔ | |
| 3.1.3 | El pedido **ya pagado por transferencia** (registrada por la empresa) se entrega en caja | La caja lo entrega **sin cobrar otra vez**; la evidencia queda intacta; sin efectivo fantasma en el arqueo | ✔ | |

### 3.2 POS (venta de mostrador y caja)

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 3.2.1 | Abrir caja; vender 2 productos + 1 servicio en **efectivo con cambio** | Total y cambio correctos; ticket numerado; existencias bajan; **sin comisión** (venta espontánea) | ✔ | |
| 3.2.2 | Mismo envío dos veces (doble toque) | Una sola venta (misma clave) | ✔ | |
| 3.2.3 | Stock insuficiente en una línea | Falla **entero**: no se vende nada | ✔ | |
| 3.2.4 | Dos cajas abiertas: elegir con cuál se trabaja | Aparece el selector; con una sola caja no hay selector | | |
| 3.2.5 | Cerrar el turno: contar el efectivo | El arqueo cuadra con ventas en efectivo (no incluye transferencias ni tarjetas) | ✔ | |

### 3.3 Pago manual (tarjeta / transferencia) — la regla nueva

La referencia que **teclea el empleado** es la palabra del negocio, no evidencia financiera
(`docs/REGLAS_FINANCIERAS.md` §2).

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 3.3.1 | Cobrar en caja por transferencia con referencia `TRF-…` | Pedido completado en nivel **«Pago reportado por el negocio»** (`EXTERNAL_PAYMENT_REPORTED`), **no** «verificado»; comisión **CPA RD$ 100** | ✔ | |
| 3.3.2 | Cobrar con tarjeta sin número de autorización | Rechazado; el pedido sigue como estaba | | |
| 3.3.3 | El superadmin verifica ese pago contra el extracto (`/superadmin/facturacion/[empresa]` → «Verificar un pago contra el banco») con la línea del banco | Nivel pasa a **«Pago verificado»**; el libro recibe **un** asiento «Ajuste por pago verificado» por la diferencia hasta el 8 % (RD$ 400 totales sobre RD$ 5,000 = 100 + 300) | ✔ | |
| 3.3.4 | Repetir la verificación con la **misma** línea del banco | Sin efecto (idempotente); un solo ajuste | ✔ | |
| 3.3.5 | Verificar con **otra** referencia un pedido ya verificado | Rechazado («pago ya verificado») | | |

### 3.4 Reembolso

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 3.4.1 | Reembolsar un pedido completado (con y sin devolver al inventario) | Estado «Reembolsado»; el libro recibe el asiento contrario de la comisión **y**, si había ajuste, el de este | ✔ | |
| 3.4.2 | Reembolsar el mismo pedido otra vez | Sin efecto; nada se mueve | ✔ | |
| 3.4.3 | Reembolsar mientras el superadmin verifica el pago | El saldo de la empresa por ese pedido queda en **cero** al final (cubierto por la prueba de concurrencia 48; aquí, con humanos) | | |

### 3.5 Lo que se le cobra a la empresa

| # | Prueba | Resultado esperado | Bloquea | ✅/❌ |
|---|---|---|:-:|:-:|
| 3.5.1 | En `/admin/facturacion-membego`, el saldo coincide con la suma de comisiones − reembolsos del día | Cuadra al centavo con el libro | ✔ | |
| 3.5.2 | Un pedido de **Supply** o una venta espontánea de mostrador **no** aparece como comisión | No hay línea de cobro | ✔ | |
| 3.5.3 | `/superadmin/conciliacion` al final del día | Sin reglas de severidad ALTA; las MEDIA/BAJA se anotan | ✔ | |

## 4 · Hardware

| # | Prueba | Resultado esperado | Bloquea | Modelo | ✅/❌ |
|---|---|---|:-:|---|:-:|
| 4.1 | **Cámara** del teléfono del empleado, buen y mal luz, QR en pantalla agrietada | Lee en < 2 s con buena luz; con mala luz ofrece «Usar lector físico» | ✔ | | |
| 4.2 | **Lector** USB/Bluetooth tipo teclado (HID) — ráfaga de teclas + Enter | Detecta el lector solo (cadencia ≤ 45 ms), cierra el pedido, recupera el foco para el siguiente | ✔ | | |
| 4.3 | Lector con teclado en **otro idioma** (distribución que cambia `-`, `_`) | El token se lee completo o falla con mensaje claro; **nunca** cierra otro pedido | ✔ | | |
| 4.4 | **Impresora térmica** 58 mm y 80 mm: ticket de una venta | Texto completo, sin cortes; número `TCK-…` y total correctos | | | |
| 4.5 | Reimpresión del mismo ticket | Mismo número; no crea otra venta | | | |
| 4.6 | Cajón/otros periféricos | Anotar si se usan; no están integrados | | | |

## 5 · Interfaz

Para **cada** pantalla de la columna izquierda: móvil (360 px) y escritorio (≥ 1280 px), tema claro y oscuro.

| Pantalla | Móvil claro | Móvil oscuro | Escritorio claro | Escritorio oscuro |
|---|:-:|:-:|:-:|:-:|
| Vitrina y producto | | | | |
| Carrito y pago | | | | |
| Mis pedidos (con QR) | | | | |
| Caja (`/empleado/caja`) | | | | |
| Pedidos de la empresa (lista y ficha) | | | | |
| Facturación de la empresa | | | | |
| Superadmin: facturación + verificación | | | | |

Criterios: sin desbordamiento horizontal, textos legibles (contraste), botones de pago siempre alcanzables,
sin estados «cargando» infinitos, montos con `RD$` y dos decimales, el QR con contraste suficiente para la
cámara en tema oscuro.

---

## Cierre de la jornada

1. Exportar la hoja con todos los ✅/❌, dispositivos y capturas.
2. Revisar `/superadmin/conciliacion`, `/superadmin/riesgo` y el libro de la empresa de prueba.
3. Anotar los **[BLOQUEA]** en ❌ y decidir: corregir y repetir esa fila, o no salir al piloto.
4. Si algo tocó dinero real: **no** se corrige a mano en la base; se corrige con un asiento (`ADJUSTMENT`)
   desde el superadmin, con motivo, y queda en el libro.

**Qué NO cubre esta prueba:** pagos en línea (CardNET: **BLOCKED — EXTERNAL CREDENTIALS**), facturación fiscal
(e-CF/DGII: **BLOCKED — EXTERNAL / FISCAL INTEGRATION**), carga con cientos de usuarios simultáneos, ni
producción con el pooler de la base (el corte de RLS Capa 2 sigue siendo una decisión del usuario).
