# 📚 Sistema ILL — Red Reunir

Préstamo Interbibliotecario (Interlibrary Loan) automatizado para la Red Reunir (Risaralda y Eje Cafetero, Colombia).

`Estado: En producción` · `Stack: Google Apps Script` · `Costo: $0`

> 💬 ¿Quieres conversar con ChatGPT sobre el sistema? Adjunta [`docs/CONTEXTO_CHATGPT.md`](docs/CONTEXTO_CHATGPT.md).

---

## 🎯 ¿Qué es?

Automatiza todo el trámite entre usuario, **biblioteca de origen** y **biblioteca prestamista**: formulario sin correos manuales, aprobaciones con un clic (con página de confirmación), control de retiro (24 h/48 h), cálculo de devolución, recordatorios y trazabilidad completa. 100 % Google Workspace.

## 🔄 Flujo

1. El usuario llena el Google Form.
2. Notificación a la **biblioteca de origen** → valida al usuario (vigencia, multas) → Aprobar / Rechazar con motivo.
3. Si aprueba → notificación a la **biblioteca prestamista** → confirma disponibilidad → Aprobar / Rechazar con motivo.
4. Aprobada → el usuario tiene **24 h** para retirar (recordatorio); a las **48 h** se cierra como "No retirada".
5. La prestamista confirma la **entrega** → fecha de devolución según los días de préstamo de esa biblioteca (15 por defecto, máx. 120) + evento en Calendar.
6. Recordatorio **3 días antes**; si vence, estado "Vencida" y aviso al administrador.
7. Registro de **devolución** con un clic.

## 📬 Estados

| Estado | Descripción |
|---|---|
| En validación — biblioteca de origen | Esperando validación del usuario |
| Rechazada por biblioteca de origen | Origen no autorizó (con motivo) |
| Aprobada por origen — verificando disponibilidad | Esperando a la prestamista |
| Rechazada por no disponibilidad | Prestamista rechazó (con motivo) |
| Aprobada — lista para retiro (24h) | Aprobada; plazo de retiro corriendo |
| No retirada — plazo de retiro vencido | Cerrada a las 48 h |
| En préstamo | Material entregado |
| Devuelta | Proceso cerrado |
| Vencida | Fecha de devolución superada |
| Pendiente — sin correo biblioteca de origen/prestamista | Falta correo en la hoja Bibliotecas; se avisa al admin |

## 📁 Estructura

```
reunir-ill-system/
├── index.html            # Landing (GitHub Pages)
├── Code.gs               # Apps Script completo (sin datos sensibles)
├── CHANGELOG.md
├── README.md
└── docs/CONTEXTO_CHATGPT.md   # Documento para conversar con ChatGPT
```

## ⚙️ Instalación

1. Crear un Google Sheet y copiar su ID.
2. En el Sheet: **Extensiones → Apps Script**, pegar `Code.gs`.
3. En `CONFIG` reemplazar `SHEET_ID`, `SHEET_URL`, `ADMIN_EMAIL` (y `WEBAPP_URL`/`FORM_URL` después de los pasos 5 y 6).
4. Ejecutar `setupInicial()` (crea hojas `Solicitudes` de 31 columnas y `Bibliotecas`, y el trigger diario).
5. **Implementar → Aplicación web** (ejecutar como *Yo*, acceso *Cualquier persona*) y pegar la URL en `CONFIG.WEBAPP_URL`.
6. Completar la hoja `Bibliotecas` (nombre, institución, correo, días de préstamo…) — o adaptar y ejecutar `poblarHojaBibliotecas()` —, luego ejecutar `crearFormularioReunir()` y `verUrlFormulario()`; pegar la URL en `CONFIG.FORM_URL`.
7. Ejecutar `repararTriggerFormulario()` para conectar el formulario.
8. Tras cada cambio de código: **Implementar → Administrar implementaciones → Nueva versión** (la URL se conserva).

## 🛠️ Mantenimiento

| Función | Cuándo |
|---|---|
| `setupInicial()` | Una vez |
| `crearFormularioReunir()` | Una vez |
| `ajustarFormularioReunir()` | Al cambiar la lista de bibliotecas |
| `repararTriggerFormulario()` | Si dejan de procesarse solicitudes |
| `verUrlFormulario()` | Recuperar el enlace del formulario |

## ⚠️ Límites de Google

Correos/día: 100 (cuenta personal) · 1.500 (Workspace). Ejecución: 6 min por llamada. Cada solicitud completa genera ~8–10 correos.

## 🔐 Notas de seguridad

El repositorio es público: **no subas** el ID del Sheet, la URL del Web App ni correos reales. Las acciones de los correos pasan por una página de confirmación, usan bloqueo contra dobles clics y escapan los parámetros mostrados.

## 👤 Desarrollado por

**REKOL08** — AI Developer & Library Tech Specialist · Areandina — BIDIG · [github.com/REKOL08](https://github.com/REKOL08)
