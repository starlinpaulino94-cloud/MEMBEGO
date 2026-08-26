# Excursiones · recorrido de prueba de punta a punta

Este documento es el guion del escenario §110 del prompt maestro, adaptado a lo
que el sistema hace hoy. Se recorre **en producción, con datos reales de
prueba**, porque es lo único que demuestra que las piezas encajan: las pruebas
automáticas cubren la aritmética y las reglas, no que el QR abra la pantalla
correcta en un teléfono.

**Qué está verificado automáticamente** (1355 pruebas, en cada PR): la
aritmética del dinero, la política de atribución, la jerarquía de reglas de
comisión, la máquina de estados, el corte de los períodos y el contenido del
CSV. **Qué NO puede estarlo**: que un teléfono escanee, que el correo llegue,
que el cajero entienda la pantalla.

---

## Preparación (una vez)

1. La empresa tiene la capacidad **EXCURSIONES** activada.
2. Existe al menos una **excursión ACTIVA** con una variante con precio.
3. Existe una **regla de comisión** (empieza por una general del 10%).

## El recorrido

### Captación
1. Crea un vendedor: **Vendedores → Nuevo vendedor**. Al terminar debe
   enseñarte su código, su enlace y su **QR**, sin buscar nada más.
2. Escanea ese QR **con un teléfono** (no con el navegador del escritorio).
   Debe abrir el registro de tu empresa y decir **«Te atiende [nombre]»**.
3. Vuelve atrás y escanéalo otra vez. En su perfil, **las visitas NO deben
   subir** — una por persona y enlace cada 24 horas.
4. Comparte el enlace por WhatsApp. La **vista previa del chat no debe contar**
   como visita.
5. Completa el registro con una cuenta nueva. En el perfil del vendedor deben
   aparecer **1 registro** y el cliente en «Últimos clientes captados».

### Reserva y cobro
6. **Reservas → Nueva reserva** para ese cliente. El total lo calcula MembeGo
   con los precios del catálogo.
7. La reserva debe salir con **ese vendedor atribuido** (no «Venta directa»).
8. Registra un **abono parcial**. El estado pasa a **Abonada** y el saldo baja.
9. Intenta pagar **más que el saldo**. Debe rechazarlo diciendo la cifra exacta.
10. **Anula** ese abono con un motivo. Vuelve a **Pendiente** y el pago queda
    tachado a la vista, no borrado.
11. Cobra el total. El estado pasa a **Pagada** y —desde el rediseño del
    catálogo— **la venta y la comisión se generan solas** en ese momento.

### Venta y comisión

> **Ojo, esto cambió.** La venta ya NO se confirma a mano: `registrarPago`
> llama a `procesarVentaYComisionInterna` en cuanto la reserva queda
> `PAGADA`. Y esa llamada va con `.catch(anotarFallo(...))`, o sea que **si
> falla, el pago se registra igual y el fallo solo queda en el log**. Por eso
> el paso 12 es ahora una COMPROBACIÓN, no una acción: si la comisión no
> apareció, el cobro no te lo va a avisar.

12. Sin tocar nada más, entra en la reserva. Debe existir ya la venta
    (`SAL-…`). Si no está, hay un fallo silencioso que hay que mirar en el log.
13. Debe existir también la **comisión con su desglose**
    («10% sobre X (venta sin impuestos)»).
14. La comisión NO debe calcularse sobre el impuesto.
15. Crea ahora una regla **específica para ese vendedor** (por ejemplo 20%).
    La comisión ya generada **no debe cambiar**: nació con su regla dentro.
16. Haz otra venta: esa sí debe usar la regla nueva.
17. Registra otro pago sobre una reserva ya saldada (o reintenta el cobro).
    **No debe duplicarse** ni la venta ni la comisión: la generación
    automática tiene que ser idempotente, y ahora se dispara en cada pago que
    deje la reserva en `PAGADA`.

### Liquidación
18. **Comisiones**: aprueba la comisión.
19. **Liquidaciones**: prepara la del vendedor para el mes. Debe incluirla y
    calcular el total sola.
20. Prepara **otra** liquidación del mismo período. **No debe reincluirla**.
21. Aprueba y **registra el pago** con método distinto de efectivo: debe exigir
    la **referencia**.
22. La comisión queda **Pagada** y ya no ofrece anular.
23. **Anula** la liquidación con un motivo: las comisiones no pagadas vuelven a
    quedar disponibles.

### El vendedor
24. En la ficha del vendedor, **Dar acceso** con un correo. La contraseña
    temporal se enseña **una sola vez**.
25. Entra con esas credenciales **desde un teléfono**. Debe ver su QR, sus
    clientes, sus reservas y su dinero.
26. Escribe `/admin/dashboard` a mano en esa sesión. **Debe rechazarte.**
27. Ponle una meta desde el panel. La barra debe avanzar **igual** en su
    pantalla y en la tuya.

### Reportes
28. **Reportes**: elige el mes y descarga el CSV. Ábrelo en Excel: los acentos
    deben verse bien y las columnas separadas. Debe traer el resumen, las
    ventas, las comisiones (con su columna de ajustes) y las liquidaciones con
    su referencia de pago.

---

## Lo que NO debe pasar en ningún paso

- Que una venta cancelada siga sumando en el panel.
- Que una comisión pagada se pueda anular con un botón.
- Que un vendedor vea datos de otro.
- Que el ticket promedio muestre `0` cuando no hubo ventas (debe decir «—»).
- Que un pago quede sin rastro de quién lo registró.
