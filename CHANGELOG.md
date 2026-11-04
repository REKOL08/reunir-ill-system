# Changelog

## 2026-11-04
- **Code.gs sincronizado con el sistema en producción** (flujo de dos etapas: biblioteca de origen → prestamista; hoja de 31 columnas; ventana de retiro 24 h/48 h; días de préstamo por biblioteca). Los IDs, la URL del Web App y los correos reales se reemplazaron por marcadores.
- Nuevo: bloqueo `LockService` en `doGet` y en `procesarFormularioReunir` (evita dobles procesamientos e IDs repetidos).
- Fix: el recordatorio de devolución ya no se repite (se verifica el Historial).
- Seguridad: `escapeHtml()` para parámetros de URL mostrados en pantalla.
- Docs: README actualizado y `docs/CONTEXTO_CHATGPT.md` para conversar con ChatGPT sobre el sistema.
