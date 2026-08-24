import { expect, test } from '@playwright/test'

/**
 * EXCURSIONES · RESERVAS — los dos caminos por los que nace una reserva.
 *
 * 1) El cliente ya logueado entra por el QR de un vendedor y compra por carrito.
 * 2) El vendedor crea la reserva a un cliente nuevo desde su panel.
 *
 * NO CORREN EN CI, y el motivo es el mismo que en el resto de recorridos
 * autenticados del proyecto: ambos empiezan por un login real y siguen con
 * datos sembrados (una empresa, un vendedor con enlace `luis-tours`, una
 * excursión publicada con cupo). CI nace con la base vacía, así que sin el
 * harness estas pruebas no comprueban nada: solo fallan por falta de datos, y
 * un rojo permanente entrena a ignorar los checks. Se activan solas en cuanto
 * exista `E2E_SUPABASE_URL` (docs/PRUEBAS-E2E.md §4).
 *
 * Los selectores SÍ están verificados contra el marcado real de hoy, para que
 * el día que el harness exista estas pruebas midan el flujo y no se caigan por
 * localizadores inventados:
 *   · el formulario de login usa `id`+`<Label htmlFor>`, sin atributo `name`,
 *     así que se localiza por etiqueta (igual que el resto de specs);
 *   · en el detalle público de excursión los pasajeros se cambian con botones
 *     +/-, no con un campo de texto: `adultos` es un input OCULTO y `page.fill`
 *     sobre él no funciona. Esos botones eran solo icono, sin nombre accesible;
 *     se les puso `aria-label` —hacía falta para el lector de pantalla mucho
 *     antes que para esta prueba—;
 *   · el formulario del vendedor (`ReservaVendedorForm`) sí expone `name` en
 *     todos sus campos.
 */

const AUTENTICADO = Boolean(process.env.E2E_SUPABASE_URL)

test.describe('Flujos de Reserva de Excursiones', () => {
  test('Cliente logueado reserva por QR de vendedor (con carrito)', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login del cliente.
    await page.goto('/login')
    await page.getByLabel(/correo electrónico/i).fill('cliente@ejemplo.com')
    await page.getByLabel(/contraseña/i).fill('secreto123')
    await page.getByRole('button', { name: /entrar/i }).click()
    await page.waitForURL(/\/cliente/)

    // 2. Entrar por el QR del vendedor. Al estar logueado, va al catálogo.
    await page.goto('/e/luis-tours')
    await expect(page).toHaveURL(/\/empresas\/.*\/excursiones/)

    // 3. Abrir la primera excursión del catálogo. La tarjeta entera es el
    //    enlace (`ExcursionCard`), así que su nombre accesible es el título de
    //    la excursión —que depende de los datos sembrados— y se localiza por
    //    el destino, que no depende de ellos.
    await page.locator('a[href*="/excursiones/"]').first().click()

    // 4. Subir a 2 adultos. Aquí NO hay campo de texto: los pasajeros se
    //    cambian con los botones +/-, y el `input[name="adultos"]` que viaja
    //    en el formulario es oculto.
    await page.getByRole('button', { name: 'Añadir un adulto' }).click()
    await page.getByRole('button', { name: /agregar al carrito/i }).click()

    // 5. El carrito se abre con el ítem dentro.
    await expect(page.getByText(/tu carrito de excursiones/i)).toBeVisible()

    // 6. Confirmar la compra.
    await page.getByRole('button', { name: /confirmar reservas/i }).click()

    // 7. Termina en «mis excursiones» con la confirmación a la vista.
    await expect(page).toHaveURL(/\/cliente\/mis-excursiones/)
    await expect(page.getByText(/has reservado exitosamente/i)).toBeVisible()
  })

  test('Vendedor crea reserva a cliente nuevo desde el dashboard', async ({ page }) => {
    test.skip(!AUTENTICADO, 'requiere Supabase de pruebas (docs/PRUEBAS-E2E.md §4)')

    // 1. Login del vendedor.
    await page.goto('/login')
    await page.getByLabel(/correo electrónico/i).fill('luis.vendedor@ejemplo.com')
    await page.getByLabel(/contraseña/i).fill('secreto123')
    await page.getByRole('button', { name: /entrar/i }).click()
    await page.waitForURL(/\/vendedor/)

    // 2. Formulario de reserva nueva.
    await page.goto('/vendedor/reservas/nueva')

    // 3. Datos del cliente nuevo. El correo lleva marca de tiempo porque la
    //    reserva crea la cuenta: repetirlo chocaría con la corrida anterior.
    const correoNuevo = `nuevo-${Date.now()}@test.com`
    await page.fill('input[name="clienteNombre"]', 'Nuevo Cliente')
    await page.fill('input[name="clienteEmail"]', correoNuevo)

    // 4. Datos de la excursión.
    await page.fill('input[name="fecha"]', '2026-10-15')
    await page.selectOption('select[name="hora"]', { index: 1 })
    await page.fill('input[name="adultos"]', '3')

    // 5. Confirmar.
    await page.getByRole('button', { name: /crear reserva|guardar/i }).click()

    // 6. Vuelve a la lista con el aviso de éxito.
    await expect(page).toHaveURL(/\/vendedor\/reservas/)
    await expect(page.getByText(/creada exitosamente/i)).toBeVisible()
  })
})
