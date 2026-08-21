const pptxgen = require("pptxgenjs");
const path = require("node:path");

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

const TITLE_FONT = "Arial";
const BODY_FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Aitor Ruiz de Samaniego";
pres.title = "kInorA — Producto";

const W = 13.3, H = 7.5;
const M = 0.75;
const SCREENS = path.join(__dirname, "screens");

const SECTIONS = [
  null, "Problema", "Problema", "Producto", "Producto", "Producto", "Producto",
  "Producto", "Producto", "Producto", "Producto", "Producto", "Producto", "Estado actual", null,
];
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

function card(s, x, y, w, h, fill) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.14,
    fill: { color: fill || SURFACE },
    line: { color: BORDER, width: 1 },
  });
}

function pill(s, x, y, d, txt) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: d, h: d, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  s.addText(txt, {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT_FG, margin: 0,
  });
}

// Encuadra una captura (aspect = ancho/alto) dentro de un marco de altura fija,
// centrada en [x, y, w], con una etiqueta "referencia de diseño" opcional debajo.
function shot(s, file, aspect, x, y, w, targetH, label) {
  const imgW = targetH * aspect;
  const imgX = x + (w - imgW) / 2;
  const padding = 0.1;
  card(s, imgX - padding, y - padding, imgW + 2 * padding, targetH + 2 * padding, SURFACE2);
  s.addImage({ path: path.join(SCREENS, file), x: imgX, y, w: imgW, h: targetH });
  if (label) {
    s.addText(label, {
      x, y: y + targetH + 0.16, w, h: 0.3, align: "center",
      fontFace: BODY_FONT, fontSize: 10, italic: true, color: MUTED, margin: 0,
    });
  }
}

// =====================================================================
// 1 — Portada
// =====================================================================
{
  const s = base(
    "Soy Aitor Ruiz de Samaniego y esto es kInorA: qué problema resuelve, qué hace y para quién. La parte de cómo está construido y cómo se construyó vive en una presentación aparte, para poder darle a cada una el tiempo que merece."
  );
  s.addShape(pres.ShapeType.ellipse, {
    x: 9.4, y: -1.6, w: 6.2, h: 6.2, fill: { color: SURFACE }, line: { color: SURFACE, width: 0 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: 10.9, y: -0.1, w: 3.2, h: 3.2, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });
  s.addText("kInorA", {
    x: M, y: 2.2, w: 8.5, h: 1.3,
    fontFace: TITLE_FONT, fontSize: 66, bold: true, color: FG, margin: 0,
  });
  s.addText("Entrenamiento personalizado con inteligencia artificial", {
    x: M, y: 3.45, w: 8.5, h: 0.6,
    fontFace: BODY_FONT, fontSize: 20, color: ACCENT, margin: 0,
  });
  s.addText("Planes que se adaptan al cuerpo real: objetivos, material y lesiones.", {
    x: M, y: 4.05, w: 8.0, h: 0.5,
    fontFace: BODY_FONT, fontSize: 15, color: MUTED, margin: 0,
  });
  card(s, M, 4.85, 8.3, 0.6, SURFACE2);
  s.addText("Parte 1 de 2 — Producto. La parte técnica (arquitectura, método, resultados) es una presentación separada.", {
    x: M + 0.3, y: 4.85, w: 7.7, h: 0.6, valign: "middle",
    fontFace: BODY_FONT, fontSize: 12.5, color: FG, margin: 0,
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
    "El problema no es que falte información sobre entrenamiento: sobra. El problema es el abandono. La mitad de las altas de gimnasio se dan de baja en seis meses. Solo el veintitrés por ciento de los socios estadounidenses usó entrenador personal en 2024, y no es raro: en Barcelona una sesión cuesta entre cuarenta y setenta euros. Y mil setecientos diez millones de personas conviven con alguna afección musculoesquelética. Quien más necesita un plan adaptado es quien menos puede pagarlo."
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
    "El segmento está poblado, así que conviene ser honesto. Por debajo hay aplicaciones baratas que ajustan volumen y material, como Fitbod o Freeletics. SensAI ya usa un modelo de lenguaje, pero para regular la carga según sueño y fatiga, no para adaptar el ejercicio a una lesión. Y por encima están los servicios con entrenador humano, a doscientos dólares al mes. Ninguno de los cinco documenta la adaptación a limitaciones físicas declaradas como capacidad de primer orden. Ese es el hueco."
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
    "kInorA genera y adapta planes al cuerpo real de cada persona. Cuatro capacidades lo definen: adaptación a lesiones, dos modos de definir el plan, memoria persistente que se puede ver y borrar, y entrenamiento offline. Y existe en tres niveles: una persona sola, un entrenador con sus clientes, y un gimnasio con su marca. Lo que viene ahora es enseñar cada una de esas piezas tal y como se ven en la aplicación."
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
// 5 — Definir el plan (con capturas)
// =====================================================================
{
  const s = base(
    "Definir un plan tiene dos caminos. El asistente de tarjetas son seis pasos —objetivo, lugar, días, duración, material, limitaciones— dos minutos si uno sabe lo que quiere. El lugar va antes que el material, porque entrenar en casa o en un gimnasio cambia lo que tiene sentido ofrecer. El asistente conversacional es mejor cuando la situación tiene matices que ningún formulario recoge, que es el caso de quien arrastra una lesión: aquí lo extrae mientras hablas con el entrenador de kInorA, y en el móvil es una conversación por voz."
  );
  title(s, "Definir el plan", "Dos caminos hacia la misma estructura de datos");

  card(s, M, 1.95, 5.85, 4.55);
  s.addText("Asistente por tarjetas", { x: M + 0.4, y: 2.15, w: 5.05, h: 0.4, fontFace: TITLE_FONT, fontSize: 18, bold: true, color: ACCENT, margin: 0 });
  shot(s, "mobile-create-plan.png", 780 / 1848, M + 0.4, 2.62, 5.05, 3.6, "Móvil — paso a paso en tarjetas");

  card(s, M + 6.35, 1.95, 5.85, 4.55);
  s.addText("Asistente conversacional", { x: M + 6.75, y: 2.15, w: 5.05, h: 0.4, fontFace: TITLE_FONT, fontSize: 18, bold: true, color: ACCENT, margin: 0 });
  shot(s, "web-create-plan.png", 2880 / 1920, M + 6.75, 2.62, 5.05, 3.37, "Web — la misma especificación, en conversación");

  card(s, M, 6.65, W - 2 * M, 0.6, SURFACE2);
  s.addText("Los dos caminos producen la misma especificación de plan. Cambiar de modo a mitad no cuesta nada.", {
    x: M + 0.35, y: 6.65, w: W - 2 * M - 0.7, h: 0.6, valign: "middle",
    fontFace: BODY_FONT, fontSize: 13.5, color: FG, margin: 0,
  });
}

// =====================================================================
// 6 — El plan adaptado (con captura de sustitución)
// =====================================================================
{
  const s = base(
    "Este es el resultado. La persona declara una hernia lumbar. Lo que hace la sustitución no es el modelo: es un filtro determinista sobre la matriz de carga por zona corporal del catálogo. Donde un plan genérico pondría peso muerto con barra, con carga axial alta sobre la columna, kInorA propone hip thrust con mancuerna: mismo objetivo de cadera, menos carga axial. Y avisa de que lo ha hecho, con el motivo, y ofrece alternativas. Quiero decirlo con claridad: es una sustitución razonada sobre criterio biomecánico documentado, no una indicación clínica, y todavía no la ha revisado un profesional sanitario."
  );
  title(s, "El plan adaptado", "No quita el ejercicio: lo cambia por otro que persigue el mismo objetivo con menos carga sobre la zona comprometida");

  card(s, M, 2.0, 6.9, 1.6, SURFACE2);
  s.addText("Lo que pondría un plan genérico", { x: M + 0.4, y: 2.15, w: 4.9, h: 0.32, fontFace: BODY_FONT, fontSize: 11.5, color: MUTED, margin: 0 });
  s.addText("Peso muerto con barra", { x: M + 0.4, y: 2.47, w: 4.9, h: 0.5, fontFace: TITLE_FONT, fontSize: 20, bold: true, color: MUTED, margin: 0 });
  s.addText("Carga axial alta sobre la columna", { x: M + 0.4, y: 2.98, w: 4.9, h: 0.4, fontFace: BODY_FONT, fontSize: 12, color: WARN, margin: 0 });
  s.addText("↓", { x: M + 0.4, y: 3.3, w: 1.0, h: 0.3, fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT, margin: 0 });
  s.addText("Lo que pone kInorA — Hip thrust con mancuerna", { x: M + 1.3, y: 3.32, w: 5.2, h: 0.3, fontFace: TITLE_FONT, fontSize: 13, bold: true, color: ACCENT, margin: 0 });

  card(s, M, 3.85, 6.9, 2.65, SURFACE2);
  s.addText("En la app", { x: M + 0.4, y: 4.05, w: 1.5, h: 0.3, fontFace: BODY_FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
  s.addText("«Se han ajustado 3 ejercicios por la limitación que has declarado.»", {
    x: M + 0.4, y: 4.35, w: 6.1, h: 0.7, fontFace: BODY_FONT, fontSize: 15, color: FG, margin: 0,
  });
  s.addText("Sugerencias, nunca diagnóstico ni bloqueo clínico. La matriz de carga por zona corporal aún no ha sido revisada por un profesional sanitario: es el primer paso pendiente.", {
    x: M + 0.4, y: 5.15, w: 6.1, h: 1.2, fontFace: BODY_FONT, fontSize: 12.5, italic: true, color: MUTED, margin: 0,
  });

  shot(s, "mobile-exercise.png", 780 / 2234, M + 7.35, 1.95, 4.35, 4.55, "Móvil — detalle del ejercicio y «Ver alternativas»");
}

// =====================================================================
// 7 — Panel de hoy (con captura del dashboard)
// =====================================================================
{
  const s = base(
    "Este es el panel del día a día. En un vistazo: la sesión de hoy con sus ejercicios y el peso sugerido, la racha de días consecutivos, el objetivo semanal cumplido, y el volumen total entrenado. A la derecha, el check-in semanal y una gráfica de progreso que usa datos reales de las sesiones registradas, no una proyección."
  );
  title(s, "Panel de hoy", "Todo lo que hace falta saber, sin entrar en ningún menú");

  shot(s, "web-dashboard.png", 2880 / 1920, M, 1.95, 7.5, 5.0, null);

  card(s, M + 7.9, 1.95, 3.9, 2.3);
  s.addText("Racha y objetivo", { x: M + 8.25, y: 2.15, w: 3.2, h: 0.4, fontFace: TITLE_FONT, fontSize: 15, bold: true, color: ACCENT, margin: 0 });
  s.addText("Días consecutivos entrenados y sesiones cumplidas esta semana frente al objetivo, siempre visibles arriba del todo.", {
    x: M + 8.25, y: 2.6, w: 3.2, h: 1.5, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0,
  });

  card(s, M + 7.9, 4.45, 3.9, 2.5, SURFACE2);
  s.addText("Sugerencia de la IA", { x: M + 8.25, y: 4.65, w: 3.2, h: 0.4, fontFace: TITLE_FONT, fontSize: 15, bold: true, color: ACCENT, margin: 0 });
  s.addText("Cuando el historial lo justifica, el panel propone el siguiente paso de carga. La persona lo confirma; el sistema no lo aplica solo.", {
    x: M + 8.25, y: 5.1, w: 3.2, h: 1.7, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0,
  });
}

// =====================================================================
// 8 — Plan semanal y adherencia (con captura)
// =====================================================================
{
  const s = base(
    "La vista semanal muestra el plan completo: qué toca cada día, cuánto se ha cumplido y cuánto queda. El volumen objetivo, los días de descanso y la duración total están calculados a partir de las sesiones reales, no de una plantilla fija. Y cada sesión, al entrar, muestra el detalle exacto de series, repeticiones y peso sugerido por ejercicio."
  );
  title(s, "El plan, semana a semana", "Sesiones, adherencia y volumen, siempre a la vista");

  shot(s, "web-plan.png", 2880 / 1920, M, 1.95, W - 2 * M, 4.85, "Web — vista semanal con detalle de la sesión de hoy");
}

// =====================================================================
// 9 — Entrenar en el gimnasio (con captura del tracker)
// =====================================================================
{
  const s = base(
    "Entrenar y medir. Anotar las series tiene tres estados —por debajo, cumplido, por encima— y funciona offline: se guarda en el móvil y se sincroniza al recuperar la conexión. Con esos datos el sistema calcula adherencia, volumen y récords, y propone ajustes que la persona confirma."
  );
  title(s, "Entrenar en el gimnasio", "El móvil como cuaderno de entrenamiento, con o sin cobertura");

  shot(s, "mobile-tracker.png", 780 / 1688, M, 1.95, 3.7, 4.85, "Móvil — sesión activa, serie a serie");

  const items = [
    ["Registro serie a serie", "Carga y repeticiones ajustables al momento; una serie se marca completada con un toque."],
    ["Funciona sin cobertura", "Se guarda en el móvil y se sincroniza solo al recuperar la conexión. En el gimnasio casi nunca hay señal."],
    ["Progreso automático", "Adherencia, volumen semanal, racha y récords personales por ejercicio, sin ningún cálculo manual."],
  ];
  let y = 1.95;
  items.forEach((it) => {
    card(s, M + 4.15, y, 7.4, 1.5);
    s.addText(it[0], { x: M + 4.5, y: y + 0.2, w: 6.8, h: 0.4, fontFace: TITLE_FONT, fontSize: 16, bold: true, color: ACCENT, margin: 0 });
    s.addText(it[1], { x: M + 4.5, y: y + 0.62, w: 6.8, h: 0.8, fontFace: BODY_FONT, fontSize: 12.5, color: MUTED, valign: "top", margin: 0 });
    y += 1.65;
  });
}

// =====================================================================
// 10 — Asistente por voz (con captura)
// =====================================================================
{
  const s = base(
    "Durante el entreno, hablar es más rápido que tocar. «Sube el peso del press a cuarenta kilos» actualiza la sesión de hoy al momento, y el asistente confirma el cambio y puede preguntar si hay que ajustar también las repeticiones. La misma voz que ayuda a definir el plan al principio, ayuda a ajustarlo mientras se entrena."
  );
  title(s, "Asistente por voz", "Ajustar el entreno hablando, sin soltar la barra");

  shot(s, "mobile-voice.png", 780 / 1688, M, 1.95, 3.7, 4.85, "Móvil — conversación durante la sesión");

  card(s, M + 4.15, 1.95, 7.4, 2.15);
  s.addText("«Sube el peso del press a 40 kilos»", { x: M + 4.5, y: 2.15, w: 6.8, h: 0.5, fontFace: TITLE_FONT, fontSize: 16, bold: true, italic: true, color: FG, margin: 0 });
  s.addText("El sistema entiende la instrucción, actualiza la serie de hoy y confirma el cambio antes de seguir.", {
    x: M + 4.5, y: 2.75, w: 6.8, h: 1.2, fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0,
  });

  card(s, M + 4.15, 4.35, 7.4, 2.55, SURFACE2);
  s.addText("La misma vía, dos momentos", { x: M + 4.5, y: 4.55, w: 6.8, h: 0.4, fontFace: TITLE_FONT, fontSize: 15, bold: true, color: ACCENT, margin: 0 });
  s.addText("Al crear el plan, la voz sirve para contar matices que un formulario no recoge. Durante el entreno, sirve para ajustar sin soltar el móvil ni la barra. Es la misma capacidad conversacional en dos puntos distintos del recorrido.", {
    x: M + 4.5, y: 5.0, w: 6.8, h: 1.7, fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0,
  });
}

// =====================================================================
// 11 — Entrenador y Gimnasio
// =====================================================================
{
  const s = base(
    "Las mismas cuatro capacidades escalan a dos niveles más. El nivel Entrenador deja gestionar una cartera de clientes: se les invita, se crean y poseen planes en su nombre, y hay un panel de progreso por cliente con tendencia de esfuerzo percibido, cumplimiento y últimas sesiones. El cliente sigue siendo dueño de sus datos; el entrenador actúa sobre ellos, no los posee, y eso está resuelto a nivel de autorización, no solo de interfaz. El nivel Gimnasio añade marca blanca en subdominio propio, con logo y paleta reflejados desde el login. Y, con la misma honestidad de siempre, cuento también lo que está diseñado pero no implementado: la facturación por asiento y la administración multisede."
  );
  title(s, "Entrenador y Gimnasio", "Las mismas cuatro capacidades, con más alcance");

  card(s, M, 2.05, 5.85, 4.55);
  s.addText("Entrenador", { x: M + 0.4, y: 2.25, w: 5.05, h: 0.4, fontFace: TITLE_FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0 });
  s.addText(
    [
      { text: "Invita clientes y crea planes en su nombre dentro de su propio tenant", options: { bullet: true, breakLine: true } },
      { text: "Panel de progreso por cliente: tendencia de RPE, cumplimiento, últimas sesiones", options: { bullet: true, breakLine: true } },
      { text: "Planes con marca propia — nombre, título y color de acento — en web y móvil", options: { bullet: true, breakLine: true } },
      { text: "El cliente conserva la propiedad de sus datos; el entrenador actúa, no posee", options: { bullet: true } },
    ],
    { x: M + 0.4, y: 2.75, w: 5.1, h: 2.3, fontFace: BODY_FONT, fontSize: 13, color: FG, paraSpaceAfter: 10, margin: 0 }
  );
  card(s, M + 0.4, 5.2, 5.1, 1.2, SURFACE2);
  s.addText("En producción", { x: M + 0.65, y: 5.35, w: 4.6, h: 0.3, fontFace: BODY_FONT, fontSize: 10.5, bold: true, color: ACCENT, margin: 0 });
  s.addText("Alta de clientes, planes de marca y panel de progreso ya están implementados y probados.", {
    x: M + 0.65, y: 5.62, w: 4.6, h: 0.7, fontFace: BODY_FONT, fontSize: 11.5, color: MUTED, margin: 0,
  });

  card(s, M + 6.35, 2.05, 5.85, 4.55);
  s.addText("Gimnasio", { x: M + 6.75, y: 2.25, w: 5.05, h: 0.4, fontFace: TITLE_FONT, fontSize: 19, bold: true, color: ACCENT, margin: 0 });
  s.addText(
    [
      { text: "Marca blanca en subdominio propio: logo y paleta desde el login y en toda la app", options: { bullet: true, breakLine: true } },
      { text: "El nivel se concede y revoca de forma auditada por un superadministrador", options: { bullet: true, breakLine: true } },
      { text: "Facturación por asiento — diseñada, sin implementar: hoy es tarifa plana", options: { bullet: true, breakLine: true } },
      { text: "Administración multisede — especificada, no iniciada", options: { bullet: true } },
    ],
    { x: M + 6.75, y: 2.75, w: 5.1, h: 2.3, fontFace: BODY_FONT, fontSize: 13, color: FG, paraSpaceAfter: 10, margin: 0 }
  );
  card(s, M + 6.75, 5.2, 5.1, 1.2, SURFACE2);
  s.addText("Estado mixto, dicho sin adornos", { x: M + 7.0, y: 5.35, w: 4.6, h: 0.3, fontFace: BODY_FONT, fontSize: 10.5, bold: true, color: WARN, margin: 0 });
  s.addText("La marca blanca funciona hoy. El asiento por cliente y la vista multisede son la diferencia entre una capacidad técnica y un nivel vendible.", {
    x: M + 7.0, y: 5.62, w: 4.6, h: 0.7, fontFace: BODY_FONT, fontSize: 11.5, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 12 — IA gobernada, no una caja negra
// =====================================================================
{
  const s = base(
    "Un punto de gobierno, porque cambiar de modelo de IA con un clic solo da confianza si además se puede vigilar. Los prompts no viven en el código: residen en Langfuse, versionados, y si el gestor falla el sistema cae a la plantilla compilada y sigue generando. Cada llamada al modelo queda trazada con su proveedor, sus tokens y su latencia, lo que da la base para conocer el coste real de cada plan. Lo que todavía no existe es la métrica que diga si esa llamada produjo un buen plan: se puede ver cuánto cuesta y cuánto tarda, no si vale la pena. Es la pregunta abierta más importante del proyecto, y la cuento aquí en lugar de esconderla."
  );
  title(s, "IA gobernada, no una caja negra", "Los prompts viven en Langfuse; el coste se traza, el rendimiento aún no tiene métrica");

  const blocks = [
    ["Los prompts no viven en el código", "Versionados y editables en Langfuse, fuera del despliegue. Si el gestor falla o la plantilla no valida, el sistema cae a la versión compilada y sigue generando."],
    ["Cada llamada queda trazada", "Proveedor, modelo, tokens y latencia de cada generación. Es la base para conocer el coste real de cada plan, no una estimación."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, gx = 0.5;
  blocks.forEach((b, i) => {
    const x = M + i * (cw + gx);
    card(s, x, 2.1, cw, 2.0);
    s.addText(b[0], { x: x + 0.35, y: 2.35, w: cw - 0.7, h: 0.55, fontFace: TITLE_FONT, fontSize: 16.5, bold: true, color: ACCENT, margin: 0 });
    s.addText(b[1], { x: x + 0.35, y: 2.9, w: cw - 0.7, h: 1.1, fontFace: BODY_FONT, fontSize: 13, color: MUTED, valign: "top", margin: 0 });
  });

  card(s, M, 4.4, W - 2 * M, 2.1, SURFACE2);
  s.addText("Lo que falta: la métrica de rendimiento", { x: M + 0.4, y: 4.6, w: 11, h: 0.45, fontFace: TITLE_FONT, fontSize: 18, bold: true, color: WARN, margin: 0 });
  s.addText("Se puede ver cuánto cuesta y cuánto tarda cada llamada al modelo. Lo que no existe todavía es una métrica de si el plan que produce esa llamada es mejor o peor que otro. Es la misma brecha en la que se apoya cada decisión de proveedor hoy: se cambia por coste y latencia, no por calidad, porque la calidad no se mide.", {
    x: M + 0.4, y: 5.15, w: W - 2 * M - 0.8, h: 1.25, fontFace: BODY_FONT, fontSize: 13.5, color: FG, valign: "top", margin: 0,
  });

  s.addText("Gestión de prompts y trazas: Langfuse, incorporado en el cambio 16e.", {
    x: M, y: 6.75, w: 11.5, h: 0.35,
    fontFace: BODY_FONT, fontSize: 11, italic: true, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 13 — No fabricar datos
// =====================================================================
{
  const s = base(
    "Si me quedo con una sola decisión de producto, es esta: el sistema no inventa datos. Días numerados, no lunes, porque el modelo no conoce el calendario. Lo que no se puede calcular se deja vacío. Y una sesión olvidada nunca se marca como completada. Prefiero un hueco a un número inventado."
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
// 14 — Qué falta
// =====================================================================
{
  const s = base(
    "Qué falta, con la misma honestidad con la que se ha contado el resto. Esto no lo ha usado nadie todavía, y ningún profesional sanitario ha revisado el catálogo de sustituciones: está verificado, no validado. Tampoco existe hoy una métrica de calidad del plan generado, ni el coste por usuario, ni el correo transaccional que hace falta para lanzar de verdad."
  );
  title(s, "Qué falta", "Lo que separa un trabajo terminado de un producto lanzable");

  const next = [
    ["Cero usuarios, cero validación clínica", "Nadie lo ha usado y ningún profesional sanitario ha revisado el catálogo de sustituciones. Está verificado, no validado.", WARN],
    ["Calidad del plan generado", "No hay forma de saber si cambiar de modelo mejora el producto. Es la pregunta abierta más importante.", WARN],
    ["Coste por usuario, correo y marco legal", "Falta agregar el coste por tenant, el correo transaccional para lanzar de verdad, y el encaje del RGPD para datos de salud.", WARN],
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
// 15 — Cierre
// =====================================================================
{
  const s = base(
    "Vuelvo al principio. La persona con la hernia lumbar que abría esta presentación hoy tiene un plan que la tiene en cuenta. Esto es lo que hace kInorA y para quién lo hace. Cómo está construido, y cómo se construyó en cincuenta y dos días, es la segunda parte de esta entrega."
  );
  s.addShape(pres.ShapeType.ellipse, {
    x: -2.2, y: 3.4, w: 6.4, h: 6.4, fill: { color: SURFACE }, line: { color: SURFACE, width: 0 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: -0.6, y: 5.0, w: 2.6, h: 2.6, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 },
  });

  s.addText("Un plan que tiene en cuenta el cuerpo real.", {
    x: 3.4, y: 2.3, w: 9.2, h: 0.9,
    fontFace: TITLE_FONT, fontSize: 32, bold: true, color: FG, margin: 0,
  });
  s.addText("Eso es kInorA.", {
    x: 3.4, y: 3.15, w: 9.2, h: 0.9,
    fontFace: TITLE_FONT, fontSize: 32, bold: true, color: ACCENT, margin: 0,
  });
  s.addText("La parte técnica —arquitectura, método de construcción con agentes, resultados y siguientes pasos de ingeniería— sigue en la segunda presentación.", {
    x: 3.4, y: 4.25, w: 9.0, h: 1.1,
    fontFace: BODY_FONT, fontSize: 15, color: MUTED, margin: 0,
  });
  s.addText("kInorA   ·   Aitor Ruiz de Samaniego   ·   Gracias por su atención", {
    x: 5.0, y: 6.05, w: 7.4, h: 0.4,
    fontFace: BODY_FONT, fontSize: 14, color: FG, margin: 0,
  });
  s.addText("Capturas: referencia de diseño (Open Design) bajo docs/open-design/kinora.   ·   Créditos completos en docs/credits.md", {
    x: 5.0, y: 6.5, w: 7.4, h: 0.5,
    fontFace: BODY_FONT, fontSize: 10.5, color: MUTED, margin: 0,
  });
}

const OUT_FILE = path.join(__dirname, "kinora-producto.pptx");
pres.writeFile({ fileName: OUT_FILE }).then(() => {
  console.log(`Deck escrito: ${OUT_FILE}`);
});
