--- Membego Supply · el comprobante de un pedido vive en el bucket PRIVADO.
---
--- ────────────────────────────────────────────────────────────────────────────
--- QUÉ CAMBIA, Y POR QUÉ NO ES SOLO UN NOMBRE
---
--- `supply_pedidos.comprobanteUrl` nació guardando un enlace que el cliente
--- tecleaba a mano. Eso significaba que la prueba de un pago vivía donde el
--- cliente quisiera —un enlace de Drive, una foto en un chat— y que Membego
--- confirmaba dinero mirando algo que el propio interesado podía cambiar o
--- borrar después de que se lo aprobaran.
---
--- Ahora el archivo se sube al bucket privado `comprobantes`, que ya existe y
--- ya resolvió esto para las membresías y las compras (auditoría C-01): la
--- RUTA la genera el servidor con 16 bytes aleatorios, el cliente sube con un
--- token de un solo uso que no vale para otra ruta, y cada lectura se firma en
--- el momento previa comprobación de quién pregunta.
---
--- La columna pasa a llamarse `comprobantePath` porque es lo que guarda. Un
--- campo llamado `Url` que contiene una ruta es la clase de mentira pequeña que
--- hace que alguien, dentro de un año, se la pase a un `<img src>` y no
--- entienda por qué sale rota.
---
--- SEGURO DE APLICAR: la tabla se creó en `20261006_supply_cobro_plataforma` y
--- no hay ningún pedido en producción todavía. Aun así el renombrado va
--- guardado por `IF EXISTS`, y el CHECK que menciona la columna se actualiza
--- solo — PostgreSQL sigue el renombrado en las restricciones.
---
--- MARCHA ATRÁS: renombrar de vuelta.
---   ALTER TABLE "supply_pedidos" RENAME COLUMN "comprobantePath" TO "comprobanteUrl";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supply_pedidos' AND column_name = 'comprobanteUrl'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supply_pedidos' AND column_name = 'comprobantePath'
  ) THEN
    ALTER TABLE "supply_pedidos" RENAME COLUMN "comprobanteUrl" TO "comprobantePath";
  END IF;
END $$;
