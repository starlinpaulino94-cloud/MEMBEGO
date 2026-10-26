# Verificación de identidad · Fase 6 — Pruebas de seguridad y funcionales

Estado: **hecha y verificada con datos sintéticos** (nunca una imagen, un documento ni una cédula real: una prueba lo vigila). Lo que sigue sin
poder probarse desde aquí —el sandbox real de Didit, un navegador con sesión real, la configuración legal— está al final y es tuyo. Base:
[AUDITORIA-VERIFICACION-IDENTIDAD.md](./AUDITORIA-VERIFICACION-IDENTIDAD.md) y las notas de las fases 1 a 5.

## Cómo se prueba

| Capa | Dónde | Qué ejerce |
|---|---|---|
| Núcleo puro | `tests/identidad-*.test.ts` | Estados, transiciones, mensajes, firma del aviso, reglas, textos |
| Barridos y fuzz | `tests/identidad-seguridad.test.ts` | Todas las advertencias del proveedor, 400 alteraciones al azar de un aviso firmado, basura que nunca debe lanzar |
| Higiene del repositorio | `tests/identidad-seguridad.test.ts` | Ni imágenes ni vídeos ni PDF, ni cédulas con dígito verificador válido, ni claves versionadas |
| Dominio contra PostgreSQL | `tests/postgres/identidad*.db.test.ts` | Flujos completos con el Didit falso y firma real de los avisos |
| Rutas HTTP | `tests/postgres/identidad-rutas.db.test.ts` | Los manejadores reales, con Supabase simulado por token |
| Políticas de seguridad por fila | `tests/postgres/identidad-rls.db.test.ts` | El archivo real de políticas, probado como el rol `membego_app` |
| Guardas de código | `tests/identidad-guardas.test.ts` | Quién escribe qué, quién importa qué, que nada se abra por descuido |
| Mutaciones | (ver informe de la fase) | Se rompe cada protección y se comprueba que alguna prueba falla |

Los datos sintéticos están **en el código** (cédulas inventadas con sufijo aleatorio, respuestas falsas del proveedor). El Didit falso
(`tests/postgres/_helpers/didit-falso.ts`) contesta lo que se le dice, firma sus avisos con el mismo algoritmo que el real y no sale a la red.

## La matriz: cada escenario que pediste y dónde se prueba

Cada celda `archivo` «fragmento» se comprueba automáticamente (`tests/identidad-matriz-fase6.test.ts`): si alguien borra o renombra la prueba, esta
tabla deja de ser verdad y el test falla.

| # | Escenario | Dónde se prueba |
|---|---|---|
| 1 | Documento válido | `tests/postgres/identidad-rechazos.db.test.ts` «DOCUMENTO VÁLIDO»; `tests/postgres/identidad-proveedor.db.test.ts` «3 · APROBADO» |
| 2 | Documento inválido (vencido, ilegible, no soportado, alterado) | `tests/postgres/identidad-rechazos.db.test.ts` «documento vencido» «documento borroso (ilegible)» «documento de otro tipo (no soportado)» «documento impreso»; `tests/identidad-seguridad.test.ts` «CADA ADVERTENCIA CONOCIDA SE TRADUCE» |
| 3 | La selfie no coincide con el documento | `tests/postgres/identidad-rechazos.db.test.ts` «la selfie no coincide con el documento» |
| 4 | Prueba de vida fallida (y ataque a la prueba de vida) | `tests/postgres/identidad-rechazos.db.test.ts` «prueba de vida fallida (poca luz)» «ataque a la prueba de vida»; `tests/postgres/identidad-proveedor.db.test.ts` «UN FLUJO SIN PRUEBA DE VIDA NO ACREDITA» |
| 5 | Verificación interrumpida | `tests/postgres/identidad-rechazos.db.test.ts` «FLUJO INTERRUMPIDO»; `tests/postgres/identidad-proveedor.db.test.ts` «AVISO PERDIDO»; `tests/postgres/identidad.db.test.ts` «el barrido da por ABANDONADO» |
| 6 | Sesión expirada | `tests/postgres/identidad-rechazos.db.test.ts` «SESIÓN VENCIDA O ABANDONADA»; `tests/postgres/identidad.db.test.ts` «UNA VERIFICACIÓN VENCIDA NO VALE» |
| 7 | Webhook falso (sin firma, firma mala, alterado, viejo) | `tests/postgres/identidad-proveedor.db.test.ts` «UN AVISO SIN FIRMA, CON FIRMA MALA O VIEJO»; `tests/postgres/identidad-rutas.db.test.ts` «EL AVISO DEL PROVEEDOR»; `tests/identidad-seguridad.test.ts` «400 ALTERACIONES AL AZAR» |
| 8 | Webhook duplicado | `tests/postgres/identidad-proveedor.db.test.ts` «EL MISMO AVISO DOS VECES» «SEIS ENTREGAS SIMULTÁNEAS» |
| 9 | Eventos fuera de orden | `tests/postgres/identidad-proveedor.db.test.ts` «UN AVISO TARDÍO»; `tests/postgres/identidad.db.test.ts` «EVENTOS: repetido»; `tests/identidad-core.test.ts` «EVENTOS FUERA DE ORDEN» |
| 10 | Dos verificaciones simultáneas | `tests/postgres/identidad.db.test.ts` «DOS VERIFICACIONES SIMULTÁNEAS» «el candado del índice»; `tests/identidad-core.test.ts` «DOS VERIFICACIONES SIMULTÁNEAS» |
| 11 | Acceso de otra persona o empresa | `tests/postgres/identidad-rutas.db.test.ts` «EL ID DE OTRA PERSONA NO SIRVE»; `tests/postgres/identidad-rls.db.test.ts` «UNA PERSONA SOLO VE LO SUYO» «UNA EMPRESA, O UNA PETICIÓN SIN CONTEXTO»; `tests/postgres/identidad-equipo.db.test.ts` «SOLO EL EQUIPO»; `tests/postgres/identidad.db.test.ts` «LA PROYECCIÓN A LAS EMPRESAS» |
| 12 | Solicitud de borrado | `tests/postgres/identidad-proveedor.db.test.ts` «SUPRESIÓN: solo el equipo» «SI EL PROVEEDOR NO CONFIRMA» «ELIMINAR UNA CUENTA»; `tests/postgres/identidad-puerta.db.test.ts` «BORRAR MIS DATOS» |
| 13 | Reintento después de un rechazo | `tests/postgres/identidad.db.test.ts` «REINTENTO DESPUÉS DEL RECHAZO» «tres rechazos en la semana»; `tests/postgres/identidad-rechazos.db.test.ts` «espera obligatoria» |
| 14 | Proveedor inaccesible | `tests/postgres/identidad-proveedor.db.test.ts` «PROVEEDOR CAÍDO» «EL INTERRUPTOR AUTOMÁTICO»; `tests/postgres/identidad-rutas.db.test.ts` «PROVEEDOR CAÍDO: la ruta responde 503» |
| 15 | Persona ya verificada | `tests/postgres/identidad.db.test.ts` «CUENTA PREVIAMENTE VERIFICADA»; `tests/identidad-core.test.ts` «CUENTA PREVIAMENTE VERIFICADA» |

### Controles de seguridad y privacidad (más allá de la lista)

| Control | Dónde se prueba |
|---|---|
| Ninguna ruta atiende a quien no es cliente con sesión (sin cabecera, token falso, administrador, superadmin) | `tests/postgres/identidad-rutas.db.test.ts` «LAS CINCO RUTAS SOLO ATIENDEN» |
| La API no devuelve referencia del proveedor, hash ni documento, y no se guarda en caché | `tests/postgres/identidad-rutas.db.test.ts` «LO QUE LA API DEVUELVE» |
| Entradas mal formadas nunca dan 500 ni escriben | `tests/postgres/identidad-rutas.db.test.ts` «ENTRADAS MAL FORMADAS» |
| Las ráfagas se frenan (consulta de estado y apertura de sesiones) | `tests/postgres/identidad-rutas.db.test.ts` «UNA RÁFAGA SE FRENA»; `tests/postgres/identidad-puerta.db.test.ts` «EL LÍMITE DE USO» |
| La referencia del proveedor solo existe sellada | `tests/postgres/identidad.db.test.ts` «LA REFERENCIA DEL PROVEEDOR NUNCA VA EN CLARO» |
| Ningún log lleva la clave, la dirección con token ni el documento | `tests/postgres/identidad-proveedor.db.test.ts` «NINGÚN LOG lleva» |
| La bitácora no lleva datos personales | `tests/postgres/identidad.db.test.ts` «LA BITÁCORA NO LLEVA PII» |
| Una señal de fraude no se explica ni se reintenta, y dice lo mismo siempre | `tests/identidad-seguridad.test.ts` «LAS SEÑALES DE FRAUDE NO SE EXPLICAN»; `tests/postgres/identidad-rechazos.db.test.ts` «varias señales a la vez» |
| Un rechazo por fraude no se «lava» con un aviso posterior | `tests/postgres/identidad-rechazos.db.test.ts` «UN RECHAZO POR FRAUDE NO SE DESHACE» |
| El mismo documento en dos cuentas va a revisión sin decirlo | `tests/postgres/identidad.db.test.ts` «EL MISMO DOCUMENTO EN DOS CUENTAS»; `tests/postgres/identidad-proveedor.db.test.ts` «EL MISMO DOCUMENTO EN DOS CUENTAS por la vía del proveedor» |
| Consentimiento por versión del texto | `tests/postgres/identidad.db.test.ts` «ACEPTAR UN TEXTO Y ANOTAR OTRO» |
| La basura nunca lanza en la verificación de la firma | `tests/identidad-seguridad.test.ts` «LA BASURA NUNCA LANZA» |
| Políticas de seguridad por fila de todas las tablas de identidad | `tests/postgres/identidad-rls.db.test.ts` «NINGUNA TABLA DE IDENTIDAD QUEDA SIN RLS» |
| Sin imágenes, ni cédulas válidas, ni claves en el repositorio | `tests/identidad-seguridad.test.ts` «NI UNA IMAGEN, VÍDEO NI PDF» «NINGUNA CÉDULA CON DÍGITO VERIFICADOR VÁLIDO» «LAS CLAVES DE LA VERIFICACIÓN NO ESTÁN EN EL REPOSITORIO» |

## Lo que encontró esta fase

1. **Las políticas de seguridad por fila de identidad hoy no protegen nada en producción.** La aplicación se conecta como `postgres`, que se
   las salta (`src/lib/tenant.ts` lo dice a propósito). Las políticas son una segunda barrera que entra el día que `DATABASE_URL` pase a
   `membego_app`. Esta fase las probó de verdad (el archivo real, como ese rol) y están bien, pero **hay dos cosas para el despliegue**:
   a) el archivo `prisma/migrations_manual/2026-10-rls-identidad.sql` es manual y exige que la Capa 2 de RLS ya esté instalada (`membego_app`);
   b) mientras no cambie el rol de la aplicación, la defensa real es el código (cada lectura pasa por `conUsuario`/`sinEmpresa`, vigilado por
   `rls:cobertura` y por las guardas de esta carpeta). Va a la lista de despliegue de la Fase 7.
2. **Un hueco de mi propio trabajo que ya estaba cubierto por casualidad:** la política de la tabla de reglas (Fase 5) nunca se había
   ejecutado contra una base con el rol de la aplicación; ahora sí, y una prueba falla si una tabla nueva de identidad nace sin política.
3. **CORS de la API de la app:** `corsHeaders` (compartido por toda la API v1, no solo identidad) refleja el origen de la petición con
   `Allow-Credentials: true`. Para la app móvil (Bearer) no importa; para el navegador, lo que protege es que la cookie de sesión sea
   `SameSite=Lax`. No lo cambié porque es un patrón de toda la aplicación, pero conviene revisarlo: las rutas de identidad que escriben
   (`sesion`, `consentimientos`, `borrado`) aceptan también la cookie. **Decisión tuya.**
4. **El «en revisión» por documento repetido** no revela que la cédula tenga otra cuenta (la persona solo lee «estamos revisando»), pero sí se
   distingue de «verificada». Es el compromiso aceptado en la auditoría: no se puede ocultar del todo sin dejar pasar duplicados.
5. **La edad mínima de 18 años** la decide el flujo configurado en la consola de Didit, no el código. Aquí se comprueba que un rechazo por edad se
   trata como definitivo y visible; que Didit lo aplique hay que verlo en su sandbox.

## Lo que sigue sin poder probarse desde aquí (es tuyo)

- El **sandbox real de Didit** (`npm run identidad:probar-didit`, «Try Webhook» de su consola) con las muestras sintéticas que ellos entregan.
- Un **navegador o dispositivo con sesión real**: las pantallas solo se han probado con render de servidor, guardas y pruebas de ruta.
- La **configuración legal y contractual** (dictamen sobre la Ley 4-23, contrato con Didit, transferencia internacional).
- Aplicar el archivo de políticas en la base de producción y decidir cuándo pasar la aplicación al rol `membego_app`.

## Cómo repetirlo

```bash
npm test                                   # núcleo puro, guardas, higiene, matriz
npx tsx --conditions react-server --import ./scripts/supply-db/shim-next.mjs --test --test-concurrency=1 tests/postgres/identidad*.db.test.ts
```
