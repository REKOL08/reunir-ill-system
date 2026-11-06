# El viaje del libro — Presentación del Sistema de Préstamo Interbibliotecario de la Red REUNIR

**Evento:** Lanzamiento del Servicio de Préstamo Interbibliotecario para Risaralda y el Eje Cafetero (REUNIR), en la Feria del Libro de Pereira 2026 (XII versión, "El amor, origen de todas las historias", 5 al 9 de noviembre). Un evento de la Cámara de Comercio de Pereira, con RUN y REUNIR.
**Fecha y lugar:** 9 de noviembre de 2026, 3:00 p. m., Salón Pueblo Rico, Expofuturo.
**Lema:** "¡Un libro puede llevarte lejos; ahora también viaja hacia ti!"

## Punto de partida
Antes, el préstamo interbibliotecario de REUNIR funcionaba con un formulario y una hoja de cálculo sin automatización: revisión manual, sin avisos ni seguimiento de fechas. El reto era lograr trazabilidad y comunicación entre bibliotecas.

## Las siete fases (paso a paso)
1. **Idea.** Desde la coordinación anterior, las compañeras Yudy Mayerly y Claudia Trejos proyectaron un sistema automatizado para el préstamo interbibliotecario: una solución integral para la gestión del préstamo de la Red REUNIR.
2. **Oportunidades de mejora.** Desde la coordinación de REUNIR se identificaron opciones de mejora en el formato vigente.
3. **Revisión del sistema actual.** Se revisó el sistema para identificar sus falencias.
4. **Delegación.** Desde la revisión, la coordinación delegó en el analista de biblioteca Alejandro Labrada el concepto del sistema.
5. **Construcción.** Alejandro identificó el flujo y realizó la conexión dentro de la consola de Apps Script, para tener trazabilidad de acuerdo con el flujo de trabajo de la persona encargada. Herramientas: Gmail, Hojas de cálculo, Calendar, Formularios (y Apps Script como motor); ninguna aplicación adicional.
6. **Versión beta.** Se revisó lo generado con todas las coordinaciones y direcciones de REUNIR; se socializó, se pactaron mejoras dentro del flujo y se propuso una segunda reunión.
7. **Validación.** En la segunda reunión se validó con la auxiliar de biblioteca (Mary Soler Vinasco), fortaleciendo el sistema desde el qué hacer al recibir la solicitud.

## El sistema, paso a paso
- **Paso 1 · Formulario:** el usuario diligencia el formulario público; elige de una lista la biblioteca solicitante y la prestamista (sin escribir correos).
- **Paso 2 · Flujo con dos validaciones:** (1) solicitud; (2) biblioteca de origen valida al usuario (vigencia, multas, entregas pendientes) y aprueba o rechaza con motivo; (3) biblioteca prestamista confirma disponibilidad; (4) retiro en 24 h (recordatorio a las 24 h, cierre a las 48 h si no se retira); (5) préstamo con fecha de devolución en Calendar (15 días por defecto, máximo 120, definido por cada biblioteca); (6) devolución con aviso 3 días antes y registro con un clic.
- **Paso 3 · Apps Script:** el motor; se activa al enviar el formulario, usa bloqueo contra dobles clics e IDs repetidos, revisa vencimientos cada día a las 8:00 a. m. y dispone de 16 plantillas de correo.
- **Paso 4 · Hoja de cálculo:** 31 columnas (solicitante, bibliotecas, material, validación de origen, disponibilidad, préstamo, estado, Calendar e Historial con bitácora de cada cambio).
- **Paso 5 · Avisos y plazos:** Gmail y Calendar recuerdan los plazos; el administrador es avisado de vencimientos y de bibliotecas sin correo.

## Mejoras técnicas recientes (nov 2026)
Bloqueo contra concurrencia, recordatorios sin duplicados y escape de HTML en los enlaces. Nueva versión del Web App publicada el 4 de noviembre de 2026 (versión 15).

## Para el conversatorio
Costo: $0 (todo en Google Workspace). Límite de correos: ~1.500/día en Workspace. Pendientes: registrar el correo de las bibliotecas que aún no lo tienen y completar el enlace del formulario en la configuración.
