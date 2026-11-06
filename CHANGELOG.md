# Changelog

## 2026-11-04
- **Code.gs sincronizado con el sistema en producción** (flujo de dos etapas: biblioteca de origen → prestamista; hoja de 31 columnas; ventana de retiro 24 h/48 h; días de préstamo por biblioteca). Los IDs, la URL del Web App y los correos reales se reemplazaron por marcadores.
- Nuevo: bloqueo `LockService` en `doGet` y en `procesarFormularioReunir` (evita dobles procesamientos e IDs repetidos).
- Fix: el recordatorio de devolución ya no se repite (se verifica el Historial).
- Seguridad: `escapeHtml()` para parámetros de URL mostrados en pantalla.
- Docs: README actualizado y `docs/CONTEXTO_CHATGPT.md` para conversar con ChatGPT sobre el sistema.

## 2026-11-06
- Presentación "El viaje del libro" para el lanzamiento en la Feria del Libro de Pereira 2026 (9 de noviembre, 3:00 p. m., Salón Pueblo Rico, Expofuturo): guion en `docs/presentacion_feria/GUION.md` y capturas del sistema (formulario y Apps Script) en `docs/presentacion_feria/capturas/`. Las capturas no muestran datos personales.

- Presentación web interactiva `presentacion/index.html` (animaciones, recorrido por las 7 fases, flujo paso a paso). Logo oficial de REUNIR (tomado de reunir.com.co). Se agrega a Nelly Herrera Vargas como coordinadora actual.
