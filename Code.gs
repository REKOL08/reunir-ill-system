// ============================================================
//  SISTEMA DE PRÉSTAMO INTERBIBLIOTECARIO — RED REUNIR
//  Google Apps Script — Pegar en: Extensions > Apps Script
// ============================================================

// ─── CONFIGURACIÓN CENTRAL ───────────────────────────────────
const CONFIG = {
  // ID del Google Sheet (está en la URL: /spreadsheets/d/ESTE_ID/edit)
  SHEET_ID: "TU_SHEET_ID_AQUI",

  // Nombre de las hojas
  HOJA_SOLICITUDES: "Solicitudes",
  HOJA_BIBLIOTECAS: "Bibliotecas",

  // Correo del administrador general de la red Reunir
  ADMIN_EMAIL: "admin@reunir.com.co",

  // Nombre que aparece como remitente en los correos
  NOMBRE_RED: "Red Reunir — Préstamo Interbibliotecario",

  // URL base del Google Sheet (para links en correos)
  SHEET_URL: "https://docs.google.com/spreadsheets/d/TU_SHEET_ID_AQUI/edit",

  // Días de préstamo por defecto
  DIAS_PRESTAMO: 15,

  // Días antes del vencimiento para enviar recordatorio
  DIAS_RECORDATORIO: 3,
};

// ─── COLUMNAS DE LA HOJA "Solicitudes" ───────────────────────
// A  = ID único
// B  = Fecha solicitud
// C  = Nombre solicitante
// D  = Correo solicitante
// E  = Institución solicitante
// F  = Biblioteca prestadora (destino)
// G  = Correo biblioteca prestadora
// H  = Tipo material (Libro/Revista/Artículo/Otro)
// I  = Título
// J  = Autor
// K  = Observaciones
// L  = Estado
// M  = Fecha aprobación/rechazo
// N  = Motivo rechazo
// O  = Fecha préstamo efectivo
// P  = Fecha devolución esperada
// Q  = Fecha devolución real
// R  = ID evento Calendar
// S  = Historial (log de cambios)

// ─── ESTADOS VÁLIDOS ─────────────────────────────────────────
const ESTADOS = {
  ENVIADA:      "Enviada",
  EN_VALIDACION:"En validación",
  APROBADA:     "Aprobada",
  RECHAZADA:    "Rechazada",
  EN_PRESTAMO:  "En préstamo",
  DEVUELTA:     "Devuelta",
  VENCIDA:      "Vencida",
};

// ============================================================
//  1. TRIGGER: Se dispara cada vez que alguien envía el Form
// ============================================================
function onFormSubmit(e) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const hoja  = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
    const ultima = hoja.getLastRow();
    const fila   = ultima; // La fila recién agregada por el Form

    // Generar ID único
    const id = "REQ-" + Utilities.formatDate(new Date(), "America/Bogota", "yyyyMMdd") 
               + "-" + String(ultima).padStart(4, "0");

    // Leer datos que llegaron del Form (columnas B en adelante)
    const datos = hoja.getRange(fila, 2, 1, 10).getValues()[0];
    // datos[0]=fecha, [1]=nombre, [2]=correo, [3]=institución,
    // [4]=bib.prestadora, [5]=correo prestadora, [6]=tipo, [7]=título, [8]=autor, [9]=obs

    // Escribir ID, estado inicial e historial
    hoja.getRange(fila, 1).setValue(id);
    hoja.getRange(fila, 12).setValue(ESTADOS.ENVIADA);
    hoja.getRange(fila, 19).setValue(logEntry("Solicitud creada", Session.getActiveUser().getEmail() || datos[2]));

    // ── Notificar a la biblioteca prestadora ──
    enviarCorreo({
      para:    datos[5], // correo biblioteca prestadora
      asunto:  `📚 Nueva solicitud de préstamo [${id}] — Red Reunir`,
      cuerpo:  plantillaCorreo("nueva_solicitud", {
        id, nombre: datos[1], institucion: datos[3],
        tipo: datos[6], titulo: datos[7], autor: datos[8],
        obs: datos[9],
        linkAprobar: crearLinkAccion(id, "aprobar"),
        linkRechazar: crearLinkAccion(id, "rechazar"),
        sheetUrl: CONFIG.SHEET_URL,
      })
    });

    // ── Confirmar al solicitante ──
    enviarCorreo({
      para:   datos[2],
      asunto: `✅ Solicitud recibida [${id}] — Red Reunir`,
      cuerpo: plantillaCorreo("confirmacion_solicitante", {
        id, nombre: datos[1], titulo: datos[7],
        bibPrestadora: datos[4],
      })
    });

    // Actualizar estado a "En validación"
    hoja.getRange(fila, 12).setValue(ESTADOS.EN_VALIDACION);
    appendLog(hoja, fila, "Estado → En validación (notificaciones enviadas)");

  } catch (err) {
    Logger.log("Error en onFormSubmit: " + err.message);
    MailApp.sendEmail(CONFIG.ADMIN_EMAIL, "⚠️ Error en sistema Reunir", err.message);
  }
}

// ============================================================
//  2. ACCIÓN: Aprobar o Rechazar desde link en correo
//     URL de la webapp: ?action=aprobar&id=REQ-xxx&token=xxx
// ============================================================
function doGet(e) {
  const action = e.parameter.action;
  const id     = e.parameter.id;
  const motivo = e.parameter.motivo || "";

  if (!action || !id) return respuestaHTML("❌ Parámetros inválidos.");

  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  const fila = buscarFila(hoja, id);

  if (!fila) return respuestaHTML("❌ Solicitud no encontrada: " + id);

  const datos = hoja.getRange(fila, 1, 1, 19).getValues()[0];
  const estadoActual = datos[11]; // columna L

  if (action === "aprobar") {
    if (estadoActual !== ESTADOS.EN_VALIDACION) {
      return respuestaHTML(`⚠️ Esta solicitud ya fue procesada. Estado actual: ${estadoActual}`);
    }
    return aprobarSolicitud(hoja, fila, datos, id);
  }

  if (action === "rechazar") {
    return paginaRechazo(id, motivo);
  }

  if (action === "confirmar_rechazo") {
    return rechazarSolicitud(hoja, fila, datos, id, motivo);
  }

  if (action === "confirmar_prestamo") {
    return confirmarPrestamo(hoja, fila, datos, id);
  }

  if (action === "confirmar_devolucion") {
    return confirmarDevolucion(hoja, fila, datos, id);
  }

  return respuestaHTML("❌ Acción no reconocida.");
}

// ─── Aprobar solicitud ────────────────────────────────────────
function aprobarSolicitud(hoja, fila, datos, id) {
  const ahora = new Date();
  hoja.getRange(fila, 12).setValue(ESTADOS.APROBADA);
  hoja.getRange(fila, 13).setValue(Utilities.formatDate(ahora, "America/Bogota", "dd/MM/yyyy HH:mm"));
  appendLog(hoja, fila, "Solicitud APROBADA por biblioteca prestadora");

  const nombre      = datos[2];  // col C
  const correoSol   = datos[3];  // col D
  const titulo      = datos[8];  // col I
  const bibPrest    = datos[5];  // col F
  const correoPrest = datos[6];  // col G

  // Notificar al solicitante
  enviarCorreo({
    para:   correoSol,
    asunto: `✅ Solicitud APROBADA [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("aprobada", {
      id, nombre, titulo, bibPrestadora: bibPrest,
      linkConfirmarPrestamo: crearLinkAccion(id, "confirmar_prestamo"),
    })
  });

  // Notificar al admin
  enviarCorreo({
    para:   CONFIG.ADMIN_EMAIL,
    asunto: `[Reunir] Solicitud aprobada: ${id}`,
    cuerpo: `La solicitud ${id} (${titulo}) fue aprobada por ${bibPrest}.`,
  });

  return respuestaHTML(`✅ Solicitud <strong>${id}</strong> aprobada correctamente.<br>El solicitante ha sido notificado.`);
}

// ─── Rechazar solicitud ───────────────────────────────────────
function paginaRechazo(id, motivoPrevio) {
  const html = `
    <html><body style="font-family:Arial;max-width:500px;margin:40px auto;padding:20px">
    <h2>❌ Rechazar solicitud ${id}</h2>
    <p>Por favor indica el motivo del rechazo:</p>
    <form method="get" action="${ScriptApp.getService().getUrl()}">
      <input type="hidden" name="action" value="confirmar_rechazo">
      <input type="hidden" name="id" value="${id}">
      <textarea name="motivo" rows="4" style="width:100%;padding:8px" 
        placeholder="Ej: Material no disponible, requiere renovación, etc.">${motivoPrevio}</textarea>
      <br><br>
      <button type="submit" style="background:#c0392b;color:white;padding:10px 20px;border:none;border-radius:4px;cursor:pointer">
        Confirmar Rechazo
      </button>
    </form>
    </body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle("Rechazar solicitud");
}

function rechazarSolicitud(hoja, fila, datos, id, motivo) {
  const ahora = new Date();
  hoja.getRange(fila, 12).setValue(ESTADOS.RECHAZADA);
  hoja.getRange(fila, 13).setValue(Utilities.formatDate(ahora, "America/Bogota", "dd/MM/yyyy HH:mm"));
  hoja.getRange(fila, 14).setValue(motivo);
  appendLog(hoja, fila, `Solicitud RECHAZADA. Motivo: ${motivo}`);

  enviarCorreo({
    para:   datos[3],
    asunto: `❌ Solicitud RECHAZADA [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("rechazada", {
      id, nombre: datos[2], titulo: datos[8],
      bibPrestadora: datos[5], motivo,
    })
  });

  return respuestaHTML(`Solicitud <strong>${id}</strong> rechazada. El solicitante fue notificado.`);
}

// ─── Confirmar préstamo físico ────────────────────────────────
function confirmarPrestamo(hoja, fila, datos, id) {
  const ahora       = new Date();
  const devolucion  = new Date(ahora);
  devolucion.setDate(devolucion.getDate() + CONFIG.DIAS_PRESTAMO);

  hoja.getRange(fila, 12).setValue(ESTADOS.EN_PRESTAMO);
  hoja.getRange(fila, 15).setValue(Utilities.formatDate(ahora, "America/Bogota", "dd/MM/yyyy"));
  hoja.getRange(fila, 16).setValue(Utilities.formatDate(devolucion, "America/Bogota", "dd/MM/yyyy"));
  appendLog(hoja, fila, `Préstamo confirmado. Devolución: ${Utilities.formatDate(devolucion, "America/Bogota", "dd/MM/yyyy")}`);

  // Crear evento en Google Calendar
  try {
    const cal       = CalendarApp.getDefaultCalendar();
    const evento    = cal.createEvent(
      `📚 Devolución préstamo ${id} — ${datos[8]}`,
      devolucion, devolucion,
      { description: `Solicitud: ${id}\nSolicitante: ${datos[2]}\nTítulo: ${datos[8]}`, guests: datos[3] }
    );
    hoja.getRange(fila, 18).setValue(evento.getId());
  } catch (calErr) {
    Logger.log("Calendar error: " + calErr.message);
  }

  // Notificar al solicitante con fecha de devolución
  enviarCorreo({
    para:   datos[3],
    asunto: `📖 Material en camino [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("en_prestamo", {
      id, nombre: datos[2], titulo: datos[8],
      fechaDevolucion: Utilities.formatDate(devolucion, "America/Bogota", "dd/MM/yyyy"),
      linkDevolucion: crearLinkAccion(id, "confirmar_devolucion"),
    })
  });

  return respuestaHTML(`✅ Préstamo <strong>${id}</strong> registrado.<br>Fecha de devolución: <strong>${Utilities.formatDate(devolucion, "America/Bogota", "dd/MM/yyyy")}</strong>`);
}

// ─── Confirmar devolución ─────────────────────────────────────
function confirmarDevolucion(hoja, fila, datos, id) {
  const ahora = new Date();
  hoja.getRange(fila, 12).setValue(ESTADOS.DEVUELTA);
  hoja.getRange(fila, 17).setValue(Utilities.formatDate(ahora, "America/Bogota", "dd/MM/yyyy"));
  appendLog(hoja, fila, "Material DEVUELTO");

  // Eliminar evento de Calendar si existe
  const idEvento = datos[17];
  if (idEvento) {
    try {
      CalendarApp.getEventById(idEvento).deleteEvent();
    } catch (e) { Logger.log("No se pudo borrar evento: " + e.message); }
  }

  enviarCorreo({
    para:   datos[3],
    asunto: `📗 Devolución registrada [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("devuelta", { id, nombre: datos[2], titulo: datos[8] })
  });

  enviarCorreo({
    para:   datos[6],
    asunto: `[Reunir] Material devuelto: ${id}`,
    cuerpo: `El material "${datos[8]}" (${id}) fue registrado como devuelto el ${Utilities.formatDate(ahora, "America/Bogota", "dd/MM/yyyy")}.`
  });

  return respuestaHTML(`✅ Devolución de <strong>${id}</strong> registrada correctamente.`);
}

// ============================================================
//  3. TRIGGER DIARIO: Verificar vencimientos y enviar recordatorios
// ============================================================
function verificarVencimientos() {
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  const datos = hoja.getDataRange().getValues();
  const hoy   = new Date();

  for (let i = 1; i < datos.length; i++) {
    const estado    = datos[i][11]; // col L
    const fechaDevStr = datos[i][15]; // col P

    if (estado !== ESTADOS.EN_PRESTAMO || !fechaDevStr) continue;

    const fechaDev = new Date(fechaDevStr);
    const diffDias = Math.floor((fechaDev - hoy) / (1000 * 60 * 60 * 24));
    const id       = datos[i][0];
    const nombre   = datos[i][2];
    const correo   = datos[i][3];
    const titulo   = datos[i][8];
    const fechaStr = Utilities.formatDate(fechaDev, "America/Bogota", "dd/MM/yyyy");

    // Recordatorio 3 días antes
    if (diffDias === CONFIG.DIAS_RECORDATORIO) {
      enviarCorreo({
        para:   correo,
        asunto: `⏰ Recordatorio devolución en ${diffDias} días [${id}] — Red Reunir`,
        cuerpo: plantillaCorreo("recordatorio", {
          id, nombre, titulo, fechaDevolucion: fechaStr, diasRestantes: diffDias,
          linkDevolucion: crearLinkAccion(id, "confirmar_devolucion"),
        })
      });
      appendLog(hoja, i + 1, `Recordatorio enviado (${diffDias} días para vencer)`);
    }

    // Marcar como vencida
    if (diffDias < 0) {
      hoja.getRange(i + 1, 12).setValue(ESTADOS.VENCIDA);
      enviarCorreo({
        para:   correo,
        asunto: `🚨 Material VENCIDO [${id}] — Red Reunir`,
        cuerpo: plantillaCorreo("vencida", {
          id, nombre, titulo, fechaDevolucion: fechaStr,
          diasVencido: Math.abs(diffDias),
        })
      });
      enviarCorreo({
        para:   CONFIG.ADMIN_EMAIL,
        asunto: `[Reunir] Material vencido: ${id}`,
        cuerpo: `El préstamo ${id} (${titulo}) venció el ${fechaStr}. Solicitante: ${nombre} (${correo}).`
      });
      appendLog(hoja, i + 1, `Estado → VENCIDA (${Math.abs(diffDias)} días de retraso)`);
    }
  }
}

// ============================================================
//  4. PLANTILLAS DE CORREO (HTML)
// ============================================================
function plantillaCorreo(tipo, d) {
  const header = `
    <div style="background:#8B0000;padding:20px;text-align:center">
      <h2 style="color:white;margin:0">Red Reunir</h2>
      <p style="color:#ffcccc;margin:0;font-size:13px">Sistema de Préstamo Interbibliotecario</p>
    </div>
    <div style="padding:24px;font-family:Arial,sans-serif;color:#333">`;
  const footer = `
    </div>
    <div style="background:#f5f5f5;padding:12px;text-align:center;font-size:11px;color:#999">
      Red Reunir • Sistema automatizado de gestión ILL • reunir.com.co
    </div>`;

  const btnStyle = (color) => 
    `display:inline-block;padding:12px 24px;background:${color};color:white;text-decoration:none;border-radius:4px;font-weight:bold;margin:8px 4px`;

  const plantillas = {

    nueva_solicitud: `${header}
      <h3>📚 Nueva solicitud de préstamo</h3>
      <p>Se ha recibido una nueva solicitud de préstamo interbibliotecario.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID Solicitud</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Solicitante</td><td style="padding:8px">${d.nombre}</td></tr>
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Institución</td><td style="padding:8px;background:#f9f9f9">${d.institucion}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Tipo de material</td><td style="padding:8px">${d.tipo}</td></tr>
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Título</td><td style="padding:8px;background:#f9f9f9">${d.titulo}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Autor</td><td style="padding:8px">${d.autor}</td></tr>
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Observaciones</td><td style="padding:8px;background:#f9f9f9">${d.obs || "—"}</td></tr>
      </table>
      <br>
      <p><strong>Por favor responda a esta solicitud:</strong></p>
      <a href="${d.linkAprobar}" style="${btnStyle("#27ae60")}">✅ Aprobar</a>
      <a href="${d.linkRechazar}" style="${btnStyle("#c0392b")}">❌ Rechazar</a>
      <br><br>
      <p style="font-size:12px;color:#777">También puede gestionar esta solicitud directamente en: <a href="${d.sheetUrl}">Hoja de control Reunir</a></p>
      ${footer}`,

    confirmacion_solicitante: `${header}
      <h3>✅ Solicitud recibida exitosamente</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tu solicitud ha sido registrada y enviada a la biblioteca correspondiente para su revisión.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID Solicitud</td><td style="padding:8px"><strong>${d.id}</strong></td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título solicitado</td><td style="padding:8px">${d.titulo}</td></tr>
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Biblioteca</td><td style="padding:8px;background:#f9f9f9">${d.bibPrestadora}</td></tr>
      </table>
      <p>Te notificaremos cuando la biblioteca responda tu solicitud. Guarda el ID <strong>${d.id}</strong> para consultas.</p>
      ${footer}`,

    aprobada: `${header}
      <h3>✅ ¡Tu solicitud fue APROBADA!</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>La biblioteca <strong>${d.bibPrestadora}</strong> ha aprobado tu solicitud de préstamo.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
      </table>
      <br>
      <p>Cuando recibas el material físicamente, haz clic en el botón para confirmarlo:</p>
      <a href="${d.linkConfirmarPrestamo}" style="${btnStyle("#2980b9")}">📖 Confirmar recepción del material</a>
      ${footer}`,

    rechazada: `${header}
      <h3>❌ Solicitud no aprobada</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Lamentablemente la biblioteca <strong>${d.bibPrestadora}</strong> no pudo aprobar tu solicitud.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Motivo</td><td style="padding:8px;background:#fff3cd">${d.motivo}</td></tr>
      </table>
      <p>Puedes intentar con otra biblioteca de la red o contactar al administrador.</p>
      ${footer}`,

    en_prestamo: `${header}
      <h3>📖 ¡Material en camino!</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>El préstamo ha sido registrado. Recibirás el material según lo acordado con la biblioteca.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
        <tr><td style="padding:8px;background:#d4edda;font-weight:bold">Fecha límite devolución</td><td style="padding:8px;background:#d4edda"><strong>${d.fechaDevolucion}</strong></td></tr>
      </table>
      <br>
      <p>Cuando devuelvas el material, usa este enlace:</p>
      <a href="${d.linkDevolucion}" style="${btnStyle("#27ae60")}">📗 Registrar devolución</a>
      ${footer}`,

    recordatorio: `${header}
      <h3>⏰ Recordatorio de devolución</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Te recordamos que tienes <strong>${d.diasRestantes} días</strong> para devolver el siguiente material:</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Fecha límite</td><td style="padding:8px;background:#fff3cd"><strong>${d.fechaDevolucion}</strong></td></tr>
      </table>
      <br>
      <a href="${d.linkDevolucion}" style="${btnStyle("#f39c12")}">📗 Registrar devolución</a>
      ${footer}`,

    vencida: `${header}
      <h3>🚨 Préstamo VENCIDO</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>El siguiente préstamo venció hace <strong>${d.diasVencido} día(s)</strong>. Por favor devuelve el material a la mayor brevedad.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f8d7da;font-weight:bold;width:35%">ID</td><td style="padding:8px;background:#f8d7da">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
        <tr><td style="padding:8px;background:#f8d7da;font-weight:bold">Venció el</td><td style="padding:8px;background:#f8d7da">${d.fechaDevolucion}</td></tr>
      </table>
      <p>Contacta tu biblioteca o al administrador de la red para regularizar la situación.</p>
      ${footer}`,

    devuelta: `${header}
      <h3>📗 Devolución registrada</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>La devolución del material ha sido registrada exitosamente. ¡Gracias!</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:35%">ID</td><td style="padding:8px">${d.id}</td></tr>
        <tr><td style="padding:8px;font-weight:bold">Título</td><td style="padding:8px">${d.titulo}</td></tr>
      </table>
      <p>Puedes solicitar nuevos préstamos cuando lo necesites a través de la Red Reunir.</p>
      ${footer}`,
  };

  return `<html><body style="margin:0;padding:0;background:#f0f0f0">
    <div style="max-width:600px;margin:20px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
      ${plantillas[tipo] || "<p>Correo no configurado.</p>"}
    </div></body></html>`;
}

// ============================================================
//  5. FUNCIONES AUXILIARES
// ============================================================

function enviarCorreo({ para, asunto, cuerpo }) {
  MailApp.sendEmail({
    to:       para,
    subject:  asunto,
    htmlBody: cuerpo,
    name:     CONFIG.NOMBRE_RED,
    replyTo:  CONFIG.ADMIN_EMAIL,
  });
}

function crearLinkAccion(id, action) {
  const baseUrl = ScriptApp.getService().getUrl();
  return `${baseUrl}?action=${action}&id=${encodeURIComponent(id)}`;
}

function buscarFila(hoja, id) {
  const vals = hoja.getRange(1, 1, hoja.getLastRow(), 1).getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === id) return i + 1;
  }
  return null;
}

function logEntry(msg, actor) {
  const ts = Utilities.formatDate(new Date(), "America/Bogota", "dd/MM/yyyy HH:mm");
  return `[${ts}] ${actor ? actor + ": " : ""}${msg}`;
}

function appendLog(hoja, fila, msg) {
  const cell = hoja.getRange(fila, 19);
  const prev = cell.getValue() || "";
  cell.setValue(prev + (prev ? "\n" : "") + logEntry(msg));
}

function respuestaHTML(msg) {
  return HtmlService.createHtmlOutput(`
    <html><body style="font-family:Arial;max-width:500px;margin:60px auto;text-align:center">
      <div style="background:#8B0000;padding:16px;border-radius:8px 8px 0 0">
        <h2 style="color:white;margin:0">Red Reunir</h2>
      </div>
      <div style="border:1px solid #ddd;padding:32px;border-radius:0 0 8px 8px">
        <p style="font-size:18px">${msg}</p>
        <p style="color:#999;font-size:13px">Puedes cerrar esta ventana.</p>
      </div>
    </body></html>`).setTitle("Red Reunir");
}

// ============================================================
//  6. CONFIGURACIÓN INICIAL (ejecutar UNA sola vez)
// ============================================================
function setupInicial() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // Crear hoja Solicitudes si no existe
  let hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  if (!hoja) hoja = ss.insertSheet(CONFIG.HOJA_SOLICITUDES);

  const encabezados = [
    "ID", "Fecha solicitud", "Nombre solicitante", "Correo solicitante",
    "Institución solicitante", "Biblioteca prestadora", "Correo biblioteca prestadora",
    "Tipo material", "Título", "Autor", "Observaciones", "Estado",
    "Fecha aprobación/rechazo", "Motivo rechazo", "Fecha préstamo",
    "Fecha devolución esperada", "Fecha devolución real", "ID Calendar", "Historial"
  ];
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  hoja.getRange(1, 1, 1, encabezados.length)
    .setBackground("#8B0000").setFontColor("white").setFontWeight("bold");
  hoja.setFrozenRows(1);

  // Crear hoja Bibliotecas
  let hojaBib = ss.getSheetByName(CONFIG.HOJA_BIBLIOTECAS);
  if (!hojaBib) hojaBib = ss.insertSheet(CONFIG.HOJA_BIBLIOTECAS);
  const encBib = ["Nombre biblioteca", "Institución", "Correo responsable", "Dominio", "Ciudad", "Activa"];
  hojaBib.getRange(1, 1, 1, encBib.length).setValues([encBib]);
  hojaBib.getRange(1, 1, 1, encBib.length)
    .setBackground("#8B0000").setFontColor("white").setFontWeight("bold");

  // Crear trigger para Form Submit
  const triggers = ScriptApp.getProjectTriggers();
  const yaExiste = triggers.some(t => t.getHandlerFunction() === "onFormSubmit");
  if (!yaExiste) {
    ScriptApp.newTrigger("onFormSubmit")
      .forSpreadsheet(CONFIG.SHEET_ID)
      .onFormSubmit()
      .create();
  }

  // Crear trigger diario para vencimientos
  const yaExisteDiario = triggers.some(t => t.getHandlerFunction() === "verificarVencimientos");
  if (!yaExisteDiario) {
    ScriptApp.newTrigger("verificarVencimientos")
      .timeBased().everyDays(1).atHour(8).create();
  }

  Logger.log("✅ Setup completado correctamente.");
  SpreadsheetApp.getUi().alert("✅ Sistema Reunir configurado correctamente.");
}
