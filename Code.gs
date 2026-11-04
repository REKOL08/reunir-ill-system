// ============================================================
//  SISTEMA DE PRÉSTAMO INTERBIBLIOTECARIO — RED REUNIR
//  Google Apps Script — Pegar en: Extensions > Apps Script
//  ----------------------------------------------------------
//  FLUJO (según diagrama institucional):
//   1. Usuario diligencia el formulario.
//   2. El sistema notifica a la BIBLIOTECA DE ORIGEN (a la que
//      pertenece el solicitante).
//   3-4. Origen verifica vigencia / multas / entregas pendientes
//        y APRUEBA o RECHAZA (con motivo).
//   5-6. Si aprueba, el sistema notifica a la BIBLIOTECA
//        PRESTAMISTA, que verifica disponibilidad del material.
//   7. Prestamista APRUEBA o RECHAZA (con motivo).
//   8-9. Si aprueba: se notifica a usuario y biblioteca de origen.
//        El usuario tiene 24h para retirar (recordatorio) y hasta
//        48h antes de que la solicitud se cierre automáticamente
//        como "No retirada". Al entregar el material se confirma
//        el préstamo y se calcula la devolución.
// ============================================================

// ─── CONFIGURACIÓN CENTRAL ───────────────────────────────────
const CONFIG = {
  SHEET_ID: "TU_SHEET_ID_AQUI",
  WEBAPP_URL: "PEGA_AQUI_LA_URL_DEL_WEBAPP",
  HOJA_SOLICITUDES: "Solicitudes",
  HOJA_BIBLIOTECAS: "Bibliotecas",
  ADMIN_EMAIL: "admin@tu-dominio.edu.co",
  NOMBRE_RED: "Red Reunir — Préstamo Interbibliotecario",
  SHEET_URL: "https://docs.google.com/spreadsheets/d/TU_SHEET_ID_AQUI/edit",
  FORM_URL: "PEGA_AQUI_LA_URL_DEL_GOOGLE_FORM", // ← la de verUrlFormulario()
  DIAS_PRESTAMO_DEFAULT: 15,
  DIAS_PRESTAMO_MAXIMO: 120,
  DIAS_RECORDATORIO: 3,
  HORAS_RECORDATORIO_RETIRO: 24,  // a las 24h se envía UN recordatorio
  HORAS_EXPIRA_RETIRO: 48,        // a las 48h la solicitud expira
};

// ─── COLUMNAS DE LA HOJA "Bibliotecas" ───────────────────────
// A=Nombre  B=Institución  C=Correo responsable  D=Días préstamo
// E=Ciudad/Red  F=Correo activo (Sí/No)

function getDatosBiblioteca(nombreBiblioteca) {
  if (!nombreBiblioteca) return { correo: null, diasPrestamo: CONFIG.DIAS_PRESTAMO_DEFAULT };

  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja = ss.getSheetByName(CONFIG.HOJA_BIBLIOTECAS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === String(nombreBiblioteca).trim()) {
      const correo = (datos[i][2] && datos[i][2] !== "Sin correo registrado")
        ? String(datos[i][2]).trim()
        : null;
      const dias = Number(datos[i][3]) || CONFIG.DIAS_PRESTAMO_DEFAULT;
      return { correo, diasPrestamo: Math.min(dias, CONFIG.DIAS_PRESTAMO_MAXIMO) };
    }
  }
  return { correo: null, diasPrestamo: CONFIG.DIAS_PRESTAMO_DEFAULT };
}

function getCorreoBiblioteca(nombreBiblioteca) {
  return getDatosBiblioteca(nombreBiblioteca).correo;
}
function getDiasPrestamo(nombreBiblioteca) {
  return getDatosBiblioteca(nombreBiblioteca).diasPrestamo;
}

// ─── COLUMNAS DE LA HOJA "Solicitudes" (1-indexed) ───────────
const COL = {
  ID: 1, FECHA: 2, NOMBRE: 3, CORREO_SOL: 4, TIPO_USUARIO: 5, DOCUMENTO: 6,
  PROGRAMA: 7, BIB_ORIGEN: 8, CORREO_ORIGEN: 9, BIB_PREST: 10, CORREO_PREST: 11,
  TIPO_MAT: 12, TITULO: 13, AUTOR: 14, INFO: 15, ESTADO: 16,
  AUT_ORIGEN: 17, VIGENCIA: 18, FUNC_ORIGEN: 19, FECHA_DEC_ORIGEN: 20, MOTIVO_ORIGEN: 21,
  DISP_PREST: 22, FUNC_PREST: 23, FECHA_DEC_PREST: 24, MOTIVO_PREST: 25,
  FECHA_PREST: 26, FECHA_DEV_ESP: 27, FECHA_DEV_REAL: 28, ENTREGADO: 29,
  CAL_ID: 30, HISTORIAL: 31,
};
const TOTAL_COLS = 31;

// ─── ESTADOS VÁLIDOS ─────────────────────────────────────────
const ESTADOS = {
  VALID_ORIGEN:          "En validación — biblioteca de origen",
  RECHAZADA_ORIGEN:      "Rechazada por biblioteca de origen",
  VALID_PRESTAMISTA:     "Aprobada por origen — verificando disponibilidad",
  RECHAZADA_PRESTAMISTA: "Rechazada por no disponibilidad",
  APROBADA:              "Aprobada — lista para retiro (24h)",
  NO_RETIRADA:           "No retirada — plazo de retiro vencido",
  EN_PRESTAMO:           "En préstamo",
  DEVUELTA:              "Devuelta",
  VENCIDA:               "Vencida",
  PEND_ORIGEN:           "Pendiente — sin correo biblioteca de origen",
  PEND_PRESTAMISTA:      "Pendiente — sin correo biblioteca prestamista",
};

// ============================================================
//  1. TRIGGER PRINCIPAL: procesarFormularioReunir
// ============================================================
function procesarFormularioReunir(e) {
  // Bloqueo: garantiza IDs consecutivos únicos si llegan varios envíos a la vez
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); }
  catch (err) {
    MailApp.sendEmail(CONFIG.ADMIN_EMAIL, "Error en sistema Reunir", "No se pudo obtener el bloqueo: " + err.message);
    return;
  }
  try { _procesarFormularioReunir(e); }
  finally { lock.releaseLock(); }
}

function _procesarFormularioReunir(e) {
  try {
    if (!e || !e.values) {
      throw new Error("Esta función se activa al enviar el formulario. No la ejecutes manualmente.");
    }

    const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);

    const sourceSheet = e.range.getSheet();
    const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues()[0];

    const get = (campo) => {
      for (let i = headers.length - 1; i >= 0; i--) {
        if (headers[i] === campo && e.values[i] && String(e.values[i]).trim() !== "") {
          return String(e.values[i]).trim();
        }
      }
      return "";
    };

    const fechaSolicitud    = e.values[0] || new Date();
    const nombre            = get("Nombre completo del solicitante");
    const correoSolicitante = get("Correo institucional");
    const tipoUsuario       = get("Tipo de usuario");
    const documento         = get("Número de documento de identificación");
    const bibOrigen         = get("Biblioteca solicitante (a la que perteneces)");
    const bibPrestamista    = get("Biblioteca prestamista (a la que se solicita el material)");
    const programa          = get("Programa académico");
    const tipo              = get("Tipo de material");
    const titulo            = get("Título");
    const autor             = get("Autor");
    const info              = get("Información adicional / Observaciones");

    if (!correoSolicitante) throw new Error("Falta el correo institucional del solicitante.");

    const correoOrigen      = getCorreoBiblioteca(bibOrigen);
    const correoPrestamista = getCorreoBiblioteca(bibPrestamista);

    const consecutivo = Math.max(hoja.getLastRow(), 1);
    const id = "REQ-" + Utilities.formatDate(new Date(), "America/Bogota", "yyyyMMdd")
      + "-" + String(consecutivo).padStart(4, "0");

    let infoFinal = info;
    if (bibOrigen && bibPrestamista && bibOrigen.trim() === bibPrestamista.trim()) {
      infoFinal = (info ? info + " | " : "") +
        "⚠️ Biblioteca solicitante y prestamista son la misma — verificar si corresponde a préstamo interno.";
    }

    const fila = new Array(TOTAL_COLS).fill("");
    fila[COL.ID - 1]            = id;
    fila[COL.FECHA - 1]         = fechaSolicitud;
    fila[COL.NOMBRE - 1]        = nombre;
    fila[COL.CORREO_SOL - 1]    = correoSolicitante;
    fila[COL.TIPO_USUARIO - 1]  = tipoUsuario;
    fila[COL.DOCUMENTO - 1]     = documento;
    fila[COL.PROGRAMA - 1]      = programa;
    fila[COL.BIB_ORIGEN - 1]    = bibOrigen;
    fila[COL.CORREO_ORIGEN - 1] = correoOrigen || "SIN CORREO REGISTRADO";
    fila[COL.BIB_PREST - 1]     = bibPrestamista;
    fila[COL.CORREO_PREST - 1]  = correoPrestamista || "SIN CORREO REGISTRADO";
    fila[COL.TIPO_MAT - 1]      = tipo;
    fila[COL.TITULO - 1]        = titulo;
    fila[COL.AUTOR - 1]         = autor;
    fila[COL.INFO - 1]          = infoFinal;

    if (!correoOrigen) {
      fila[COL.ESTADO - 1]    = ESTADOS.PEND_ORIGEN;
      fila[COL.HISTORIAL - 1] = logEntry("Sin correo de la biblioteca de origen: " + bibOrigen + ". Admin notificado.", correoSolicitante);
      hoja.appendRow(fila);

      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: `[Reunir] ⚠️ Sin correo de biblioteca de origen: ${bibOrigen}`,
        body: `Solicitud de "${nombre}" (${correoSolicitante}) que pertenece a "${bibOrigen}", ` +
              `pero esa biblioteca no tiene correo registrado en la hoja Bibliotecas.\n\n` +
              `Material: ${titulo}\nPrestamista solicitada: ${bibPrestamista}\n` +
              `Registro: ${id}\n\nAgrega el correo en:\n${CONFIG.SHEET_URL}`,
        name: CONFIG.NOMBRE_RED,
      });

      enviarCorreo({
        para: correoSolicitante,
        asunto: `Solicitud recibida — en proceso [${id}] — Red Reunir`,
        cuerpo: plantillaCorreo("confirmacion_solicitante", { id, nombre, titulo, bibOrigen, bibPrestamista }),
      });
      return;
    }

    fila[COL.ESTADO - 1]    = ESTADOS.VALID_ORIGEN;
    fila[COL.HISTORIAL - 1] = logEntry("Solicitud creada. Enviada a biblioteca de origen para validación de usuario.", correoSolicitante);
    hoja.appendRow(fila);

    enviarCorreo({
      para: correoOrigen,
      asunto: `Validación de usuario [${id}] — Red Reunir`,
      cuerpo: plantillaCorreo("validacion_origen", {
        id, nombre, tipoUsuario, documento, programa,
        bibOrigen, bibPrestamista, tipo, titulo, autor, info: infoFinal,
        linkAprobar:  crearLinkAccion(id, "aprobar_origen"),
        linkRechazar: crearLinkAccion(id, "rechazar_origen"),
        sheetUrl: CONFIG.SHEET_URL,
      }),
    });

    enviarCorreo({
      para: correoSolicitante,
      asunto: `Solicitud recibida [${id}] — Red Reunir`,
      cuerpo: plantillaCorreo("confirmacion_solicitante", { id, nombre, titulo, bibOrigen, bibPrestamista }),
    });

  } catch (err) {
    Logger.log("Error en procesarFormularioReunir: " + err.message);
    MailApp.sendEmail(CONFIG.ADMIN_EMAIL, "Error en sistema Reunir", err.message);
  }
}

// ============================================================
//  2. ROUTER: doGet
// ============================================================
function doGet(e) {
  // Bloqueo: evita que dos clics/aprobaciones simultáneas procesen la misma solicitud dos veces
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return respuestaHTML("⏳ El sistema está ocupado. Intenta de nuevo en unos segundos."); }
  try { return _doGet(e); }
  finally { lock.releaseLock(); }
}

function _doGet(e) {
  const action = e.parameter.action;
  const id     = e.parameter.id;

  if (!action && !id) {
    return HtmlService.createHtmlOutput(
      `<script>window.location="${CONFIG.FORM_URL}";</script>`
    ).setTitle("Red Reunir");
  }

  if (!action || !id) {
    return respuestaHTML(
      `⚠️ Enlace incompleto.<br>
       <span style="font-size:13px;color:#777">
         Parámetros recibidos → action: <code>${escapeHtml(action || "(vacío)")}</code> | id: <code>${escapeHtml(id || "(vacío)")}</code><br><br>
         Posibles causas:<br>
         • El correo fue generado con una URL desactualizada.<br>
         • Vuelve a desplegar el Web App y reenvía la solicitud.
       </span>`
    );
  }

  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  const fila = buscarFila(hoja, id);
  if (!fila) return respuestaHTML("❌ Solicitud no encontrada: " + escapeHtml(id));

  const datos  = hoja.getRange(fila, 1, 1, TOTAL_COLS).getValues()[0];
  const estado = datos[COL.ESTADO - 1];
  const p      = e.parameter;

  switch (action) {

    // ── ETAPA 1: biblioteca de origen ──────────────────────
    case "aprobar_origen":
      if (estado !== ESTADOS.VALID_ORIGEN) return respuestaHTML(`⚠️ Esta solicitud ya fue procesada. Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_aprobar_origen", "Aprobar usuario", "#27ae60",
        "La biblioteca de origen confirma que el usuario está activo / matriculado y sin pendientes.", [
          { name: "vigencia",    label: "Vigencia del usuario (hasta)", type: "date", required: true },
          { name: "funcionario", label: "Funcionario que autoriza",     type: "text", required: true },
        ]);

    case "confirmar_aprobar_origen":
      if (estado !== ESTADOS.VALID_ORIGEN) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return aprobarOrigen(hoja, fila, datos, id, p.vigencia, p.funcionario);

    case "rechazar_origen":
      if (estado !== ESTADOS.VALID_ORIGEN) return respuestaHTML(`⚠️ Esta solicitud ya fue procesada. Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_rechazo_origen", "Rechazar solicitud", "#c0392b",
        "Indica el motivo por el cual la biblioteca de origen no autoriza al usuario (multa, carné inactivo, entregas pendientes, etc.).", [
          { name: "motivo",      label: "Motivo del rechazo",      type: "textarea", required: true },
          { name: "funcionario", label: "Funcionario que rechaza", type: "text",     required: true },
        ]);

    case "confirmar_rechazo_origen":
      if (estado !== ESTADOS.VALID_ORIGEN) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return rechazarOrigen(hoja, fila, datos, id, p.motivo, p.funcionario);

    // ── ETAPA 2: biblioteca prestamista ────────────────────
    case "aprobar_prestamista":
      if (estado !== ESTADOS.VALID_PRESTAMISTA) return respuestaHTML(`⚠️ Esta solicitud ya fue procesada. Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_aprobar_prestamista", "Aprobar préstamo", "#27ae60",
        "La biblioteca prestamista confirma que el material está disponible para préstamo.", [
          { name: "funcionario", label: "Funcionario que autoriza", type: "text", required: true },
        ]);

    case "confirmar_aprobar_prestamista":
      if (estado !== ESTADOS.VALID_PRESTAMISTA) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return aprobarPrestamista(hoja, fila, datos, id, p.funcionario);

    case "rechazar_prestamista":
      if (estado !== ESTADOS.VALID_PRESTAMISTA) return respuestaHTML(`⚠️ Esta solicitud ya fue procesada. Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_rechazo_prestamista", "Rechazar por no disponibilidad", "#c0392b",
        "Indica el motivo (material no disponible, en uso, no se presta, etc.).", [
          { name: "motivo",      label: "Motivo del rechazo",      type: "textarea", required: true },
          { name: "funcionario", label: "Funcionario que rechaza", type: "text",     required: true },
        ]);

    case "confirmar_rechazo_prestamista":
      if (estado !== ESTADOS.VALID_PRESTAMISTA) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return rechazarPrestamista(hoja, fila, datos, id, p.motivo, p.funcionario);

    // ── ETAPA 3: entrega y devolución ──────────────────────
    case "confirmar_prestamo":
      if (estado !== ESTADOS.APROBADA) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_prestamo_final", "Confirmar entrega del material", "#2980b9",
        "Confirma que el material fue entregado físicamente al usuario. Se calculará la fecha de devolución.", [
          { name: "funcionario", label: "Funcionario que realiza el préstamo", type: "text", required: true },
        ]);

    case "confirmar_prestamo_final":
      if (estado !== ESTADOS.APROBADA) return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return confirmarPrestamo(hoja, fila, datos, id, p.funcionario);

    case "confirmar_devolucion":
      if (estado !== ESTADOS.EN_PRESTAMO && estado !== ESTADOS.VENCIDA)
        return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return paginaAccion(id, "confirmar_devolucion_final", "Registrar devolución", "#27ae60",
        "Confirma que el material fue devuelto.", [
          { name: "funcionario",   label: "Funcionario que recibe la devolución", type: "text",     required: true },
          { name: "observaciones", label: "Observaciones (opcional)",             type: "textarea", required: false },
        ]);

    case "confirmar_devolucion_final":
      if (estado !== ESTADOS.EN_PRESTAMO && estado !== ESTADOS.VENCIDA)
        return respuestaHTML(`⚠️ Estado actual: ${estado}`);
      return confirmarDevolucion(hoja, fila, datos, id, p.funcionario, p.observaciones);

    default:
      const ACCIONES_LEGADO = ["aprobar", "rechazar", "confirmar_rechazo"];
      if (ACCIONES_LEGADO.indexOf(action) !== -1) {
        return respuestaHTML(
          "🔄 Este botón pertenece a una <strong>versión anterior</strong> del sistema.<br><br>" +
          "Por favor pide que la solicitud se <strong>reenvíe</strong> para recibir un correo actualizado, " +
          "o verifica que la implementación del Web App esté en la versión más reciente."
        );
      }
      return respuestaHTML(
        `❌ Acción no reconocida: <code>${escapeHtml(action)}</code><br>
         <span style="font-size:13px;color:#777">
           Verifica que el Web App esté desplegado en la versión más reciente<br>
           y que la <code>WEBAPP_URL</code> en CONFIG coincida con la URL actual del despliegue.
         </span>`
      );
  }
}

// ============================================================
//  3. ETAPA 1 — BIBLIOTECA DE ORIGEN
// ============================================================
function aprobarOrigen(hoja, fila, datos, id, vigencia, funcionario) {
  const correoPrest = datos[COL.CORREO_PREST - 1];
  const bibPrest    = datos[COL.BIB_PREST - 1];

  hoja.getRange(fila, COL.AUT_ORIGEN).setValue("SI");
  hoja.getRange(fila, COL.VIGENCIA).setValue(vigencia ? parseFecha(vigencia) : "");
  hoja.getRange(fila, COL.FUNC_ORIGEN).setValue(funcionario || "");
  hoja.getRange(fila, COL.FECHA_DEC_ORIGEN).setValue(fmtHora(new Date()));
  appendLog(hoja, fila, `Usuario VALIDADO por origen. Vigencia: ${vigencia || "—"}. Funcionario: ${funcionario || "—"}`);

  if (!correoPrest || correoPrest === "SIN CORREO REGISTRADO") {
    hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.PEND_PRESTAMISTA);
    appendLog(hoja, fila, "Sin correo de la biblioteca prestamista. Admin notificado.");
    MailApp.sendEmail({
      to: CONFIG.ADMIN_EMAIL,
      subject: `[Reunir] ⚠️ Sin correo de prestamista: ${bibPrest}`,
      body: `La solicitud ${id} fue aprobada por origen, pero "${bibPrest}" no tiene correo registrado.\n${CONFIG.SHEET_URL}`,
    });
    return respuestaHTML(`✅ Usuario validado para <strong>${id}</strong>, pero la biblioteca prestamista no tiene correo registrado. El administrador fue notificado.`);
  }

  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.VALID_PRESTAMISTA);

  enviarCorreo({
    para: correoPrest,
    asunto: `Solicitud de préstamo aprobada por origen [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("validacion_prestamista", {
      id,
      nombre: datos[COL.NOMBRE - 1],
      tipoUsuario: datos[COL.TIPO_USUARIO - 1],
      programa: datos[COL.PROGRAMA - 1],
      bibOrigen: datos[COL.BIB_ORIGEN - 1],
      tipo: datos[COL.TIPO_MAT - 1],
      titulo: datos[COL.TITULO - 1],
      autor: datos[COL.AUTOR - 1],
      info: datos[COL.INFO - 1],
      linkAprobar:  crearLinkAccion(id, "aprobar_prestamista"),
      linkRechazar: crearLinkAccion(id, "rechazar_prestamista"),
      sheetUrl: CONFIG.SHEET_URL,
    }),
  });

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `Tu biblioteca aprobó tu solicitud [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("info_origen_aprobado", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1], bibPrestamista: bibPrest,
    }),
  });

  return respuestaHTML(`✅ Usuario validado. La solicitud <strong>${id}</strong> fue enviada a <strong>${bibPrest}</strong> para verificar disponibilidad.`);
}

function rechazarOrigen(hoja, fila, datos, id, motivo, funcionario) {
  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.RECHAZADA_ORIGEN);
  hoja.getRange(fila, COL.AUT_ORIGEN).setValue("NO");
  hoja.getRange(fila, COL.FUNC_ORIGEN).setValue(funcionario || "");
  hoja.getRange(fila, COL.FECHA_DEC_ORIGEN).setValue(fmtHora(new Date()));
  hoja.getRange(fila, COL.MOTIVO_ORIGEN).setValue(motivo || "");
  appendLog(hoja, fila, `RECHAZADA por origen. Funcionario: ${funcionario || "—"}. Motivo: ${motivo}`);

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `❌ Solicitud no autorizada [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("rechazada_origen", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1],
      bibOrigen: datos[COL.BIB_ORIGEN - 1], motivo,
    }),
  });

  return respuestaHTML(`Solicitud <strong>${id}</strong> rechazada por la biblioteca de origen. El solicitante fue notificado.`);
}

// ============================================================
//  4. ETAPA 2 — BIBLIOTECA PRESTAMISTA
// ============================================================
function aprobarPrestamista(hoja, fila, datos, id, funcionario) {
  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.APROBADA);
  hoja.getRange(fila, COL.DISP_PREST).setValue("SI");
  hoja.getRange(fila, COL.FUNC_PREST).setValue(funcionario || "");
  hoja.getRange(fila, COL.FECHA_DEC_PREST).setValue(fmtHora(new Date()));
  appendLog(hoja, fila, `Disponibilidad CONFIRMADA. Funcionario: ${funcionario || "—"}. Aprobada — 24h para retiro.`);

  const bibPrest = datos[COL.BIB_PREST - 1];

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `✅ ¡Préstamo aprobado! Retira en 24h [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("aprobada_final", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1], bibPrestamista: bibPrest,
    }),
  });

  if (datos[COL.CORREO_ORIGEN - 1] && datos[COL.CORREO_ORIGEN - 1] !== "SIN CORREO REGISTRADO") {
    enviarCorreo({
      para: datos[COL.CORREO_ORIGEN - 1],
      asunto: `[Reunir] Préstamo aprobado para tu usuario: ${id}`,
      cuerpo: plantillaCorreo("aviso_origen_aprobado", {
        id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1], bibPrestamista: bibPrest,
      }),
    });
  }

  enviarCorreo({
    para: datos[COL.CORREO_PREST - 1],
    asunto: `Pendiente de entrega [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("confirmar_entrega", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1],
      linkPrestamo: crearLinkAccion(id, "confirmar_prestamo"),
    }),
  });

  return respuestaHTML(`✅ Préstamo <strong>${id}</strong> aprobado. El usuario tiene 24h para retirar el material. Cuando lo entregues, usa el botón "Confirmar entrega" del correo.`);
}

function rechazarPrestamista(hoja, fila, datos, id, motivo, funcionario) {
  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.RECHAZADA_PRESTAMISTA);
  hoja.getRange(fila, COL.DISP_PREST).setValue("NO");
  hoja.getRange(fila, COL.FUNC_PREST).setValue(funcionario || "");
  hoja.getRange(fila, COL.FECHA_DEC_PREST).setValue(fmtHora(new Date()));
  hoja.getRange(fila, COL.MOTIVO_PREST).setValue(motivo || "");
  appendLog(hoja, fila, `RECHAZADA por prestamista (no disponible). Funcionario: ${funcionario || "—"}. Motivo: ${motivo}`);

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `❌ Material no disponible [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("rechazada_prestamista", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1],
      bibPrestamista: datos[COL.BIB_PREST - 1], motivo,
    }),
  });

  if (datos[COL.CORREO_ORIGEN - 1] && datos[COL.CORREO_ORIGEN - 1] !== "SIN CORREO REGISTRADO") {
    enviarCorreo({
      para: datos[COL.CORREO_ORIGEN - 1],
      asunto: `[Reunir] Solicitud ${id} rechazada por no disponibilidad`,
      cuerpo: `La biblioteca ${datos[COL.BIB_PREST - 1]} rechazó la solicitud ${id} (${datos[COL.TITULO - 1]}). Motivo: ${motivo}`,
    });
  }

  return respuestaHTML(`Solicitud <strong>${id}</strong> rechazada por no disponibilidad. El solicitante fue notificado.`);
}

// ============================================================
//  5. ETAPA 3 — ENTREGA Y DEVOLUCIÓN
// ============================================================
function confirmarPrestamo(hoja, fila, datos, id, funcionario) {
  const ahora      = new Date();
  const diasPrest  = getDiasPrestamo(datos[COL.BIB_PREST - 1]);
  const devolucion = new Date(ahora);
  devolucion.setDate(devolucion.getDate() + diasPrest);

  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.EN_PRESTAMO);
  hoja.getRange(fila, COL.FECHA_PREST).setValue(ahora);
  hoja.getRange(fila, COL.FECHA_DEV_ESP).setValue(devolucion);
  hoja.getRange(fila, COL.ENTREGADO).setValue("SI");
  if (funcionario) hoja.getRange(fila, COL.FUNC_PREST).setValue(funcionario);
  appendLog(hoja, fila, `Material ENTREGADO por ${funcionario || "—"}. Plazo: ${diasPrest} días. Devolución: ${fmt(devolucion)}`);

  try {
    const cal = CalendarApp.getDefaultCalendar();
    const ev  = cal.createEvent(
      `📚 Devolución préstamo ${id} — ${datos[COL.TITULO - 1]}`,
      devolucion, devolucion,
      { description: `Solicitud: ${id}\nSolicitante: ${datos[COL.NOMBRE - 1]}\nTítulo: ${datos[COL.TITULO - 1]}\nPlazo: ${diasPrest} días`,
        guests: datos[COL.CORREO_SOL - 1] }
    );
    hoja.getRange(fila, COL.CAL_ID).setValue(ev.getId());
  } catch (err) { Logger.log("Calendar error: " + err.message); }

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `📖 Material entregado [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("en_prestamo", {
      id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1],
      diasPrestamo: diasPrest, fechaDevolucion: fmt(devolucion),
      linkDevolucion: crearLinkAccion(id, "confirmar_devolucion"),
    }),
  });

  return respuestaHTML(`✅ Entrega de <strong>${id}</strong> registrada.<br>Plazo: <strong>${diasPrest} días</strong><br>Devolución: <strong>${fmt(devolucion)}</strong>`);
}

function confirmarDevolucion(hoja, fila, datos, id, funcionario, observaciones) {
  const ahora = new Date();
  hoja.getRange(fila, COL.ESTADO).setValue(ESTADOS.DEVUELTA);
  hoja.getRange(fila, COL.FECHA_DEV_REAL).setValue(fmt(ahora));
  appendLog(hoja, fila, `Material DEVUELTO. Recibe: ${funcionario || "—"}.${observaciones ? " Obs: " + observaciones : ""}`);

  const calId = datos[COL.CAL_ID - 1];
  if (calId) {
    try { CalendarApp.getEventById(calId).deleteEvent(); }
    catch (err) { Logger.log("No se pudo borrar evento: " + err.message); }
  }

  enviarCorreo({
    para: datos[COL.CORREO_SOL - 1],
    asunto: `📗 Devolución registrada [${id}] — Red Reunir`,
    cuerpo: plantillaCorreo("devuelta", { id, nombre: datos[COL.NOMBRE - 1], titulo: datos[COL.TITULO - 1] }),
  });

  if (datos[COL.CORREO_PREST - 1] && datos[COL.CORREO_PREST - 1] !== "SIN CORREO REGISTRADO") {
    enviarCorreo({
      para: datos[COL.CORREO_PREST - 1],
      asunto: `[Reunir] Material devuelto: ${id}`,
      cuerpo: `El material "${datos[COL.TITULO - 1]}" (${id}) fue devuelto el ${fmt(ahora)}.${observaciones ? " Obs: " + observaciones : ""}`,
    });
  }

  return respuestaHTML(`✅ Devolución de <strong>${id}</strong> registrada correctamente.`);
}

// ============================================================
//  6. TRIGGER DIARIO — recordatorios, vencimientos y ventana de retiro
// ============================================================
function verificarVencimientos() {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja  = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  const datos = hoja.getDataRange().getValues();
  const hoy   = new Date();

  for (let i = 1; i < datos.length; i++) {
    const estado    = datos[i][COL.ESTADO - 1];
    const id        = datos[i][COL.ID - 1];
    const nombre    = datos[i][COL.NOMBRE - 1];
    const correo    = datos[i][COL.CORREO_SOL - 1];
    const titulo    = datos[i][COL.TITULO - 1];
    const historial = String(datos[i][COL.HISTORIAL - 1] || "");

    // ── VENTANA DE RETIRO (estado APROBADA) ────────────────
    if (estado === ESTADOS.APROBADA) {
      const fechaAprob = parseFechaHora(datos[i][COL.FECHA_DEC_PREST - 1]);
      if (!fechaAprob) {
        // Sin fecha parseable: no podemos medir la ventana; avisar admin una sola vez
        if (historial.indexOf("Fecha de aprobación no legible") === -1) {
          appendLog(hoja, i + 1, "Fecha de aprobación no legible — ventana de retiro no monitoreada. Revisar manualmente.");
          MailApp.sendEmail(CONFIG.ADMIN_EMAIL, `[Reunir] Revisar ${id}`,
            `No se pudo leer la fecha de aprobación de ${id}; la expiración de retiro no se controlará automáticamente.\n${CONFIG.SHEET_URL}`);
        }
        continue;
      }

      const horas = (hoy - fechaAprob) / (1000 * 60 * 60);
      const bibPrest    = datos[i][COL.BIB_PREST - 1];
      const correoPrest = datos[i][COL.CORREO_PREST - 1];

      // ≥48h → EXPIRA: notificar y cerrar
      if (horas >= CONFIG.HORAS_EXPIRA_RETIRO) {
        hoja.getRange(i + 1, COL.ESTADO).setValue(ESTADOS.NO_RETIRADA);
        appendLog(hoja, i + 1, `Plazo de retiro VENCIDO (${Math.floor(horas)}h desde la aprobación). Solicitud cerrada como no retirada.`);

        enviarCorreo({
          para: correo,
          asunto: `⌛ Plazo de retiro vencido [${id}] — Red Reunir`,
          cuerpo: plantillaCorreo("retiro_vencido", { id, nombre, titulo, bibPrestamista: bibPrest }),
        });

        if (correoPrest && correoPrest !== "SIN CORREO REGISTRADO") {
          enviarCorreo({
            para: correoPrest,
            asunto: `[Reunir] Material no retirado — liberar reserva: ${id}`,
            cuerpo: plantillaCorreo("retiro_vencido_prestamista", { id, nombre, titulo }),
          });
        }

        const correoOrigen = datos[i][COL.CORREO_ORIGEN - 1];
        if (correoOrigen && correoOrigen !== "SIN CORREO REGISTRADO") {
          enviarCorreo({
            para: correoOrigen,
            asunto: `[Reunir] Solicitud ${id} cerrada: no retirada`,
            cuerpo: `Tu usuario ${nombre} no retiró el material "${titulo}" dentro del plazo de ${CONFIG.HORAS_EXPIRA_RETIRO} horas. La solicitud ${id} fue cerrada.`,
          });
        }
        continue;
      }

      // 24h–48h → UN solo recordatorio (verificado contra el historial)
      if (horas >= CONFIG.HORAS_RECORDATORIO_RETIRO &&
          historial.indexOf("Recordatorio de retiro enviado") === -1) {
        enviarCorreo({
          para: correo,
          asunto: `⏰ Última oportunidad para retirar tu material [${id}] — Red Reunir`,
          cuerpo: plantillaCorreo("recordatorio_retiro", {
            id, nombre, titulo, bibPrestamista: bibPrest,
            horasRestantes: Math.max(1, Math.floor(CONFIG.HORAS_EXPIRA_RETIRO - horas)),
          }),
        });
        appendLog(hoja, i + 1, `Recordatorio de retiro enviado (${Math.floor(horas)}h transcurridas).`);
      }
      continue;
    }

    // ── PRÉSTAMOS ACTIVOS (recordatorio y vencimiento) ─────
    if (estado !== ESTADOS.EN_PRESTAMO) continue;

    const fechaDevRaw = datos[i][COL.FECHA_DEV_ESP - 1];
    if (!fechaDevRaw) continue;

    const fechaDev = (fechaDevRaw instanceof Date) ? fechaDevRaw : new Date(fechaDevRaw);
    if (isNaN(fechaDev.getTime())) continue;

    const diffDias = Math.floor((fechaDev - hoy) / (1000 * 60 * 60 * 24));
    const fechaStr = fmt(fechaDev);

    if (diffDias === CONFIG.DIAS_RECORDATORIO && historial.indexOf("Recordatorio enviado (") === -1) {
      enviarCorreo({
        para: correo,
        asunto: `⏰ Devolución en ${diffDias} días [${id}] — Red Reunir`,
        cuerpo: plantillaCorreo("recordatorio", {
          id, nombre, titulo, fechaDevolucion: fechaStr, diasRestantes: diffDias,
          linkDevolucion: crearLinkAccion(id, "confirmar_devolucion"),
        }),
      });
      appendLog(hoja, i + 1, `Recordatorio enviado (${diffDias} días para vencer).`);
    }

    if (diffDias < 0) {
      hoja.getRange(i + 1, COL.ESTADO).setValue(ESTADOS.VENCIDA);
      enviarCorreo({
        para: correo,
        asunto: `🚨 Material VENCIDO [${id}] — Red Reunir`,
        cuerpo: plantillaCorreo("vencida", {
          id, nombre, titulo, fechaDevolucion: fechaStr, diasVencido: Math.abs(diffDias),
        }),
      });
      enviarCorreo({
        para: CONFIG.ADMIN_EMAIL,
        asunto: `[Reunir] Material vencido: ${id}`,
        cuerpo: `El préstamo ${id} (${titulo}) venció el ${fechaStr}. Solicitante: ${nombre} (${correo}).`,
      });
      appendLog(hoja, i + 1, `Estado → VENCIDA (${Math.abs(diffDias)} días de retraso).`);
    }
  }
}

// ============================================================
//  7. PLANTILLAS DE CORREO (HTML)
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
      Red Reunir • Red de Unidades de Información de Risaralda y Eje Cafetero
    </div>`;
  const btn = (color) =>
    `display:inline-block;padding:12px 24px;background:${color};color:white;text-decoration:none;border-radius:4px;font-weight:bold;margin:8px 4px`;
  const row = (k, v, bg) =>
    `<tr><td style="padding:8px;${bg ? "background:#f9f9f9;" : ""}font-weight:bold;width:38%">${k}</td>` +
    `<td style="padding:8px;${bg ? "background:#f9f9f9;" : ""}">${v || "—"}</td></tr>`;

  const plantillas = {

    validacion_origen: `${header}
      <h3>👤 Validación de usuario</h3>
      <p>Un usuario de tu biblioteca solicitó un préstamo interbibliotecario. Verifica en tu sistema su <strong>vigencia, multas y entregas pendientes</strong>, y autoriza o rechaza.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Solicitante", d.nombre, true)}
        ${row("Tipo de usuario", d.tipoUsuario)}
        ${row("Documento", d.documento, true)}
        ${row("Programa", d.programa)}
        ${row("Biblioteca prestamista", d.bibPrestamista, true)}
        ${row("Tipo de material", d.tipo)}
        ${row("Título", d.titulo, true)}
        ${row("Autor", d.autor)}
        ${row("Información / Obs.", d.info, true)}
      </table>
      <br>
      <p><strong>¿El usuario está activo y sin pendientes?</strong></p>
      <a href="${d.linkAprobar}" style="${btn("#27ae60")}">✅ Autorizar usuario</a>
      <a href="${d.linkRechazar}" style="${btn("#c0392b")}">❌ Rechazar</a>
      <br><br>
      <p style="font-size:12px;color:#777">También puedes gestionarla en la <a href="${d.sheetUrl}">hoja de control</a>.</p>
      ${footer}`,

    confirmacion_solicitante: `${header}
      <h3>✅ Solicitud recibida</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tu solicitud fue registrada. Primero tu biblioteca verificará tu estado de usuario y luego se gestionará con la biblioteca que tiene el material.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID Solicitud", "<strong>" + d.id + "</strong>")}
        ${row("Material", d.titulo, true)}
        ${row("Tu biblioteca", d.bibOrigen)}
        ${row("Biblioteca prestamista", d.bibPrestamista, true)}
      </table>
      <p>Te notificaremos en cada paso. Guarda el ID <strong>${d.id}</strong> para tus consultas.</p>
      ${footer}`,

    info_origen_aprobado: `${header}
      <h3>👍 Tu biblioteca aprobó tu solicitud</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tu estado de usuario fue validado. Ahora la biblioteca <strong>${d.bibPrestamista}</strong> verificará la disponibilidad del material <strong>"${d.titulo}"</strong>.</p>
      <p>Te avisaremos cuando responda. (Solicitud ${d.id})</p>
      ${footer}`,

    rechazada_origen: `${header}
      <h3>❌ Solicitud no autorizada</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tu biblioteca <strong>${d.bibOrigen}</strong> no autorizó esta solicitud.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Motivo</td><td style="padding:8px;background:#fff3cd">${d.motivo}</td></tr>
      </table>
      <p>Regulariza tu situación con tu biblioteca y vuelve a intentarlo.</p>
      ${footer}`,

    validacion_prestamista: `${header}
      <h3>📚 Solicitud de préstamo (aprobada por la biblioteca de origen)</h3>
      <p>La biblioteca de origen ya validó al usuario. Verifica la <strong>disponibilidad del material</strong> y autoriza o rechaza.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Solicitante", d.nombre, true)}
        ${row("Tipo de usuario", d.tipoUsuario)}
        ${row("Programa", d.programa, true)}
        ${row("Biblioteca de origen", d.bibOrigen)}
        ${row("Tipo de material", d.tipo, true)}
        ${row("Título", d.titulo)}
        ${row("Autor", d.autor, true)}
        ${row("Información / Obs.", d.info)}
      </table>
      <br>
      <p><strong>¿El material está disponible?</strong></p>
      <a href="${d.linkAprobar}" style="${btn("#27ae60")}">✅ Material disponible — Aprobar</a>
      <a href="${d.linkRechazar}" style="${btn("#c0392b")}">❌ No disponible</a>
      <br><br>
      <p style="font-size:12px;color:#777">También en la <a href="${d.sheetUrl}">hoja de control</a>.</p>
      ${footer}`,

    aprobada_final: `${header}
      <h3>🎉 ¡Tu préstamo fue aprobado!</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>La biblioteca <strong>${d.bibPrestamista}</strong> confirmó la disponibilidad del material.</p>
      <div style="background:#d4edda;border-left:4px solid #27ae60;padding:12px;margin:12px 0;border-radius:4px">
        ⏱️ Tienes <strong>24 horas</strong> para retirar el material en <strong>${d.bibPrestamista}</strong>.
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
      </table>
      ${footer}`,

    aviso_origen_aprobado: `${header}
      <h3>✅ Préstamo aprobado</h3>
      <p>El préstamo de tu usuario <strong>${d.nombre}</strong> fue aprobado por <strong>${d.bibPrestamista}</strong>.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
      </table>
      ${footer}`,

    confirmar_entrega: `${header}
      <h3>📦 Pendiente: entrega del material</h3>
      <p>Cuando <strong>${d.nombre}</strong> retire el material <strong>"${d.titulo}"</strong>, confirma la entrega para iniciar el conteo del plazo de devolución.</p>
      <a href="${d.linkPrestamo}" style="${btn("#2980b9")}">📖 Confirmar entrega del material</a>
      ${footer}`,

    rechazada_prestamista: `${header}
      <h3>❌ Material no disponible</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>La biblioteca <strong>${d.bibPrestamista}</strong> no pudo facilitar el material.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Motivo</td><td style="padding:8px;background:#fff3cd">${d.motivo}</td></tr>
      </table>
      <p>Puedes intentar con otra biblioteca de la red.</p>
      ${footer}`,

    en_prestamo: `${header}
      <h3>📖 Material entregado</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Has recibido el material. Recuerda devolverlo a tiempo.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
        ${row("Plazo de préstamo", d.diasPrestamo + " días")}
        <tr><td style="padding:8px;background:#d4edda;font-weight:bold">Fecha límite</td><td style="padding:8px;background:#d4edda"><strong>${d.fechaDevolucion}</strong></td></tr>
      </table>
      <br>
      <a href="${d.linkDevolucion}" style="${btn("#27ae60")}">📗 Registrar devolución</a>
      ${footer}`,

    recordatorio: `${header}
      <h3>⏰ Recordatorio de devolución</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tienes <strong>${d.diasRestantes} días</strong> para devolver:</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
        <tr><td style="padding:8px;background:#fff3cd;font-weight:bold">Fecha límite</td><td style="padding:8px;background:#fff3cd"><strong>${d.fechaDevolucion}</strong></td></tr>
      </table>
      <br>
      <a href="${d.linkDevolucion}" style="${btn("#f39c12")}">📗 Registrar devolución</a>
      ${footer}`,

    recordatorio_retiro: `${header}
      <h3>⏰ Última oportunidad para retirar tu material</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>Tu préstamo <strong>"${d.titulo}"</strong> sigue reservado en <strong>${d.bibPrestamista}</strong>.</p>
      <div style="background:#fff3cd;border-left:4px solid #f39c12;padding:12px;margin:12px 0;border-radius:4px">
        ⌛ Te quedan aproximadamente <strong>${d.horasRestantes} hora(s)</strong> para retirarlo.
        Si no lo haces, la solicitud <strong>${d.id}</strong> se cerrará automáticamente y la reserva se liberará.
      </div>
      ${footer}`,

    retiro_vencido: `${header}
      <h3>⌛ Plazo de retiro vencido</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>El plazo para retirar el material <strong>"${d.titulo}"</strong> en <strong>${d.bibPrestamista}</strong> ha vencido y la solicitud <strong>${d.id}</strong> fue cerrada. La reserva del material fue liberada.</p>
      <p>Si aún necesitas el material, puedes realizar una <strong>nueva solicitud</strong> a través del formulario de la Red Reunir.</p>
      ${footer}`,

    retiro_vencido_prestamista: `${header}
      <h3>📦 Material no retirado — liberar reserva</h3>
      <p>El usuario <strong>${d.nombre}</strong> no retiró el material <strong>"${d.titulo}"</strong> dentro del plazo establecido.</p>
      <p>La solicitud <strong>${d.id}</strong> fue cerrada automáticamente. Puedes <strong>reincorporar el material a tu colección</strong>.</p>
      ${footer}`,

    vencida: `${header}
      <h3>🚨 Material vencido</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>El material <strong>"${d.titulo}"</strong> superó la fecha de devolución.</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
        ${row("Fecha límite que venció", d.fechaDevolucion)}
        <tr><td style="padding:8px;background:#f8d7da;font-weight:bold">Días de retraso</td><td style="padding:8px;background:#f8d7da"><strong>${d.diasVencido}</strong></td></tr>
      </table>
      <p>Por favor regulariza la devolución lo antes posible.</p>
      ${footer}`,

    devuelta: `${header}
      <h3>📗 Devolución registrada</h3>
      <p>Hola <strong>${d.nombre}</strong>,</p>
      <p>La devolución fue registrada. ¡Gracias!</p>
      <table style="width:100%;border-collapse:collapse">
        ${row("ID", d.id)}
        ${row("Título", d.titulo, true)}
      </table>
      ${footer}`,
  };

  return `<html><body style="margin:0;padding:0;background:#f0f0f0">
    <div style="max-width:600px;margin:20px auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
      ${plantillas[tipo] || "<p>Correo no configurado.</p>"}
    </div></body></html>`;
}

// ============================================================
//  8. PÁGINA GENÉRICA DE ACCIÓN
// ============================================================
function paginaAccion(id, action, titulo, color, intro, campos) {
  const inputs = campos.map(c => {
    const req = c.required ? "required" : "";
    let field;
    if (c.type === "textarea") {
      field = `<textarea name="${c.name}" rows="4" ${req} style="width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px"></textarea>`;
    } else if (c.type === "date") {
      field = `<input type="date" name="${c.name}" ${req} style="width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px">`;
    } else {
      field = `<input type="text" name="${c.name}" ${req} style="width:100%;padding:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px">`;
    }
    return `<label style="display:block;margin:12px 0 4px;font-weight:bold;font-size:14px">${c.label}</label>${field}`;
  }).join("");

  const html = `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family:Arial;max-width:520px;margin:30px auto;padding:0">
      <div style="background:#8B0000;padding:16px;border-radius:8px 8px 0 0;text-align:center">
        <h2 style="color:white;margin:0">Red Reunir</h2>
      </div>
      <div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
        <h3 style="margin-top:0">${titulo} — ${id}</h3>
        <p style="color:#555;font-size:14px">${intro}</p>
        <form method="get" action="${CONFIG.WEBAPP_URL}">
          <input type="hidden" name="action" value="${action}">
          <input type="hidden" name="id" value="${id}">
          ${inputs}
          <br><br>
          <button type="submit" style="background:${color};color:white;padding:12px 24px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:15px">
            Confirmar
          </button>
        </form>
      </div>
    </body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(titulo + " — Red Reunir");
}

// ============================================================
//  9. FUNCIONES AUXILIARES
// ============================================================
function enviarCorreo({ para, asunto, cuerpo }) {
  MailApp.sendEmail({
    to: para, subject: asunto, htmlBody: cuerpo,
    name: CONFIG.NOMBRE_RED, replyTo: CONFIG.ADMIN_EMAIL,
  });
}

function crearLinkAccion(id, action) {
  return `${CONFIG.WEBAPP_URL}?action=${action}&id=${encodeURIComponent(id)}`;
}

function buscarFila(hoja, id) {
  const vals = hoja.getRange(1, COL.ID, hoja.getLastRow(), 1).getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === id) return i + 1;
  }
  return null;
}

function fmt(d) {
  if (!d) return "";
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return "";
  return Utilities.formatDate(d, "America/Bogota", "dd/MM/yyyy");
}
function fmtHora(d) {
  return Utilities.formatDate(d, "America/Bogota", "dd/MM/yyyy HH:mm");
}
function parseFecha(str) {
  if (!str) return "";
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d;
}

// Convierte "dd/MM/yyyy HH:mm" (formato de fmtHora) o un Date a objeto Date
function parseFechaHora(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  const m = String(valor).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

function logEntry(msg, actor) {
  const ts = fmtHora(new Date());
  return `[${ts}] ${actor ? actor + ": " : ""}${msg}`;
}
function appendLog(hoja, fila, msg) {
  const cell = hoja.getRange(fila, COL.HISTORIAL);
  const prev = cell.getValue() || "";
  cell.setValue(prev + (prev ? "\n" : "") + logEntry(msg));
}

// Escapa texto que viene de parámetros de la URL antes de mostrarlo en HTML
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function respuestaHTML(msg) {
  return HtmlService.createHtmlOutput(`
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family:Arial;max-width:500px;margin:60px auto;text-align:center">
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
//  10. CONFIGURACIÓN INICIAL (ejecutar UNA sola vez)
// ============================================================
function setupInicial() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  let hoja = ss.getSheetByName(CONFIG.HOJA_SOLICITUDES);
  if (!hoja) hoja = ss.insertSheet(CONFIG.HOJA_SOLICITUDES);

  const encabezados = [
    "ID", "Fecha solicitud", "Nombre solicitante", "Correo solicitante",
    "Tipo de usuario", "Número de documento", "Programa académico",
    "Biblioteca solicitante (origen)", "Correo biblioteca origen",
    "Biblioteca prestamista (destino)", "Correo biblioteca prestamista",
    "Tipo material", "Título", "Autor", "Información / Observaciones", "Estado",
    "Autorización origen (SI/NO)", "Vigencia del usuario", "Funcionario origen", "Fecha decisión origen", "Motivo rechazo origen",
    "Disponibilidad (SI/NO)", "Funcionario prestamista", "Fecha decisión prestamista", "Motivo rechazo prestamista",
    "Fecha préstamo", "Fecha devolución esperada", "Fecha devolución real", "Se entregó material", "ID Calendar", "Historial",
  ];
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  hoja.getRange(1, 1, 1, encabezados.length).setBackground("#8B0000").setFontColor("white").setFontWeight("bold");
  hoja.setFrozenRows(1);

  let hojaBib = ss.getSheetByName(CONFIG.HOJA_BIBLIOTECAS);
  if (!hojaBib) hojaBib = ss.insertSheet(CONFIG.HOJA_BIBLIOTECAS);
  const encBib = ["Nombre biblioteca", "Institución", "Correo responsable", "Días préstamo", "Ciudad / Red", "Correo activo"];
  hojaBib.getRange(1, 1, 1, encBib.length).setValues([encBib]);
  hojaBib.getRange(1, 1, 1, encBib.length).setBackground("#8B0000").setFontColor("white").setFontWeight("bold");
  hojaBib.setFrozenRows(1);

  const triggers = ScriptApp.getProjectTriggers();
  if (!triggers.some(t => t.getHandlerFunction() === "verificarVencimientos")) {
    ScriptApp.newTrigger("verificarVencimientos").timeBased().everyDays(1).atHour(8).create();
  }

  Logger.log("✅ Setup completado (hoja de 31 columnas).");
}

// ============================================================
//  11. FORMULARIO
// ============================================================
function _camposFormulario(form) {
  const ss      = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hojaBib = ss.getSheetByName(CONFIG.HOJA_BIBLIOTECAS);
  const filas   = hojaBib.getRange(2, 1, Math.max(hojaBib.getLastRow() - 1, 1), 1).getValues();
  const bibliotecas = filas.map(f => f[0]).filter(n => n !== "");

  form.setTitle("PRÉSTAMO INTERBIBLIOTECARIO - RED REUNIR");
  form.setDescription("RED DE UNIDADES DE INFORMACIÓN DE RISARALDA Y EJE CAFETERO");
  form.setConfirmationMessage("Solicitud registrada. Tu biblioteca validará tu usuario y luego se gestionará el préstamo. Recibirás notificaciones por correo.");

  form.addSectionHeaderItem()
    .setTitle("FORMULARIO DE SOLICITUD")
    .setHelpText("Diligencia completamente este formulario para iniciar la solicitud de préstamo interbibliotecario.");

  form.addTextItem().setTitle("Nombre completo del solicitante").setRequired(true);
  form.addTextItem().setTitle("Correo institucional").setRequired(true);
  form.addListItem().setTitle("Tipo de usuario").setChoiceValues(["Estudiante", "Docente", "Administrativo", "Egresado", "Otro"]).setRequired(true);
  form.addTextItem().setTitle("Número de documento de identificación").setRequired(true);
  form.addListItem().setTitle("Biblioteca solicitante (a la que perteneces)").setChoiceValues(bibliotecas).setRequired(true);
  form.addListItem().setTitle("Biblioteca prestamista (a la que se solicita el material)").setChoiceValues(bibliotecas).setRequired(true);
  form.addTextItem().setTitle("Programa académico").setRequired(true);
  form.addListItem().setTitle("Tipo de material").setChoiceValues(["Libro", "Revista", "Artículo", "Otro"]).setRequired(true);
  form.addTextItem().setTitle("Título").setRequired(true);
  form.addTextItem().setTitle("Autor").setRequired(false);
  form.addParagraphTextItem().setTitle("Información adicional / Observaciones").setRequired(false);
}

function crearFormularioReunir() {
  const form = FormApp.create("Solicitud de Préstamo Interbibliotecario - Red Reunir");
  _camposFormulario(form);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, CONFIG.SHEET_ID);
  Logger.log("Formulario creado: " + form.getPublishedUrl());
}

function ajustarFormularioReunir() {
  const files = DriveApp.getFilesByName("Solicitud de Préstamo Interbibliotecario - Red Reunir");
  if (!files.hasNext()) throw new Error("No encontré el formulario con ese nombre exacto.");
  const form = FormApp.openById(files.next().getId());
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) form.deleteItem(items[i]);
  _camposFormulario(form);
  Logger.log("Formulario ajustado: " + form.getPublishedUrl());
}

// ============================================================
//  12. TRIGGERS Y UTILIDADES
// ============================================================
function repararTriggerFormulario() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "onFormSubmit" || fn === "procesarFormularioReunir") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("procesarFormularioReunir").forSpreadsheet(CONFIG.SHEET_ID).onFormSubmit().create();
  Logger.log("✅ Trigger del formulario reparado.");
}

function verUrlFormulario() {
  const files = DriveApp.getFilesByName("Solicitud de Préstamo Interbibliotecario - Red Reunir");
  Logger.log(files.hasNext() ? FormApp.openById(files.next().getId()).getPublishedUrl() : "Formulario no encontrado");
}

// ============================================================
//  13. POBLAR HOJA BIBLIOTECAS (ejecutar UNA sola vez)
// ============================================================
function poblarHojaBibliotecas() {
  const ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const hoja = ss.getSheetByName(CONFIG.HOJA_BIBLIOTECAS);
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).clearContent();

  const bibliotecas = [
    ["Universidad Libre Pereira", "Universidad Libre Pereira", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["SENA Centro agropecuario de comercio y servicios", "SENA Centro agropecuario de comercio y servicios", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Escuela Superior de Administración Pública ESAP", "Escuela Superior de Administración Pública ESAP", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["Fundación Universitaria Comfamiliar Risaralda", "Fundación Universitaria Comfamiliar Risaralda", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Biblioteca Pública Municipal", "Biblioteca Pública Municipal", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Universidad Tecnológica de Pereira", "Universidad Tecnológica de Pereira", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Universidad Antonio Nariño", "Universidad Antonio Nariño", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Uniclaretiana Pereira", "Uniclaretiana Pereira", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Escuela de Ciencias Administrativas CIAF", "Escuela de Ciencias Administrativas CIAF", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Mediateca David B. Alianza Francesa", "Mediateca David B. Alianza Francesa", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Biblioteca Pública Bilingüe del Colombo Americano", "Biblioteca Pública Bilingüe del Colombo Americano", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["Universidad Católica de Pereira", "Universidad Católica de Pereira", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["Universidad Cooperativa de Colombia", "Universidad Cooperativa de Colombia", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Fundación Universitaria del Área Andina", "Fundación Universitaria del Área Andina", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["UNISARC Santa Rosa de Cabal", "UNISARC Santa Rosa de Cabal", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Biblioteca Pública Dptal Comfamiliar Risaralda - Sala de patrimonio bibliográfico y documental de Risaralda", "Biblioteca Pública Dptal Comfamiliar Risaralda", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Universidad Minuto de Dios UNIMINUTO", "Universidad Minuto de Dios UNIMINUTO", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["SENA Centro de diseño e innovación tecnológica", "SENA Centro de diseño e innovación tecnológica", "correo@institucion.edu.co", 15, "Pereira / Eje Cafetero", "Sí"],
    ["Centro Cultural Biblioteca Banco de la República", "Centro Cultural Biblioteca Banco de la República", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Fundación Universitaria Visión de las Américas", "Fundación Universitaria Visión de las Américas", "Sin correo registrado", 15, "Pereira / Eje Cafetero", "No"],
    ["Universidad de Caldas", "Universidad de Caldas", "Sin correo registrado", 15, "Eje Cafetero / Manizales", "No"],
    ["Universidad de Manizales", "Universidad de Manizales", "Sin correo registrado", 15, "Eje Cafetero / Manizales", "No"],
    ["Universidad Nacional sede Manizales", "Universidad Nacional sede Manizales", "Sin correo registrado", 15, "Eje Cafetero / Manizales", "No"],
    ["Universidad Autónoma de Manizales", "Universidad Autónoma de Manizales", "correo@institucion.edu.co", 15, "Eje Cafetero / Manizales", "Sí"],
    ["Universidad Católica Luis Amigó Manizales", "Universidad Católica Luis Amigó Manizales", "Sin correo registrado", 15, "Eje Cafetero / Manizales", "No"],
    ["Universidad Católica de Manizales", "Universidad Católica de Manizales", "correo@institucion.edu.co", 15, "Eje Cafetero / Manizales", "Sí"],
  ];

  hoja.getRange(2, 1, bibliotecas.length, 6).setValues(bibliotecas);
  hoja.getRange(2, 1, bibliotecas.length, 6).setVerticalAlignment("middle");
  hoja.autoResizeColumns(1, 6);
  Logger.log(`✅ ${bibliotecas.length} bibliotecas registradas.`);
}