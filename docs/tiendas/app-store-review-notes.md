# App Store & Google Play Review Notes (Notas para Evaluadores)

Este documento contiene la información oficial para los revisores de Apple App Store y Google Play Store al momento de enviar compilaciones de **MembeGo** a revisión.

---

## 1. App Review Information (English - Apple App Store Connect & Google Play)

### App Purpose & Overview
**MembeGo** is a multi-merchant customer loyalty and membership management application based in the Dominican Republic. It enables consumers to discover local physical businesses (such as car washes, automotive centers, local retail, dining, and outdoor tour excursions), purchase in-person service memberships, and redeem exclusive benefits physically at merchant locations using dynamic QR codes.

---

### Exemption from In-App Purchases (Guideline 3.1.5(a) Compliance)

> **Important for the Reviewer:**
> MembeGo **does not sell digital content or in-app functionality**. All memberships, passes, and services offered through this application are **physical goods and services consumed exclusively outside the app in the real world**.

1. **Physical Car Wash & Detailing Memberships:**
   - Memberships include quotas of physical vehicle wash services performed at physical auto detailing shops (e.g., 4 exterior/interior washes per month).
   - Under **App Store Review Guideline 3.1.5(a)** (*Goods and Services Outside of the App*):
     > *"If your app enables people to purchase physical goods or services that will be consumed outside the app, you must use a purchase method other than in-app purchase, such as Apple Pay or traditional credit card processing."*
   - Payment is processed through **CardNET** (the regulated credit/debit card acquiring gateway in the Dominican Republic) and direct bank transfer verification.

2. **In-Person Retail & Dining Benefits:**
   - Memberships and promotional passes grant access to physical discounts redeemed in person by having the merchant scan the user's personal QR code at the physical point of sale (POS).
   - No digital items, digital currencies, or app-exclusive features are unlocked digitally through payment.

3. **Outdoor Excursions & Guided Tours:**
   - Tour bookings correspond to real-world tourism activities in the Dominican Republic (consumed physically outside the mobile app).

---

### User-Generated Content (UGC) & Safety (Guideline 1.2 Compliance)

MembeGo allows registered customers to share ratings and reviews about affiliated merchants:
- **Objectionable Content Reporting:** Every review features a visible flag icon (`Flag`) that opens a reporting modal. Users can report reviews for offensive content, harassment, spam, or false information.
- **Immediate User Blocking:** Users can choose to block any reviewer, immediately hiding all their reviews from their view.
- **Moderation SLA:** All reported content is reviewed by our administration and moderation team within **24 hours**, and violating content is permanently removed.
- **EULA & Community Guidelines:** Clear community guidelines are linked directly on the review screen and in our Terms of Service at [https://membego.com/terms](https://membego.com/terms).

---

### Account Deletion (Guideline 5.1.1(v) Compliance)

Users can delete their account and associated personal data directly within the application:
1. Navigate to: **Cuenta (Account)** tab (bottom dock) > **Configuración (Settings)**.
2. Under the **Eliminar cuenta** card, tap **"Eliminar mi cuenta"**.
3. Confirming the dialog permanently purges the user's client profile, personal records, and Supabase authentication credentials from our database.
4. A public web request form is also accessible at [https://membego.com/privacy](https://membego.com/privacy).

---

### Test Credentials for App Reviewers

Configure a dedicated staging account and its test data in the private review notes for App Store Connect and Google Play Console. Keep account credentials out of this repository.

- **Test Vehicle:** Pre-assigned test vehicle for car wash flow inspection.
- **Test Merchant:** Pre-configured demo company for reviewing store catalog, QR redemption preview, and review reporting.

---

## 2. Versión en Español (Google Play Console / Soporte Interno)

### Resumen para el Equipo de Revisión de Google Play
- **Cumplimiento de Pagos (Google Play Billing Policy):** La aplicación comercializa exclusivamente membresías para servicios físicos (lavados de autos y descuentos en comercios presenciales) y reservas de tours. De acuerdo con las políticas de Google Play, los servicios físicos fuera de la aplicación **no son elegibles** para Google Play Billing y deben procesarse mediante pasarelas externas seguras (CardNET).
- **Seguridad y UGC:** La sección de reseñas públicas cuenta con herramientas de denuncia instantánea de contenido inapropiado, bloqueo de autores y moderación garantizada en menos de 24 horas.
- **Eliminación de Datos:** El flujo de eliminación de cuenta está disponible en ajustes con purga completa de datos según la política de seguridad de datos (Data Safety).
