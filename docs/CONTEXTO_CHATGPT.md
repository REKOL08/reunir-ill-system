# CONTEXTO PARA CHATGPT — Sistema ILL de la Red Reunir

> **Cómo usar este documento:** adjúntalo al inicio de una conversación con ChatGPT y escribe: *"Lee este documento. Quiero hacer un conversatorio sobre este sistema: responde como el desarrollador que lo conoce a fondo, explícame con claridad y propón mejoras cuando te las pida."*
>
> **Instrucciones para ChatGPT:** Eres un experto en Google Apps Script y en gestión de bibliotecas. Responde en español, con tono claro y didáctico. Basa tus respuestas SOLO en este documento; si algo no está aquí, dilo ("no consta en el documento") en vez de inventarlo. Si te piden código, entrégalo compatible con Google Apps Script (V8). Nunca pidas ni repitas credenciales, IDs de hojas ni URLs privadas.

---

## 1. ¿Qué es el sistema?

Sistema de **Préstamo Interbibliotecario (ILL, Interlibrary Loan)** de la **Red Reunir** (Red de Unidades de Información de Risaralda y Eje Cafetero, Colombia). Automatiza todo el trámite entre un usuario, su biblioteca de origen y la biblioteca prestamista, con correos automáticos, aprobaciones con un clic, control de plazos y trazabilidad.

- **Autor:** REKOL08 (AI Developer & Library Tech Specialist, Areandina — BIDIG).
- **Stack:** 100 % Google Workspace, costo $0: Google Forms (entrada), Google Sheets (base de datos), Google Apps Script (motor), Gmail/MailApp (correos), Google Calendar (fecha de devolución), GitHub Pages (landing).
- **Repositorio:** `github.com/REKOL08/reunir-ill-system` (`Code.gs`, `index.html`, `README.md`, `CHANGELOG.md`, este documento en `docs/`).
- **Estado:** en producción.

## 2. Flujo del proceso (según el diagrama institucional)

El sistema usa **dos validaciones en cadena** (origen y prestamista), no una:

1. **Usuario** llena el Google Form (no escribe correos de bibliotecas; se resuelven desde la hoja *Bibliotecas*).
2. El sistema registra la solicitud (ID `REQ-AAAAMMDD-NNNN`) y avisa a la **biblioteca de origen** (la del usuario) con botones **Aprobar / Rechazar**.
3. **Origen valida** al usuario (vigencia, multas, entregas pendientes). Al aprobar indica *vigencia del usuario* y *funcionario*; al rechazar, *motivo* y *funcionario*. Rechazo → se avisa al usuario y termina.
4. Si aprueba, se notifica a la **biblioteca prestamista** (la que tiene el material) y se informa al usuario que su biblioteca ya aprobó.
5. **Prestamista verifica disponibilidad**: aprueba (con funcionario) o rechaza por no disponibilidad (con motivo). Rechazo → se avisa al usuario y a la biblioteca de origen.
6. Si aprueba: el usuario recibe aviso de **retiro en 24 h**, la biblioteca de origen recibe aviso, y la prestamista recibe un correo con el botón **Confirmar entrega**.
7. **Ventana de retiro:** a las **24 h** se envía **un solo** recordatorio de retiro; a las **48 h** la solicitud se cierra como **"No retirada"** y se avisa a usuario, prestamista (liberar reserva) y origen.
8. **Entrega confirmada** (botón de la prestamista): estado *En préstamo*; se calcula la devolución con los **días de préstamo de esa biblioteca** (por defecto 15, máximo 120) y se crea un evento en Google Calendar con el usuario como invitado.
9. **Recordatorio** al usuario **3 días antes** del vencimiento (una sola vez); si se pasa la fecha, pasa a **Vencida** y se avisa al usuario y al administrador.
10. **Devolución** (botón, con funcionario y observaciones opcionales): estado *Devuelta*, se borra el evento de Calendar y se avisa al usuario y a la prestamista.

## 3. Estados de una solicitud

| Estado | Significado |
|---|---|
| En validación — biblioteca de origen | Esperando que origen valide al usuario |
| Rechazada por biblioteca de origen | Origen no autorizó (con motivo) |
| Aprobada por origen — verificando disponibilidad | Esperando a la prestamista |
| Rechazada por no disponibilidad | Prestamista rechazó (con motivo) |
| Aprobada — lista para retiro (24h) | Aprobada; el usuario tiene 24 h (límite 48 h) |
| No retirada — plazo de retiro vencido | Se cerró a las 48 h sin retiro |
| En préstamo | Material entregado; hay fecha de devolución |
| Devuelta | Proceso cerrado |
| Vencida | Pasó la fecha sin devolución |
| Pendiente — sin correo biblioteca de origen / prestamista | Falta el correo en la hoja *Bibliotecas*; se avisa al administrador |

## 4. Datos (Google Sheets)

**Hoja `Solicitudes` (31 columnas):** ID · Fecha solicitud · Nombre · Correo solicitante · Tipo de usuario · Número de documento · Programa académico · Biblioteca origen · Correo origen · Biblioteca prestamista · Correo prestamista · Tipo material · Título · Autor · Información/Observaciones · Estado · Autorización origen (SI/NO) · Vigencia del usuario · Funcionario origen · Fecha decisión origen · Motivo rechazo origen · Disponibilidad (SI/NO) · Funcionario prestamista · Fecha decisión prestamista · Motivo rechazo prestamista · Fecha préstamo · Fecha devolución esperada · Fecha devolución real · Se entregó material · ID Calendar · **Historial** (bitácora con fecha, actor y acción).

**Hoja `Bibliotecas`:** Nombre · Institución · Correo responsable · **Días de préstamo** · Ciudad/Red · Correo activo. Si el correo es "Sin correo registrado", la solicitud queda *Pendiente* y se avisa al administrador.

## 5. Estructura del código (`Code.gs`)

| Bloque | Función | Qué hace |
|---|---|---|
| CONFIG | `CONFIG` | IDs, URL del Web App, admin, días de préstamo (15/120), recordatorio (3 d), retiro (24 h / 48 h) |
| Datos | `getDatosBiblioteca`, `getCorreoBiblioteca`, `getDiasPrestamo` | Resuelven correo y plazo desde la hoja *Bibliotecas* |
| Entrada | `procesarFormularioReunir` → `_procesarFormularioReunir` | Trigger del Form; lee respuestas por nombre de pregunta, crea la fila y notifica a origen |
| Router | `doGet` → `_doGet` | Web App: recibe `?action=…&id=…`, valida el estado y muestra formularios de confirmación |
| Etapa 1 | `aprobarOrigen`, `rechazarOrigen` | Decisión de la biblioteca de origen |
| Etapa 2 | `aprobarPrestamista`, `rechazarPrestamista` | Decisión de la prestamista |
| Etapa 3 | `confirmarPrestamo`, `confirmarDevolucion` | Entrega (Calendar) y devolución |
| Diario | `verificarVencimientos` | Trigger diario 8:00: ventana de retiro, recordatorios, vencidas |
| Correos | `plantillaCorreo` | 16 plantillas HTML (validacion_origen, validacion_prestamista, confirmacion_solicitante, info_origen_aprobado, rechazada_origen, aprobada_final, aviso_origen_aprobado, confirmar_entrega, rechazada_prestamista, en_prestamo, recordatorio, recordatorio_retiro, retiro_vencido, retiro_vencido_prestamista, vencida, devuelta) |
| UI | `paginaAccion`, `respuestaHTML` | Páginas web de confirmación (campos: funcionario, vigencia, motivo…) |
| Auxiliares | `enviarCorreo`, `crearLinkAccion`, `buscarFila`, `fmt`, `fmtHora`, `parseFecha`, `parseFechaHora`, `logEntry`, `appendLog`, `escapeHtml` | Utilidades |
| Setup | `setupInicial`, `crearFormularioReunir`, `ajustarFormularioReunir`, `repararTriggerFormulario`, `verUrlFormulario`, `poblarHojaBibliotecas` | Instalación y mantenimiento |

**Acciones del Web App (`doGet`):** `aprobar_origen`/`confirmar_aprobar_origen`, `rechazar_origen`/`confirmar_rechazo_origen`, `aprobar_prestamista`/`confirmar_aprobar_prestamista`, `rechazar_prestamista`/`confirmar_rechazo_prestamista`, `confirmar_prestamo`/`confirmar_prestamo_final`, `confirmar_devolucion`/`confirmar_devolucion_final`. Cada decisión pasa por una página intermedia de confirmación (evita aprobaciones accidentales por vista previa del correo). Las acciones antiguas (`aprobar`, `rechazar`, `confirmar_rechazo`) muestran un aviso de "versión anterior".

## 6. Ajustes realizados en esta revisión (noviembre 2026)

1. **Bloqueo contra concurrencia** (`LockService`) en `doGet` y en el trigger del formulario: evita que un doble clic procese dos veces la misma aprobación y que dos envíos simultáneos generen el mismo ID.
2. **Recordatorio de devolución sin duplicados:** ahora verifica el *Historial* antes de enviar el aviso de "3 días antes" (antes podía repetirse si el trigger corría más de una vez ese día).
3. **Escape de HTML** (`escapeHtml`) en los parámetros de la URL que se muestran en pantalla (`action`, `id`): cierra una posible inyección de HTML/JS reflejada.
4. **Repositorio actualizado:** `Code.gs` del repo estaba desactualizado (flujo de una sola etapa, 19 columnas); ahora refleja el sistema real, **sin datos sensibles** (IDs, URL del Web App y correos reales reemplazados por marcadores). README y CHANGELOG actualizados.

**Para que los cambios apliquen en producción:** en Apps Script → *Implementar → Administrar implementaciones → Editar (lápiz) → Versión: Nueva versión → Implementar*. Se conserva la misma URL del Web App.

## 7. Pendientes y puntos de atención conocidos

- `CONFIG.FORM_URL` sigue con el marcador `PEGA_AQUI_LA_URL_DEL_GOOGLE_FORM`: ejecutar `verUrlFormulario()` y pegar la URL; así, quien abra el Web App sin parámetros será redirigido al formulario.
- Varias bibliotecas de la red aún están **"Sin correo registrado"** (no reciben notificaciones; el administrador es avisado y debe gestionarlas a mano).
- Cuota de Gmail: ~100 correos/día en cuenta personal, ~1.500 en Google Workspace. Cada solicitud completa genera ~8–10 correos.
- La hoja guarda nombres exactos de bibliotecas: si se renombra una, hay que actualizar *Bibliotecas* y ejecutar `ajustarFormularioReunir()`.
- Los textos de usuario (título, observaciones, motivo) se insertan en correos HTML sin escapar; riesgo bajo (remitente es el propio sistema), mejora posible.
- `ajustarFormularioReunir()` borra y recrea los campos del formulario (no las respuestas).
- El cálculo de "3 días antes" usa `Math.floor` de la diferencia en días sobre fecha+hora; puede disparar con ±1 día de diferencia según la hora de entrega.

## 8. Mantenimiento (qué ejecutar y cuándo)

| Función | Cuándo |
|---|---|
| `setupInicial()` | Una vez: crea hojas, encabezados y trigger diario |
| `crearFormularioReunir()` | Una vez: genera el Form conectado a la hoja |
| `repararTriggerFormulario()` | Si dejan de procesarse las solicitudes |
| `ajustarFormularioReunir()` | Cuando cambie la lista de bibliotecas |
| `verUrlFormulario()` | Para recuperar el enlace público del Form |
| `poblarHojaBibliotecas()` | Una vez (¡borra y reescribe la hoja Bibliotecas!) |

## 9. Preguntas para el conversatorio (sugeridas)

- ¿Por qué se usan dos validaciones (origen y prestamista) y qué problema resuelve cada una?
- ¿Qué pasa si un usuario no retira el material? ¿Y si nunca lo devuelve?
- ¿Cómo se evita que una aprobación se procese dos veces?
- ¿Qué riesgos de seguridad tiene un Web App con acceso "Cualquier persona" y cómo mitigarlos (tokens firmados, expiración de enlaces)?
- ¿Cómo escalar más allá de 100 correos/día? ¿Cómo agregar un tablero de indicadores (Looker Studio)?
- ¿Cómo se podría integrar con el catálogo de cada biblioteca o con WhatsApp?
- Redacta una capacitación de 15 minutos para los funcionarios de las bibliotecas.

## 10. Preguntas frecuentes

**¿Dónde veo el estado de una solicitud?** En la hoja *Solicitudes* (columna Estado) y en *Historial*. El usuario recibe un correo en cada cambio.
**¿Quién es "origen" y quién "prestamista"?** Origen = biblioteca a la que pertenece el usuario; prestamista = la que posee el material.
**¿Puede el usuario aprobar su propia solicitud?** No: solo recibe enlaces de confirmación de recepción y devolución; las decisiones van en correos a las bibliotecas.
**¿Cuánto dura un préstamo?** Lo define cada biblioteca (columna *Días préstamo*), por defecto 15 y máximo 120.
**¿Qué es el Historial?** Bitácora acumulativa con fecha, actor y acción de cada cambio; sirve de auditoría y evita repetir recordatorios.
