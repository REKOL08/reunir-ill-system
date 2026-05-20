# 📚 Sistema ILL — Red Reunir
> Sistema automatizado de gestión de Préstamo Interbibliotecario para la Red Reunir (Colombia)

![Estado](https://img.shields.io/badge/Estado-En%20desarrollo-yellow)
![Stack](https://img.shields.io/badge/Stack-Google%20Suite-blue)
![Costo](https://img.shields.io/badge/Costo-Gratuito-brightgreen)

---

## 🎯 ¿Qué es esto?

Sistema de automatización completa del proceso de Préstamo Interbibliotecario (ILL) entre las bibliotecas de la red Reunir, construido 100% sobre Google Suite sin costos adicionales.

**Reemplaza** el flujo manual de Google Forms + Excel sin automatización por un sistema con notificaciones automáticas, aprobaciones con un clic y trazabilidad completa.

---

## 🔄 Flujo del proceso

```
Usuario llena Form → Notificación a biblioteca prestadora
→ Aprobación/Rechazo (1 clic desde correo)
→ Confirmación de recepción
→ Evento en Calendar (fecha devolución)
→ Recordatorio automático (3 días antes)
→ Registro de devolución
```

### Estados de cada solicitud
| Estado | Descripción |
|--------|-------------|
| 📬 Enviada | Formulario recibido |
| 🔍 En validación | Notificación enviada a biblioteca prestadora |
| ✅ Aprobada | Biblioteca prestadora aprobó |
| ❌ Rechazada | Biblioteca prestadora rechazó |
| 📖 En préstamo | Material entregado al solicitante |
| 📗 Devuelta | Material devuelto y proceso cerrado |
| 🚨 Vencida | Fecha de devolución superada |

---

## 🛠️ Stack tecnológico

| Herramienta | Uso | Costo |
|-------------|-----|-------|
| Google Forms | Formulario de solicitud | Gratuito |
| Google Sheets | Base de datos central | Gratuito |
| Google Apps Script | Motor de automatización | Gratuito |
| Gmail | Notificaciones automáticas | Gratuito |
| Google Calendar | Control de vencimientos | Gratuito |

---

## 📁 Estructura del repositorio

```
reunir-ill-system/
│
├── index.html          # Landing page (GitHub Pages)
├── Code.gs             # Google Apps Script completo
└── README.md           # Este archivo
```

---

## ⚙️ Instalación

### 1. Crear el Google Sheet
- Crear hoja nueva en [sheets.google.com](https://sheets.google.com)
- Copiar el ID de la URL: `docs.google.com/spreadsheets/d/**ESTE_ID**/edit`

### 2. Configurar Apps Script
- En el Sheet: **Extensiones → Apps Script**
- Pegar el contenido de `Code.gs`
- En `CONFIG`, reemplazar `TU_SHEET_ID_AQUI` con el ID del Sheet
- Reemplazar `admin@reunir.com.co` con el correo del administrador

### 3. Publicar como Web App
- **Implementar → Nueva implementación**
- Tipo: Aplicación web
- Ejecutar como: Yo
- Acceso: Cualquier persona
- Copiar la URL generada

### 4. Ejecutar setup inicial
- Seleccionar función `setupInicial`
- Ejecutar — crea hojas, encabezados y triggers automáticos

### 5. Crear el Google Form
Campos requeridos (en este orden):
1. Nombre completo del solicitante
2. Correo institucional
3. Institución solicitante
4. Biblioteca prestadora *(lista desplegable)*
5. Correo de la biblioteca prestadora
6. Tipo de material *(Libro / Revista / Artículo / Otro)*
7. Título
8. Autor
9. Observaciones

Vincular al Sheet: **Respuestas → icono Sheets → hoja "Solicitudes"**

### 6. Activar GitHub Pages
- Settings → Pages → Branch: main → Folder: / (root)
- La landing estará disponible en: `https://REKOL08.github.io/reunir-ill-system`

---

## 📧 Correos automáticos incluidos

| Evento | Destinatario |
|--------|-------------|
| Nueva solicitud recibida | Biblioteca prestadora |
| Confirmación de envío | Solicitante |
| Solicitud aprobada | Solicitante |
| Solicitud rechazada (con motivo) | Solicitante |
| Material en préstamo + fecha devolución | Solicitante |
| Recordatorio 3 días antes de vencer | Solicitante |
| Material vencido | Solicitante + Administrador |
| Devolución registrada | Solicitante + Biblioteca prestadora |

---

## ⚠️ Límites del plan gratuito de Google

| Recurso | Límite gratuito |
|---------|----------------|
| Correos/día (cuenta personal) | 100 |
| Correos/día (Google Workspace) | 1,500 |
| Tiempo ejecución Apps Script | 6 min/llamada |
| Almacenamiento Drive | 15 GB |

---

## 👤 Desarrollado por

**REKOL08** — AI Developer & Library Tech Specialist  
Universidad Tecnológica de Pereira | Areandina — BIDIG  
[github.com/REKOL08](https://github.com/REKOL08)

---

*Red Reunir — Sistema de Préstamo Interbibliotecario | Colombia*
