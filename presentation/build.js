const pptxgen = require("pptxgenjs");

// ---- Paleta real del proyecto (docs/open-design/kinora/DESIGN.md) ----
const BG = "09090C";
const SURFACE = "16161B";
const SURFACE2 = "1F1F25";
const BORDER = "33333B";
const FG = "F5F5F7";
const MUTED = "9A9AA5";
const ACCENT = "A8F060";
const ACCENT_FG = "09090C";
const WARN = "E8C15A";
const INFO = "6BA8E8";

const TITLE_FONT = "Arial";
const BODY_FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Aitor Ruiz de Samaniego";
pres.title = "kInorA — Trabajo de Fin de Máster";

const W = 13.3, H = 7.5;
const M = 0.75;

const SECTIONS = [null, "Problema", "Problema", "Producto", "Producto", "Producto", "Producto",
  "Producto", "Por qué el método", "Cómo está construido", "Cómo está construido",
  "Cómo se construyó", "Cómo se construyó", "Cómo se construyó", "Cierre", null];
let slideNo = 0;

function base(notes) {
  const s = pres.addSlide();
  s.background = { color: BG };
  const label = SECTIONS[slideNo];
  slideNo += 1;
  if (label) {
    s.addText(label.toUpperCase(), {
      x: W - M - 4.0, y: 0.42, w: 4.0, h: 0.3, align: "right",
      fontFace: BODY_FONT, fontSize: 10, bold: true, charSpacing: 1.5, color: BORDER, margin: 0,
    });
  }
  if (notes) s.addNotes(notes);
  return s;
}

// Título de sección estándar
function title(s, text, sub) {
  s.addText(text, {
    x: M, y: 0.5, w: W - 2 * M, h: 0.8,
    fontFace: TITLE_FONT, fontSize: 34, bold: true, color: FG, margin: 0,
  });
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.3, w: W - 2 * M, h: 0.45,
      fontFace: BODY_FONT, fontSize: 15, color: MUTED, margin: 0,
    });
  }
}

// Tarjeta
function card(s, x, y, w, h, fill) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.14,
    fill: { color: fill || SURFACE },
    line: { color: BORDER, width: 1 },
  });
}

// Píldora de acento con número
function pill(s, x, y, d, txt) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: d, h: d, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  s.addText(txt, {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT_FG, margin: 0,
  });
}

// =====================================================================
// 1 — Portada
// =====================================================================
{
  const s = base(
    "[0:00–0:18] Soy Aitor Ruiz de Samaniego y esto es kInorA, mi trabajo de fin de máster: una plataforma que genera y adapta planes de entrenamiento con inteligencia artificial. En los próximos ocho minutos quiero contar tres cosas: qué problema resuelve, cómo está construido y, sobre todo, cómo se construyó."
  );
  s.addShape(pres.ShapeType.ellipse, {
    x: 9.4, y: -1.6, w: 6.2, h: 6.2, fill: { color: SURFACE }, line: { color: SURFACE, width: 0 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: 10.9, y: -0.1, w: 3.2, h: 3.2, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  s.addText("kInorA", {
    x: M, y: 2.5, w: 8.5, h: 1.3,
    fontFace: TITLE_FONT, fontSize: 66, bold: true, color: FG, margin: 0,
  });
  s.addText("Entrenamiento personalizado con inteligencia artificial", {
    x: M, y: 3.75, w: 8.5, h: 0.6,
    fontFace: BODY_FONT, fontSize: 20, color: ACCENT, margin: 0,
  });
  s.addText("Planes que se adaptan al cuerpo real: objetivos, material y lesiones.", {
    x: M, y: 4.35, w: 8.0, h: 0.5,
    fontFace: BODY_FONT, fontSize: 15, color: MUTED, margin: 0,
  });
  s.addText("Aitor Ruiz de Samaniego   ·   Trabajo de Fin de Máster   ·   2026", {
    x: M, y: 6.4, w: 9, h: 0.4,
    fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 2 — El problema
// =====================================================================
{
  const s = base(
    "[0:18–0:52] El problema no es que falte información sobre entrenamiento: sobra. El problema es el abandono. La mitad de las altas de gimnasio se dan de baja en seis meses. Solo el veintitrés por ciento de los socios estadounidenses usó entrenador personal en 2024, y no es raro: en Barcelona una sesión cuesta entre cuarenta y setenta euros. Y mil setecientos diez millones de personas conviven con alguna afección musculoesquelética. Quien más necesita un plan adaptado es quien menos puede pagarlo."
  );
  title(s, "El abandono es la norma", "Y quien más necesita adaptación es quien menos puede pagarla");

  const stats = [
    { n: "50 %", t: "de las altas de gimnasio\nse dan de baja en 6 meses", c: ACCENT },
    { n: "23 %", t: "de los socios usa entrenador\npersonal · 40–70 € la sesión", c: ACCENT },
    { n: "1.710 M", t: "de personas con afección\nmusculoesquelética (OMS)", c: ACCENT },
  ];
  const cw = (W - 2 * M - 2 * 0.42) / 3, gap = 0.42;
  stats.forEach((st, i) => {
    const x = M + i * (cw + gap);
    card(s, x, 2.2, cw, 2.5);
    s.addText(st.n, {
      x: x + 0.3, y: 2.5, w: cw - 0.6, h: 0.95,
      fontFace: TITLE_FONT, fontSize: 44, bold: true, color: st.c, margin: 0,
    });
    s.addText(st.t, {
      x: x + 0.3, y: 3.5, w: cw - 0.6, h: 1.0,
      fontFace: BODY_FONT, fontSize: 14, color: MUTED, margin: 0,
    });
  });

  card(s, M, 5.05, W - 2 * M, 1.05, SURFACE2);
  s.addText("Entre el plan genérico gratuito y el entrenador que casi nadie paga, no hay nada.", {
    x: M + 0.35, y: 5.05, w: W - 2 * M - 0.7, h: 1.05, valign: "middle",
    fontFace: BODY_FONT, fontSize: 18, color: FG, margin: 0,
  });
  s.addText("Altas y bajas: HFA 2025 y YouGov 2024, vía Gymdesk. Uso de entrenador personal: socios de EE. UU., 2024. Prevalencia musculoesquelética: OMS, datos de 2019.", {
    x: M, y: 6.3, w: 11.6, h: 0.4, fontFace: BODY_FONT, fontSize: 10.5, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 3 — El hueco competitivo
// =====================================================================
{
  const s = base(
    "[0:52–1:28] El segmento está poblado, así que conviene ser honesto. Por debajo hay aplicaciones baratas que ajustan volumen y material, como Fitbod o Freeletics. SensAI ya usa un modelo de lenguaje, pero para regular la carga según sueño y fatiga, no para adaptar el ejercicio a una lesión. Y por encima están los servicios con entrenador humano, a doscientos dólares al mes. Ninguno de los cinco documenta la adaptación a limitaciones físicas declaradas como capacidad de primer orden. Ese es el hueco."
  );
  title(s, "Dónde está el hueco", "Cinco competidores, dos extremos bien cubiertos y un espacio vacío en medio");

  const rows = [
    ["Fitbod", "13–16 $/mes", "Rotación algorítmica, sustitución por material"],
    ["Freeletics", "35–80 $/periodo", "Adapta al esfuerzo declarado, no a recuperación"],
    ["SensAI", "7 $/mes", "Modelo de lenguaje; métricas autodeclaradas"],
    ["Trainiac", "Vía Wellhub", "Entrenador humano asíncrono"],
    ["Future", "199 $/mes", "Entrenador humano que edita el plan"],
  ];
  let y = 2.05;
  rows.forEach((r) => {
    card(s, M, y, 7.9, 0.62, SURFACE);
    s.addText(r[0], { x: M + 0.25, y, w: 1.8, h: 0.62, valign: "middle", fontFace: TITLE_FONT, fontSize: 14, bold: true, color: FG, margin: 0 });
    s.addText(r[1], { x: M + 2.0, y, w: 1.7, h: 0.62, valign: "middle", fontFace: BODY_FONT, fontSize: 13, color: ACCENT, margin: 0 });
    s.addText(r[2], { x: M + 3.75, y, w: 4.05, h: 0.62, valign: "middle", fontFace: BODY_FONT, fontSize: 12, color: MUTED, margin: 0 });
    y += 0.72;
  });

  card(s, 9.05, 2.05, 3.5, 3.50, SURFACE2);
  s.addText("Ninguno documenta la limitación física declarada como capacidad de primer orden.", {
    x: 9.35, y: 2.30, w: 2.9, h: 1.5,
    fontFace: BODY_FONT, fontSize: 15, color: FG, margin: 0,
  });
  s.addText("kInorA la trata como entrada de primera clase.", {
    x: 9.35, y: 4.15, w: 2.9, h: 1.2,
    fontFace: TITLE_FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0,
  });

  s.addText("Precios y capacidades recogidos de la comparativa publicada por SensAI en 2026, una de las aplicaciones comparadas: se han tomado sus datos, no sus juicios. Revisión de documentación pública, sin auditar el comportamiento real de los productos.", {
    x: M, y: 5.95, w: 11.6, h: 0.6,
    fontFace: BODY_FONT, fontSize: 10.5, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 4 — La solución
// =====================================================================
{
  const s = base(
    "[1:28–2:02] kInorA genera y adapta planes al cuerpo real de cada persona. Cuatro capacidades lo definen: adaptación a lesiones, dos modos de definir el plan, memoria persistente que se puede ver y borrar, y entrenamiento offline. Y existe en tres niveles: una persona sola, un entrenador con sus clientes, y un gimnasio con su marca."
  );
  title(s, "Planes para el cuerpo real", "Cuatro capacidades que definen el producto");

  const feats = [
    ["1", "Adaptación a lesiones", "Filtra, sustituye y avisa respetando la zona comprometida. Sugerencia, nunca diagnóstico."],
    ["2", "Tarjetas o voz", "Dos modos que escriben la misma estructura. Se alterna sin perder lo avanzado."],
    ["3", "Memoria persistente", "Recuerda material, contexto y preferencias. Visible, editable y borrable por el usuario."],
    ["4", "Entrenamiento offline", "Las series se anotan y se guardan en el móvil aunque no haya conexión, y se suben solas al recuperarla. En el gimnasio casi nunca hay cobertura."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, ch = 1.9, gx = 0.5, gy = 0.35;
  feats.forEach((f, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.15 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch);
    pill(s, x + 0.35, y + 0.35, 0.6, f[0]);
    s.addText(f[1], {
      x: x + 1.12, y: y + 0.32, w: cw - 1.45, h: 0.45,
      fontFace: TITLE_FONT, fontSize: 17, bold: true, color: FG, margin: 0,
    });
    s.addText(f[2], {
      x: x + 1.12, y: y + 0.82, w: cw - 1.45, h: 0.95,
      fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0,
    });
  });

  s.addText("Las cuatro capacidades son comunes a los tres niveles del producto: Persona, Entrenador y Gimnasio.", {
    x: M, y: 6.45, w: 11.6, h: 0.4,
    fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 5 — Demo 1: definir el plan
// =====================================================================
{
  const s = base(
    "[2:02–2:47] Vamos a verlo. Definir un plan tiene dos caminos. El asistente de tarjetas son seis pasos, dos minutos si uno sabe lo que quiere. El lugar va antes que el material, porque entrenar en casa o en un gimnasio cambia lo que tiene sentido ofrecer. El asistente por voz es una conversación, mejor cuando la situación tiene matices que ningún formulario recoge, que es el caso de quien arrastra una lesión. [DEMO 20 s: recorrer el asistente de tarjetas y después el modo conversación.]"
  );
  title(s, "Definir el plan", "Dos caminos hacia la misma estructura de datos");

  card(s, M, 2.1, 5.85, 3.6);
  s.addText("Asistente por tarjetas", { x: M + 0.4, y: 2.4, w: 5.0, h: 0.45, fontFace: TITLE_FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0 });
  s.addText(
    [
      { text: "Objetivo", options: { bullet: true, breakLine: true } },
      { text: "Lugar de entrenamiento", options: { bullet: true, breakLine: true } },
      { text: "Días por semana", options: { bullet: true, breakLine: true } },
      { text: "Duración de sesión", options: { bullet: true, breakLine: true } },
      { text: "Material disponible", options: { bullet: true, breakLine: true } },
      { text: "Limitaciones físicas", options: { bullet: true } },
    ],
    { x: M + 0.4, y: 2.95, w: 5.0, h: 2.4, fontFace: BODY_FONT, fontSize: 14, color: FG, paraSpaceAfter: 7, margin: 0 }
  );

  card(s, M + 6.35, 2.1, 5.85, 3.6);
  s.addText("Asistente por voz", { x: M + 6.75, y: 2.4, w: 5.0, h: 0.45, fontFace: TITLE_FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0 });
  s.addText(
    "«Quiero volver a entrenar tres días por semana, pero tengo una hernia lumbar y en casa solo tengo mancuernas.»",
    { x: M + 6.75, y: 2.95, w: 5.0, h: 1.3, fontFace: BODY_FONT, fontSize: 15, italic: true, color: FG, margin: 0 }
  );
  s.addText(
    "El sistema extrae la especificación mientras conversas, y puedes pasarte a las tarjetas sin perder nada.",
    { x: M + 6.75, y: 4.35, w: 5.0, h: 1.0, fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0 }
  );

  card(s, M, 5.95, W - 2 * M, 0.85, SURFACE2);
  s.addText("Los dos caminos producen la misma especificación de plan. Cambiar de modo a mitad no cuesta nada.", {
    x: M + 0.35, y: 5.95, w: W - 2 * M - 0.7, h: 0.85, valign: "middle",
    fontFace: BODY_FONT, fontSize: 15, color: FG, margin: 0,
  });
}

// =====================================================================
// 6 — Demo 2: el plan adaptado
// =====================================================================
{
  const s = base(
    "[2:47–3:40] Este es el resultado. La persona declara una hernia lumbar. Lo que hace la sustitución no es el modelo: es un filtro determinista sobre la matriz de carga por zona corporal del catálogo. Donde un plan genérico pondría peso muerto con barra, con carga axial alta sobre la columna, kInorA propone hip thrust con mancuerna: mismo objetivo de cadera, menos carga axial. Y avisa de que lo ha hecho. Quiero decirlo con claridad: es una sustitución razonada sobre criterio biomecánico documentado, no una indicación clínica, y todavía no la ha revisado un profesional sanitario. [DEMO 25 s: plan generado, aviso y sustitución.]"
  );
  title(s, "El plan adaptado", "No quita el ejercicio: lo cambia por otro que persigue el mismo objetivo con menos carga sobre la zona comprometida");

  // --- Paso a paso ---
  const steps = [
    ["1", "La persona declara", "Hernia discal lumbar. Entrena en casa con mancuernas y banda."],
    ["2", "El catálogo filtra", "Filtro determinista sobre la matriz de carga por zona corporal. El modelo redacta el plan; no decide la sustitución."],
    ["3", "El plan cambia", "Sustituye el ejercicio y deja constancia del motivo."],
  ];
  const sw = (W - 2 * M - 2 * 0.42) / 3, sgap = 0.42;
  steps.forEach((st, i) => {
    const x = M + i * (sw + sgap);
    card(s, x, 2.0, sw, 1.55);
    pill(s, x + 0.28, 2.22, 0.5, st[0]);
    s.addText(st[1], {
      x: x + 0.92, y: 2.2, w: sw - 1.2, h: 0.36,
      fontFace: TITLE_FONT, fontSize: 14, bold: true, color: FG, margin: 0,
    });
    s.addText(st[2], {
      x: x + 0.92, y: 2.58, w: sw - 1.2, h: 0.75,
      fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0,
    });
  });

  // --- Antes y despues ---
  card(s, M, 3.85, W - 2 * M, 1.60, SURFACE2);

  s.addText("Lo que pondría un plan genérico", {
    x: M + 0.45, y: 4.00, w: 4.9, h: 0.32,
    fontFace: BODY_FONT, fontSize: 11.5, color: MUTED, margin: 0,
  });
  s.addText("Peso muerto con barra", {
    x: M + 0.45, y: 4.32, w: 4.9, h: 0.5,
    fontFace: TITLE_FONT, fontSize: 21, bold: true, color: MUTED, margin: 0,
  });
  s.addText("Carga axial alta sobre la columna", {
    x: M + 0.45, y: 4.87, w: 4.9, h: 0.4,
    fontFace: BODY_FONT, fontSize: 12.5, color: WARN, margin: 0,
  });

  s.addText("→", {
    x: 6.0, y: 4.22, w: 1.3, h: 0.7, align: "center",
    fontFace: TITLE_FONT, fontSize: 30, bold: true, color: ACCENT, margin: 0,
  });

  s.addText("Lo que pone kInorA", {
    x: 7.45, y: 4.00, w: 4.65, h: 0.32,
    fontFace: BODY_FONT, fontSize: 11.5, color: MUTED, margin: 0,
  });
  s.addText("Hip thrust con mancuerna", {
    x: 7.45, y: 4.32, w: 4.65, h: 0.5,
    fontFace: TITLE_FONT, fontSize: 21, bold: true, color: ACCENT, margin: 0,
  });
  s.addText("Mismo objetivo de cadera, con menos carga axial", {
    x: 7.45, y: 4.87, w: 4.65, h: 0.4,
    fontFace: BODY_FONT, fontSize: 12.5, color: FG, margin: 0,
  });

  // --- Lo que ve la persona ---
  card(s, M, 5.6, W - 2 * M, 0.85, SURFACE);
  s.addText("En la app", {
    x: M + 0.35, y: 5.6, w: 1.1, h: 0.85, valign: "middle",
    fontFace: TITLE_FONT, fontSize: 12, bold: true, color: MUTED, margin: 0,
  });
  s.addText("«Se han ajustado 3 ejercicios por la limitación que has declarado.»", {
    x: M + 1.55, y: 5.6, w: 9.6, h: 0.85, valign: "middle",
    fontFace: BODY_FONT, fontSize: 14, color: FG, margin: 0,
  });

  s.addText("Sugerencias, nunca diagnóstico ni bloqueo clínico. La matriz de carga por zona corporal aún no ha sido revisada por un profesional sanitario: es el primer paso pendiente.", {
    x: M, y: 6.55, w: 11.6, h: 0.45,
    fontFace: BODY_FONT, fontSize: 12, italic: true, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 7 — Demo 3: entrenar y medir
// =====================================================================
{
  const s = base(
    "[3:40–4:15] Entrenar y medir. Anotar las series tiene tres estados —por debajo, cumplido, por encima— y funciona offline: se guarda en el móvil y se sincroniza al recuperar la conexión. Con esos datos el sistema calcula adherencia, volumen y récords, y propone ajustes que la persona confirma. Y todo lo que el sistema aprende vive en una memoria que se puede abrir, editar y borrar entera. [DEMO 15 s: registrar una serie y mostrar el panel.]"
  );
  title(s, "Entrenar y medir", "El dato que entra por la puerta vuelve convertido en ajuste");

  const items = [
    ["Anotar las series", "Tres estados por serie —por debajo, cumplido, por encima—. Funciona offline, con el móvil en la mano."],
    ["Progreso", "Adherencia, volumen semanal, racha y récords personales por ejercicio."],
    ["Adaptación", "Propone bajar frecuencia si la adherencia cae, o ajustar carga según el esfuerzo percibido."],
  ];
  const cw = 3.75, gap = 0.42;
  items.forEach((it, i) => {
    const x = M + i * (cw + gap);
    card(s, x, 2.15, cw, 2.4);
    s.addText(it[0], { x: x + 0.32, y: 2.45, w: cw - 0.64, h: 0.5, fontFace: TITLE_FONT, fontSize: 20, bold: true, color: ACCENT, margin: 0 });
    s.addText(it[1], { x: x + 0.32, y: 3.0, w: cw - 0.64, h: 1.45, fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0 });
  });

  card(s, M, 5.0, W - 2 * M, 1.1, SURFACE2);
  s.addText("La adaptación nunca se aplica sola: el servidor recalcula la recomendación y el usuario la confirma.", {
    x: M + 0.35, y: 5.0, w: W - 2 * M - 0.7, h: 1.1, valign: "middle",
    fontFace: BODY_FONT, fontSize: 15, color: FG, margin: 0,
  });
}

// =====================================================================
// 8 — No fabricar datos
// =====================================================================
{
  const s = base(
    "[4:15–4:40] Si me quedo con una sola decisión de producto, es esta: el sistema no inventa datos. Días numerados, no lunes, porque el modelo no conoce el calendario. Lo que no se puede calcular se deja vacío. Y una sesión olvidada nunca se marca como completada. Prefiero un hueco a un número inventado."
  );
  title(s, "No fabricar datos", "El criterio que atraviesa todo el producto");

  const rules = [
    ["Días numerados", "«Día 1», no «lunes». El modelo no tiene anclaje al calendario y fabricarlo sería engañoso."],
    ["Huecos honestos", "Un indicador que no se puede calcular se deja vacío en lugar de estimarlo."],
    ["Sin reproches", "El panel semanal no tiene estado de «día perdido». La adherencia se informa, no se juzga."],
    ["Sin falsos cierres", "Una sesión cerrada por inactividad no se marca como completada. Sería la misma mentira, una columna más allá."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, ch = 1.55, gx = 0.5, gy = 0.3;
  rules.forEach((r, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.15 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch);
    s.addText(r[0], { x: x + 0.35, y: y + 0.22, w: cw - 0.7, h: 0.4, fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT, margin: 0 });
    s.addText(r[1], { x: x + 0.35, y: y + 0.65, w: cw - 0.7, h: 0.75, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0 });
  });

  card(s, M, 5.85, W - 2 * M, 0.95, SURFACE2);
  s.addText("Un producto que prefiere un hueco a un número inventado es un producto en el que se puede confiar.", {
    x: M + 0.35, y: 5.85, w: W - 2 * M - 0.7, h: 0.95, valign: "middle",
    fontFace: BODY_FONT, fontSize: 16, color: FG, margin: 0,
  });
}

// =====================================================================
// 9 — Por que contamos el metodo
// =====================================================================
{
  const s = base(
    "[4:40–5:08] Eso es el producto. Ahora, por qué cuento cómo está hecho. En una categoría donde el modelo que uso hoy será peor y más caro dentro de seis meses, la ventaja no está en la funcionalidad: está en la velocidad de cambiarla. Cuarenta y dos cambios cerrados en cincuenta y dos días. Cambiar de proveedor es un clic, y adelanto la objeción: hoy ese clic es barato y ciego, y a eso vuelvo al final."
  );
  title(s, "Por qué importa cómo está hecho", "En este mercado, la velocidad de cambio vale más que cualquier funcionalidad concreta");

  const reasons = [
    ["Ciclo de semanas, no de trimestres",
     "42 cambios cerrados en 52 días, entre capacidades nuevas y endurecimientos. La ventana de oportunidad de este mercado se mide en semanas."],
    ["Crecer sin reescribir",
     "El nivel Entrenador y la marca blanca entraron como cambios acotados, no como reescrituras del producto."],
    ["Adoptar lo nuevo sin migrar",
     "Cuando aparece un modelo mejor o más barato, cambiar de proveedor es una decisión que se toma en un panel."],
    ["El conocimiento no se evapora",
     "42 cambios archivados con su razonamiento. Incorporar a una persona nueva —o a un agente— no depende de la memoria de nadie."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, ch = 1.72, gx = 0.5, gy = 0.32;
  reasons.forEach((r, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.1 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch);
    s.addText(r[0], { x: x + 0.35, y: y + 0.28, w: cw - 0.7, h: 0.45, fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT, margin: 0 });
    s.addText(r[1], { x: x + 0.35, y: y + 0.78, w: cw - 0.7, h: 0.95, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0 });
  });

  card(s, M, 6.0, W - 2 * M, 0.85, SURFACE2);
  s.addText("El método no es una nota al pie del proyecto. Es la ventaja competitiva.", {
    x: M + 0.35, y: 6.0, w: W - 2 * M - 0.7, h: 0.85, valign: "middle",
    fontFace: BODY_FONT, fontSize: 16, color: FG, margin: 0,
  });
}

// =====================================================================
// 10 — Arquitectura
// =====================================================================
{
  const s = base(
    "[5:08–5:34] Por debajo hay un monorepo con arquitectura limpia: web, móvil, API y PostgreSQL con pgvector. Las fronteras entre capas no son una recomendación: son nueve reglas que hacen fallar la compilación si se violan, y hay un test que comprueba que esas reglas fallan cuando deben fallar."
  );
  title(s, "Arquitectura", "Monorepo, arquitectura limpia y fronteras verificadas");

  const cw4 = (W - 2 * M - 3 * 0.28) / 4;
  const cols = [
    ["Clientes", ["Web · Next.js 16", "Móvil · React Native", "PWA offline"]],
    ["API", ["Fastify 5 · Node 24", "Rutas · casos de uso", "WebSocket"]],
    ["Núcleo", ["packages/domain", "packages/contracts", "Sin framework"]],
    ["Datos", ["PostgreSQL 17", "pgvector", "29 tablas"]],
  ];
  const cw = cw4, gap = 0.28;
  cols.forEach((c, i) => {
    const x = M + i * (cw + gap);
    card(s, x, 2.1, cw, 2.4);
    s.addText(c[0], { x: x + 0.28, y: 2.35, w: cw - 0.56, h: 0.42, fontFace: TITLE_FONT, fontSize: 17, bold: true, color: ACCENT, margin: 0 });
    s.addText(c[1].map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < c[1].length - 1 } })), {
      x: x + 0.28, y: 2.85, w: cw - 0.56, h: 1.4, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, paraSpaceAfter: 5, margin: 0,
    });
  });

  card(s, M, 4.85, W - 2 * M, 1.6, SURFACE2);
  s.addText("9 reglas de dependencia que hacen fallar la compilación", {
    x: M + 0.4, y: 5.05, w: 11, h: 0.45, fontFace: TITLE_FONT, fontSize: 18, bold: true, color: FG, margin: 0,
  });
  s.addText("El dominio no importa framework, base de datos ni red. El SDK de pagos vive en un único fichero. Las rutas no tocan la capa de datos. Y un test negativo comprueba que cada regla falla cuando debe fallar.", {
    x: M + 0.4, y: 5.55, w: 10.9, h: 0.8, fontFace: BODY_FONT, fontSize: 13.5, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 11 — La capa de IA
// =====================================================================
{
  const s = base(
    "[5:34–6:06] La capa de IA es la parte más difícil. Ningún proveedor está soldado al código: cinco adaptadores de generación conmutables, y voz elegible por separado. Los prompts viven fuera del código, versionados; si el gestor falla, el sistema cae a la plantilla compilada y sigue generando. Y hay dos mecanismos distintos de enmascarado, porque una lesión y un peso no admiten el mismo trato: la lesión no llega al modelo, y el peso sí llega al modelo pero no queda en la traza."
  );
  title(s, "La capa de IA", "Puertos, no proveedores");

  const blocks = [
    ["5 adaptadores de generación", "OpenRouter por defecto, más OpenAI, Anthropic, Google y OpenCode-Go, conmutables en caliente desde el panel de administración."],
    ["Voz elegible por separado", "Transcripción y síntesis con OpenAI, Gemini o Deepgram, decididas de forma independiente."],
    ["Prompts fuera del código", "Versionados en Langfuse. Si falla la descarga o la validación, cae a la plantilla compilada y sigue generando."],
    ["Privacidad en dos direcciones", "La lesión se enmascara antes de llegar al modelo, que tampoco la ve. El peso sí llega al modelo, pero se enmascara en la traza. Son datos del artículo 9 del RGPD."],
  ];
  const cw = 5.85, ch = 1.85, gx = 0.5, gy = 0.32;
  blocks.forEach((b, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.1 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch);
    s.addText(b[0], { x: x + 0.35, y: y + 0.28, w: cw - 0.7, h: 0.45, fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT, margin: 0 });
    s.addText(b[1], { x: x + 0.35, y: y + 0.78, w: cw - 0.7, h: 0.95, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, margin: 0 });
  });

  s.addText("Cambiar de proveedor es una decisión operativa, no una migración.", {
    x: M, y: 6.35, w: 11.5, h: 0.45,
    fontFace: BODY_FONT, fontSize: 15, italic: true, color: FG, margin: 0,
  });
}

// =====================================================================
// 12 — Cómo se construyó: el método
// =====================================================================
{
  const s = base(
    "[6:06–6:39] El ciclo no lo inventé yo, lo adopté; lo mío es cómo lo goberné. Nada se escribió sin pasar por siete fases donde el código es la sexta, y cada una deja un artefacto versionado. Un solo cambio dejó dos mil novecientas nueve líneas de exploración, propuesta, diseño, tareas, verificación y cierre. Y la exploración descubrió cuatro cosas que el issue original daba por buenas y no lo eran."
  );
  title(s, "Cómo se construyó", "Siete fases, y el código es la sexta");

  const phases = ["Explorar", "Proponer", "Especificar", "Diseñar", "Tareas", "Aplicar", "Verificar"];
  const pw = (W - 2 * M - 6 * 0.13) / 7, pgap = 0.13;
  phases.forEach((p, i) => {
    const x = M + i * (pw + pgap);
    const isCode = p === "Aplicar";
    card(s, x, 2.15, pw, 1.0, isCode ? SURFACE2 : SURFACE);
    s.addText(p, {
      x, y: 2.15, w: pw, h: 1.0, align: "center", valign: "middle",
      fontFace: TITLE_FONT, fontSize: 13, bold: true, color: isCode ? ACCENT : FG, margin: 0,
    });
  });

  card(s, M, 3.45, 5.85, 2.6);
  s.addText("Un cambio real: 17c", { x: M + 0.35, y: 3.7, w: 5.1, h: 0.42, fontFace: TITLE_FONT, fontSize: 17, bold: true, color: ACCENT, margin: 0 });
  s.addText(
    [
      { text: "design.md — 776 líneas", options: { bullet: true, breakLine: true } },
      { text: "tasks.md — 606 líneas", options: { bullet: true, breakLine: true } },
      { text: "spec.md — 358 líneas", options: { bullet: true, breakLine: true } },
      { text: "proposal.md — 335 líneas", options: { bullet: true, breakLine: true } },
      { text: "verify-report.md — 260 líneas", options: { bullet: true, breakLine: true } },
      { text: "archive-report.md — 231 líneas", options: { bullet: true, breakLine: true } },
      { text: "exploration.md — 158 líneas", options: { bullet: true, breakLine: true } },
      { text: "Total: 2.909 líneas", options: { bullet: false } },
    ],
    { x: M + 0.35, y: 4.2, w: 5.1, h: 1.7, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, paraSpaceAfter: 4, margin: 0 }
  );

  card(s, M + 6.35, 3.45, 5.85, 2.6, SURFACE2);
  s.addText("La exploración paga el ciclo entero", { x: M + 6.7, y: 3.7, w: 5.1, h: 0.42, fontFace: TITLE_FONT, fontSize: 17, bold: true, color: FG, margin: 0 });
  s.addText("Antes de escribir una línea encontró que la app móvil no tenía pantalla de perfil, que la serie de pesos tenía otra forma, que el cambio reescribiría el historial, y un canal de fuga de privacidad que el issue no mencionaba.", {
    x: M + 6.7, y: 4.2, w: 5.1, h: 1.6, fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 13 — Agentes, guardas y revisión adversarial
// =====================================================================
{
  const s = base(
    "[6:39–7:15] El volumen sale de delegar en agentes sobre un orquestador de terceros, gentle-ai, de Alan Buscaglia, que aporta las fases, la delegación y la revisión adversarial. Lo propio de este trabajo son el contrato de ciento cincuenta líneas que gobierna a los agentes, las siete comprobaciones automáticas y la calibración de la puerta de cobertura. Judgment Day encontró cuatro defectos en el trabajo offline que no rompían ninguna aserción: rompían garantías. Y lo digo porque es el contraejemplo de mi propia tesis: la guarda que no existe es la que decide qué se te escapa."
  );
  title(s, "Delegar sin perder el control", "Contrato propio sobre orquestación de terceros");

  const three = [
    ["AGENTS.md", "150 líneas de contrato. No fabricar resultados de tests. No commitear sin aprobación. Creció con cada fallo observado."],
    ["7 comprobaciones automáticas", "Tipos, tests, arquitectura, dependencias, interfaz contra API, compilación y directorios de test huérfanos. Bloquean la integración."],
    ["Judgment Day", "Revisión dual ciega adversarial, del orquestador gentle-ai. Cuatro defectos encontrados en el trabajo offline, ninguno rompía un test."],
  ];
  const cw = 3.75, gap = 0.42;
  three.forEach((t, i) => {
    const x = M + i * (cw + gap);
    card(s, x, 2.15, cw, 2.55);
    s.addText(t[0], { x: x + 0.32, y: 2.42, w: cw - 0.64, h: 0.45, fontFace: TITLE_FONT, fontSize: 18, bold: true, color: ACCENT, margin: 0 });
    s.addText(t[1], { x: x + 0.32, y: 2.95, w: cw - 0.64, h: 1.55, fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0 });
  });

  card(s, M, 5.0, W - 2 * M, 1.05, SURFACE2);
  s.addText("Y lo que no vieron", { x: M + 0.4, y: 5.0, w: 1.9, h: 1.05, valign: "middle", fontFace: TITLE_FONT, fontSize: 13, bold: true, color: WARN, margin: 0 });
  s.addText("Cuatro veces una variable de entorno que el código lee y que Compose no reenvía llegó a producción con el valor por defecto. Ninguna de las siete lo detecta.", {
    x: M + 2.5, y: 5.0, w: 9.3, h: 1.05, valign: "middle", fontFace: BODY_FONT, fontSize: 13, color: FG, margin: 0,
  });

  s.addText("Cobertura de tests: 94,35 % de las funciones de la API con base de datos, 91,51 % sin ella.    ·    El orquestador (gentle-ai, de Alan Buscaglia, MIT) aporta las fases, la delegación y Judgment Day; el contrato, las siete comprobaciones y la calibración de la puerta son de este proyecto.", {
    x: M, y: 6.25, w: 11.6, h: 0.6, fontFace: BODY_FONT, fontSize: 11, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 14 — Resultados
// =====================================================================
{
  const s = base(
    "[7:15–7:47] Los números. Cincuenta y dos días, una persona dirigiendo agentes, setecientos catorce commits y ciento setenta y tres pull requests. Me adelanto: los trescientos dieciocho mil son líneas versionadas e incluyen tests y documentación. El dato que importa es que hay cuatrocientos noventa y un ficheros de test para quinientos dos de código. Y el tamaño de cada pull request está calibrado por lo que yo podía revisar, no por lo que un agente podía escribir."
  );
  title(s, "Resultados", "52 días · una persona dirigiendo agentes · en los huecos");

  const kpis = [
    ["714", "commits"],
    ["173", "pull requests"],
    ["318.732", "líneas versionadas: código, tests y 337 documentos"],
    ["491 / 502", "ficheros de test / de código"],
  ];
  const kw = (W - 2 * M - 3 * 0.28) / 4, kgap = 0.28;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + kgap);
    card(s, x, 2.05, kw, 1.55);
    s.addText(k[0], { x: x + 0.2, y: 2.2, w: kw - 0.4, h: 0.8, align: "center", fontFace: TITLE_FONT, fontSize: 34, bold: true, color: ACCENT, margin: 0 });
    s.addText(k[1], { x: x + 0.2, y: 3.02, w: kw - 0.4, h: 0.4, align: "center", fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0 });
  });

  card(s, M, 3.85, 7.6, 2.7);
  s.addChart(
    pres.ChartType.bar,
    [{ name: "Commits", labels: ["S25", "S26", "S27", "S28", "S29", "S30", "S31", "S32"], values: [39, 130, 104, 66, 41, 182, 71, 70] }],
    {
      x: M + 0.15, y: 3.95, w: 7.3, h: 2.5,
      barDir: "col",
      chartColors: [ACCENT],
      showTitle: true, title: "Commits por semana (S25–S32; S33 parcial: 11)", titleColor: FG, titleFontFace: TITLE_FONT, titleFontSize: 13,
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: MUTED, dataLabelFontSize: 11, dataLabelFontFace: BODY_FONT,
      showLegend: false,
      catAxisLabelColor: MUTED, catAxisLabelFontSize: 11, catAxisLabelFontFace: BODY_FONT,
      valAxisLabelColor: MUTED, valAxisLabelFontSize: 10, valAxisHidden: true, valAxisMaxVal: 200,
      valGridLine: { style: "none" },
      catGridLine: { style: "none" },
      plotArea: { fill: { color: SURFACE } },
      chartArea: { fill: { color: SURFACE } },
    }
  );

  card(s, 8.6, 3.85, 3.95, 2.7, SURFACE2);
  s.addText("40 %", { x: 8.9, y: 4.15, w: 3.4, h: 0.85, fontFace: TITLE_FONT, fontSize: 42, bold: true, color: ACCENT, margin: 0 });
  s.addText("de los commits caen en sábado o domingo. El viernes es el día más flojo.", {
    x: 8.9, y: 5.05, w: 3.4, h: 1.2, fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 15 — Siguientes pasos
// =====================================================================
{
  const s = base(
    "[7:47–8:15] Qué falta, empezando por lo mayor: esto no lo ha usado nadie, y ningún profesional sanitario ha revisado el catálogo de sustituciones. Está verificado, no validado. Falta una métrica de calidad del plan generado, que es la pregunta abierta más importante: tengo una arquitectura que permite cambiar de modelo con un clic y ninguna forma de saber si el cambio mejora el producto. Y falta el coste por usuario y el encaje legal de los datos de salud."
  );
  title(s, "Qué falta", "Lo que separa un trabajo terminado de un producto lanzable");

  const next = [
    ["Cero usuarios, cero validación clínica", "Nadie lo ha usado y ningún profesional sanitario ha revisado el catálogo de sustituciones. Está verificado, no validado.", WARN],
    ["Calidad del plan generado", "No hay forma de saber si cambiar de modelo mejora el producto. Es la pregunta abierta más importante.", WARN],
    ["Coste por usuario y marco legal", "Falta agregar el coste por tenant, y el encaje del RGPD para datos de salud. Y falta el correo transaccional.", WARN],
  ];
  let y = 2.05;
  next.forEach((n, i) => {
    card(s, M, y, W - 2 * M, 1.25);
    pill(s, M + 0.35, y + 0.32, 0.6, String(i + 1));
    s.addText(n[0], { x: M + 1.3, y: y + 0.24, w: 5.6, h: 0.42, fontFace: TITLE_FONT, fontSize: 17, bold: true, color: n[2], margin: 0 });
    s.addText(n[1], { x: M + 1.3, y: y + 0.68, w: 10.2, h: 0.5, fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0 });
    y += 1.42;
  });

  s.addText("Y cerrar la facturación por asiento y la administración multisede para que el nivel Gimnasio sea vendible.", {
    x: M, y: 6.55, w: 11.5, h: 0.45,
    fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 16 — Cierre
// =====================================================================
{
  const s = base(
    "[8:15–8:45] Vuelvo al principio. La persona con la hernia lumbar que abría esta presentación hoy tiene un plan que la tiene en cuenta, y construirlo ha costado cincuenta y dos días de una sola persona. La conclusión de fondo es esta: cuando escribir código deja de ser lo caro, lo caro pasa a ser saber qué pedir y comprobar que lo que llega es correcto. El método no consiste en que la inteligencia artificial decida, sino en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor. Gracias por su atención."
  );
  s.addShape(pres.ShapeType.ellipse, {
    x: -2.2, y: 3.4, w: 6.4, h: 6.4, fill: { color: SURFACE }, line: { color: SURFACE, width: 0 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: -0.6, y: 5.0, w: 2.6, h: 2.6, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });

  s.addText("El cuello de botella ya no es escribir.", {
    x: 3.4, y: 2.1, w: 9.2, h: 0.9,
    fontFace: TITLE_FONT, fontSize: 34, bold: true, color: FG, margin: 0,
  });
  s.addText("Es decidir y verificar.", {
    x: 3.4, y: 3.0, w: 9.2, h: 0.9,
    fontFace: TITLE_FONT, fontSize: 34, bold: true, color: ACCENT, margin: 0,
  });
  s.addText("El método no consiste en que la IA decida, sino en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor.", {
    x: 3.4, y: 4.15, w: 9.0, h: 1.1,
    fontFace: BODY_FONT, fontSize: 16, color: MUTED, margin: 0,
  });
  s.addText("kInorA   ·   Aitor Ruiz de Samaniego   ·   Gracias por su atención", {
    x: 5.0, y: 6.05, w: 7.4, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, color: FG, margin: 0,
  });
  s.addText("Orquestación de agentes: gentle-ai, de Alan Buscaglia (MIT).   ·   Recursos del catálogo: Gym visual.   ·   Créditos completos en docs/credits.md", {
    x: 5.0, y: 6.5, w: 7.4, h: 0.5,
    fontFace: BODY_FONT, fontSize: 10.5, color: MUTED, margin: 0,
  });
}

pres.writeFile({ fileName: "/home/claude/deck/kinora-defensa.pptx" }).then(() => {
  console.log("Deck escrito");
});
