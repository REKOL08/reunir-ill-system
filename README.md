# 📚 Sistema ILL — Red Reunir

Sistema automatizado de gestión de Préstamo Interbibliotecario para la Red Reunir (Risaralda y Eje Cafetero, Colombia)

`Estado: En producción` · `Stack: Google Apps Script` · `Costo: $0`

---

## 🎯 ¿Qué es esto?

Sistema de automatización completa del proceso de Préstamo Interbibliotecario (ILL) entre las bibliotecas de la red Reunir, construido 100% sobre Google Suite sin costos adicionales.

Reemplaza el flujo manual de Google Forms + Excel sin automatización por un sistema con **resolución automática de correos**, notificaciones automáticas, aprobaciones con un clic y trazabilidad completa.

**Novedad clave de esta versión:** el solicitante ya no escribe el correo de la biblioteca prestadora. El sistema lo resuelve internamente a partir de una tabla de instituciones registradas — elimina errores de tipeo y simplifica el formulario.

---

## 🔄 Flujo del proceso

Usuario llena Form (sin escribir correos)

→ Sistema identifica el correo de la biblioteca automáticamente

→ Notificación a biblioteca prestadora (botones Aprobar/Rechazar)

→ Aprobación/Rechazo (1 clic desde correo, sin login)

→ Confirmación de recepción (botón en correo)

→ Cálculo automático de fecha de devolución (+15 días) + evento en Calendar

→ Recordatorio automático (3 días antes)

→ Registro de devolución (1 clic) + notificación a biblioteca

---

## 📬 Estados de cada solicitud

| Estado | Descripción |
|---|---|
| 📬 Enviada | Formulario recibido, correo de biblioteca resuelto automáticamente |
| 🔍 En validación | Notificación enviada a biblioteca prestadora |
| ✅ Aprobada | Biblioteca prestadora aprobó |
| ❌ Rechazada | Biblioteca prestadora rechazó (con motivo) |
| 📖 En préstamo | Material entregado, devolución calculada (+15 días) |
| 📗 Devuelta | Material devuelto y proceso cerrado |
| 🚨 Vencida | Fecha de devolución superada sin registrar devolución |
| ⏸️ Pendiente — sin correo biblioteca | Institución aún no tiene correo registrado; requiere gestión manual del administrador |

---

## 🛠️ Stack tecnológico

| Herramienta | Uso | Costo |
|---|---|---|
| Google Forms | Formulario de solicitud (sin campo de correo manual) | Gratuito |
| Google Sheets | Base de datos central (Solicitudes + Bibliotecas) | Gratuito |
| Google Apps Script | Motor de automatización completo | Gratuito |
| Gmail (MailApp) | Notificaciones automáticas con plantillas HTML | Gratuito |
| Google Calendar | Recordatorio automático de fecha de devolución | Gratuito |

---

## 📁 Estructura del repositorio

reunir-ill-system/

│

├── index.html          # Landing page (GitHub Pages)

├── Code.gs              # Google Apps Script completo

│   ├── CONFIG            # IDs, URLs, días de préstamo/recordatorio

│   ├── CORREOS_BIBLIOTECAS  # Tabla institución → correo responsable

│   ├── procesarFormularioReunir()  # Trigger principal del formulario

│   ├── doGet()            # Acciones por link (aprobar/rechazar/etc.)

│   ├── verificarVencimientos()  # Trigger diario de recordatorios

│   ├── plantillaCorreo()  # Plantillas HTML de los 8 correos

│   └── setupInicial()     # Configuración inicial (ejecutar 1 vez)

└── README.md            # Este archivo


---

## ⚙️ Instalación

### 1. Crear el Google Sheet
- Crear hoja nueva en [sheets.google.com](https://sheets.google.com)
- Copiar el ID de la URL: `docs.google.com/spreadsheets/d/**ESTE_ID**/edit`

### 2. Configurar Apps Script
- En el Sheet: **Extensiones → Apps Script**
- Pegar el contenido de `Code.gs`
- En `CONFIG`, reemplazar:
  - `SHEET_ID` con el ID del Sheet
  - `WEBAPP_URL` (se obtiene después de publicar — paso 3)
  - `ADMIN_EMAIL` con el correo del administrador de la red

### 3. Cargar las instituciones y sus correos
- Edita el objeto `CORREOS_BIBLIOTECAS` con el nombre exacto de cada institución de tu red
- Si aún no tienes el correo de una institución, déjalo en `null` — el sistema la marcará como `Pendiente` y avisará al administrador en lugar de fallar

```javascript
const CORREOS_BIBLIOTECAS = {
  "Nombre exacto de la institución": "correo@institucion.edu.co",
  "Institución sin correo aún":      null,
};
```

### 4. Publicar como Web App
- **Implementar → Nueva implementación**
- Tipo: **Aplicación web**
- Ejecutar como: **Yo**
- Acceso: **Cualquier persona**
- Copiar la URL generada y pegarla en `CONFIG.WEBAPP_URL`

### 5. Ejecutar setup inicial
- Seleccionar función `setupInicial`
- Ejecutar — crea las hojas `Solicitudes` y `Bibliotecas`, los encabezados y el trigger diario de vencimientos

### 6. Crear el formulario
- Ejecutar la función `crearFormularioReunir()` — genera el Google Form automáticamente con los campos correctos, usando las instituciones de `CORREOS_BIBLIOTECAS` como listas desplegables
- **El formulario ya no incluye un campo de correo de biblioteca** — ese dato se resuelve solo
- Si más adelante agregas instituciones nuevas a la tabla, ejecuta `ajustarFormularioReunir()` para actualizar las listas sin recrear el formulario

### 7. Conectar el trigger del formulario
- Ejecutar `repararTriggerFormulario()` — limpia triggers viejos y conecta `procesarFormularioReunir` al evento de envío del formulario

### 8. Activar GitHub Pages
- **Settings → Pages → Branch: main → Folder: / (root)**
- La landing estará disponible en: `https://REKOL08.github.io/reunir-ill-system`

---

## 📧 Correos automáticos incluidos

| Evento | Destinatario |
|---|---|
| Nueva solicitud recibida (con botones Aprobar/Rechazar) | Biblioteca prestadora |
| Confirmación de envío con ID de seguimiento | Solicitante |
| Solicitud aprobada (con botón confirmar recepción) | Solicitante |
| Solicitud rechazada (con motivo) | Solicitante |
| Material en préstamo + fecha límite de devolución | Solicitante |
| Recordatorio 3 días antes de vencer | Solicitante |
| Material vencido | Solicitante + Administrador |
| Devolución registrada | Solicitante + Biblioteca prestadora |
| Institución sin correo registrado | Administrador (gestión manual) |

---

## 🗂️ Columnas de la hoja "Solicitudes"

ID · Fecha solicitud · Nombre solicitante · Correo solicitante · Institución solicitante · Biblioteca prestadora · Correo biblioteca prestadora · Tipo material · Título · Autor · Observaciones · Estado · Fecha aprobación/rechazo · Motivo rechazo · Fecha préstamo · Fecha devolución esperada · Fecha devolución real · ID evento Calendar · **Historial** (log con fecha, actor y acción de cada cambio)

---

## 🛠️ Funciones de mantenimiento

| Función | Cuándo ejecutarla |
|---|---|
| `setupInicial()` | Una sola vez, al desplegar el sistema |
| `crearFormularioReunir()` | Una sola vez, para generar el formulario |
| `ajustarFormularioReunir()` | Cada vez que se agreguen instituciones a `CORREOS_BIBLIOTECAS` |
| `repararTriggerFormulario()` | Si las solicitudes dejan de procesarse automáticamente |
| `verUrlFormulario()` | Para recuperar el link público del formulario |

---

## ⚠️ Límites del plan gratuito de Google

| Recurso | Límite gratuito |
|---|---|
| Correos/día (cuenta personal) | 100 |
| Correos/día (Google Workspace) | 1.500 |
| Tiempo ejecución Apps Script | 6 min/llamada |
| Almacenamiento Drive | 15 GB |

---

## 📝 Notas

- Cada nueva implementación de la Web App genera una URL distinta — actualiza `CONFIG.WEBAPP_URL` y reimplementa si es necesario
- El sistema nunca pide al solicitante el correo de la biblioteca; si una institución no está en `CORREOS_BIBLIOTECAS`, la solicitud queda `Pendiente` sin perder los datos
- El historial (columna `Historial`) acumula cada cambio de estado con fecha y actor — útil para auditoría

---

## 👤 Desarrollado por

**REKOL08** — AI Developer & Library Tech Specialist
Universidad Tecnológica de Pereira | Areandina — BIDIG
[github.com/REKOL08](https://github.com/REKOL08)

Red Reunir — Sistema de Préstamo Interbibliotecario | Colombia



