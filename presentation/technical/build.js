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
const INFO = "6BA8E8";

const TITLE_FONT = "Arial";
const BODY_FONT = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Aitor Ruiz de Samaniego";
pres.title = "kInorA — Cómo se construyó";

const W = 13.3, H = 7.5;
const M = 0.75;

const SECTIONS = [
  null, "Contexto", "Cómo está construido", "Cómo está construido",
  "Método", "Método", "Resultados", "Roadmap",
  "Retrospectiva", "Retrospectiva", "Estado actual", null,
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

// =====================================================================
// 1 — Portada
// =====================================================================
{
  const s = base(
    "Soy Aitor Ruiz de Samaniego. Esta es la segunda parte de la entrega de kInorA: no qué hace el producto, sino cómo está construido y cómo se construyó. La parte de producto, con capturas de la aplicación, es una presentación aparte."
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
  s.addText("Cómo está construido, y cómo se construyó", {
    x: M, y: 3.45, w: 8.5, h: 0.6,
    fontFace: BODY_FONT, fontSize: 20, color: ACCENT, margin: 0,
  });
  s.addText("Arquitectura, capa de IA, método de trabajo con agentes y resultados de 52 días.", {
    x: M, y: 4.05, w: 8.6, h: 0.5,
    fontFace: BODY_FONT, fontSize: 15, color: MUTED, margin: 0,
  });
  card(s, M, 4.85, 8.3, 0.6, SURFACE2);
  s.addText("Parte 2 de 2 — Técnica. La parte de producto, con capturas de la app, es una presentación separada.", {
    x: M + 0.3, y: 4.85, w: 7.7, h: 0.6, valign: "middle",
    fontFace: BODY_FONT, fontSize: 12.5, color: FG, margin: 0,
  });
  s.addText("Aitor Ruiz de Samaniego   ·   Trabajo de Fin de Máster   ·   2026", {
    x: M, y: 6.4, w: 9, h: 0.4,
    fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 2 — Por qué contamos el método
// =====================================================================
{
  const s = base(
    "Por qué cuento cómo está hecho, y no solo qué hace. En una categoría donde el modelo de IA que uso hoy será peor y más caro dentro de seis meses, la ventaja no está en la funcionalidad: está en la velocidad de cambiarla. Cuarenta y dos cambios cerrados en cincuenta y dos días. Cambiar de proveedor de IA es un clic, y adelanto la objeción: hoy ese clic es barato y ciego a la calidad, y a eso vuelvo hacia el final."
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
// 3 — Arquitectura
// =====================================================================
{
  const s = base(
    "Por debajo hay un monorepo con arquitectura limpia: web, móvil, API y PostgreSQL con pgvector. Las fronteras entre capas no son una recomendación: son nueve reglas que hacen fallar la compilación si se violan, y hay un test que comprueba que esas reglas fallan cuando deben fallar."
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
// 4 — La capa de IA
// =====================================================================
{
  const s = base(
    "La capa de IA es la parte más difícil. Ningún proveedor está soldado al código: cinco adaptadores de generación conmutables, y voz elegible por separado. Los prompts viven fuera del código, versionados; si el gestor falla, el sistema cae a la plantilla compilada y sigue generando. Y hay dos mecanismos distintos de enmascarado, porque una lesión y un peso no admiten el mismo trato: la lesión no llega al modelo, y el peso sí llega al modelo pero no queda en la traza."
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
// 5 — Cómo se construyó: el método
// =====================================================================
{
  const s = base(
    "El ciclo no lo inventé yo, lo adopté; lo mío es cómo lo goberné. Nada se escribió sin pasar por siete fases donde el código es la sexta, y cada una deja un artefacto versionado. Un solo cambio dejó dos mil novecientas nueve líneas de exploración, propuesta, diseño, tareas, verificación y cierre. Y la exploración descubrió cuatro cosas que el issue original daba por buenas y no lo eran."
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
// 6 — Agentes, guardas y revisión adversarial
// =====================================================================
{
  const s = base(
    "El volumen sale de delegar en agentes sobre un orquestador de terceros, gentle-ai, de Alan Buscaglia, que aporta las fases, la delegación y la revisión adversarial. Lo propio de este trabajo son el contrato de ciento cincuenta líneas que gobierna a los agentes, las siete comprobaciones automáticas y la calibración de la puerta de cobertura. Judgment Day encontró cuatro defectos en el trabajo offline que no rompían ninguna aserción: rompían garantías. Y lo digo porque es el contraejemplo de mi propia tesis: la guarda que no existe es la que decide qué se te escapa."
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
  s.addText("Cuatro veces una variable de entorno que el código lee y que Compose no reenvía llegó a producción con el valor por defecto. Ninguna de las siete lo detecta. Vuelvo sobre esto en la retrospectiva.", {
    x: M + 2.5, y: 5.0, w: 9.3, h: 1.05, valign: "middle", fontFace: BODY_FONT, fontSize: 13, color: FG, margin: 0,
  });

  s.addText("Cobertura de tests: 94,35 % de las funciones de la API con base de datos, 91,51 % sin ella.    ·    El orquestador (gentle-ai, de Alan Buscaglia, MIT) aporta las fases, la delegación y Judgment Day; el contrato, las siete comprobaciones y la calibración de la puerta son de este proyecto.", {
    x: M, y: 6.25, w: 11.6, h: 0.6, fontFace: BODY_FONT, fontSize: 11, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 7 — Resultados
// =====================================================================
{
  const s = base(
    "Los números. Cincuenta y dos días, una persona dirigiendo agentes, setecientos catorce commits y ciento setenta y tres pull requests. Me adelanto: los trescientos dieciocho mil son líneas versionadas e incluyen tests y documentación. El dato que importa es que hay cuatrocientos noventa y un ficheros de test para quinientos dos de código. Y el tamaño de cada pull request está calibrado por lo que yo podía revisar, no por lo que un agente podía escribir."
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
// 8 — Roadmap inicial (NUEVO)
// =====================================================================
{
  const s = base(
    "El roadmap real, tal y como quedó archivado en openspec. La v1 son las siete semanas de junio y julio: arquitectura, autenticación, el asistente de creación de plan, generación con IA y seguimiento offline. La v1.1 añade chat y voz conversacionales y adaptación por adherencia. Y aquí está lo que quiero señalar: v2, el nivel Entrenador, y v3, el nivel Gimnasio, no eran para después del máster. Se archivaron el treinta y uno de julio y el dos de agosto, dentro de la misma ventana de cincuenta y dos días."
  );
  title(s, "Roadmap inicial", "Lo que se archivó, fase a fase, en openspec/changes/archive");

  const phases = [
    ["v1 — Base", "20 jun – 21 jul", "Monorepo, contratos, esquema multi-tenant, CI/CD, TDD, auth, wizard, generación con IA, seguimiento offline, i18n."],
    ["v1.1 — Conversacional", "23 jul – 30 jul", "Chat y voz interactivos, adaptación por adherencia y por esfuerzo percibido (RPE)."],
    ["v2 — Entrenador", "31 jul – 1 ago", "Acceso y panel para el nivel Entrenador, con marca propia."],
    ["v3 — Gimnasios", "2 ago – 9 ago", "Marca blanca, aprovisionamiento por nivel, facturación por asiento, gestión de prompts con Langfuse, recuperación de sesión, perfil y gestión de planes."],
  ];
  const cw = (W - 2 * M - 3 * 0.3) / 4, gap = 0.3;
  phases.forEach((p, i) => {
    const x = M + i * (cw + gap);
    card(s, x, 2.1, cw, 3.55, i === 0 ? SURFACE2 : SURFACE);
    s.addText(p[0], { x: x + 0.24, y: 2.32, w: cw - 0.48, h: 0.5, fontFace: TITLE_FONT, fontSize: 15.5, bold: true, color: ACCENT, margin: 0 });
    s.addText(p[1], { x: x + 0.24, y: 2.82, w: cw - 0.48, h: 0.3, fontFace: BODY_FONT, fontSize: 11, color: MUTED, margin: 0 });
    s.addText(p[2], { x: x + 0.24, y: 3.2, w: cw - 0.48, h: 2.35, fontFace: BODY_FONT, fontSize: 11.5, color: FG, valign: "top", margin: 0 });
  });

  card(s, M, 5.9, W - 2 * M, 1.0, SURFACE2);
  s.addText("v2 y v3 no eran «después del máster»: se archivaron dentro de los mismos 52 días. La documentación tardó en admitirlo — vuelvo sobre esto en la siguiente diapositiva.", {
    x: M + 0.35, y: 5.9, w: W - 2 * M - 0.7, h: 1.0, valign: "middle",
    fontFace: BODY_FONT, fontSize: 13.5, color: FG, margin: 0,
  });
}

// =====================================================================
// 9 — Desviaciones del plan (NUEVO)
// =====================================================================
{
  const s = base(
    "El plan no se cumplió tal cual, y merece contarlo. La documentación iba por detrás de lo construido: el README seguía llamando «futuro» a v2 y v3 cuando ya estaban archivadas, y no mencionaba en absoluto la serie 17x, ya cerrada. El trabajo offline costó mucho más de lo previsto: parecía almacenamiento local y resultó ser un problema de sistemas distribuidos, con cuatro correcciones de revisión adversarial. Y una variable de entorno que el código lee y Compose no reenvía a producción se repitió cuatro veces con síntomas distintos, porque ninguna de las siete guardas la detecta."
  );
  title(s, "Desviaciones del plan", "Lo que no salió exactamente como estaba previsto");

  const items = [
    ["El roadmap iba por detrás de sí mismo", "El README llamaba «futuro» a v2 (Entrenador) y v3 (Gimnasios) cuando 15a, 15b, 16a, 16d y 16e ya estaban archivados, y no recogía la serie 17x en absoluto."],
    ["Offline costó más de lo previsto", "Parecía almacenamiento local y resultó ser sistemas distribuidos: requirió un cambio de endurecimiento propio y cuatro correcciones de Judgment Day."],
    ["La misma variable de entorno, cuatro veces", "Stripe, el proveedor de voz, Deepgram y el ajuste de voz de Gemini: cuatro incidentes con el mismo patrón, porque Compose ignora en silencio lo que no está en su bloque environment."],
    ["Dos rutas móviles conviviendo", "La app nativa con Expo y el envoltorio Capacitor sobre la web coexisten. La segunda es herencia de una estrategia anterior y hoy es ambigüedad sin resolver."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, ch = 1.72, gx = 0.5, gy = 0.32;
  items.forEach((it, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.1 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch);
    s.addText(it[0], { x: x + 0.32, y: y + 0.22, w: cw - 0.64, h: 0.55, fontFace: TITLE_FONT, fontSize: 14.5, bold: true, color: WARN, margin: 0 });
    s.addText(it[1], { x: x + 0.32, y: y + 0.72, w: cw - 0.64, h: 0.95, fontFace: BODY_FONT, fontSize: 12, color: MUTED, valign: "top", margin: 0 });
  });
}

// =====================================================================
// 10 — Lo que se haría distinto (NUEVO)
// =====================================================================
{
  const s = base(
    "Con esa experiencia, qué haría distinto. Instrumentar el coste desde el primer cambio, no desde el dieciséis: Langfuse llegó casi al final, cuando ya se habían tomado decisiones de proveedor sin ese dato. Definir antes la métrica de calidad del plan generado, que todavía no existe y es la pregunta más importante del proyecto. Elegir una sola ruta móvil. Y convertir en regla de contrato que añadir una variable de entorno son tres ediciones a la vez, no una — y mejor que escribir la regla, una guarda que la compruebe."
  );
  title(s, "Lo que se haría distinto", "Del capítulo de retrospectiva, sin suavizarlo");

  const items = [
    ["Instrumentar el coste desde el día uno", "Langfuse llegó en el cambio 16e, casi al final. Tener coste por generación desde el cambio 08 habría convertido la elección de proveedor en una decisión medida, no en una estimación."],
    ["Definir antes la métrica de calidad del plan", "Sigue sin existir. Hay una arquitectura que permite cambiar de modelo con un clic y ninguna forma de saber si el cambio mejora el producto."],
    ["Elegir una sola ruta móvil", "Expo y el envoltorio Capacitor coexisten sin una razón de negocio actual. Es deuda, no una decisión activa."],
    ["Una guarda para las variables de entorno", "La regla de las tres ediciones ya está escrita en AGENTS.md, pero llegó después del cuarto incidente. Debería haber sido una guarda automática desde la primera variable, no una norma que confiar a la memoria."],
  ];
  const cw = (W - 2 * M - 0.5) / 2, ch = 1.72, gx = 0.5, gy = 0.32;
  items.forEach((it, i) => {
    const x = M + (i % 2) * (cw + gx);
    const y = 2.1 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch, SURFACE2);
    s.addText(it[0], { x: x + 0.32, y: y + 0.22, w: cw - 0.64, h: 0.55, fontFace: TITLE_FONT, fontSize: 14.5, bold: true, color: ACCENT, margin: 0 });
    s.addText(it[1], { x: x + 0.32, y: y + 0.72, w: cw - 0.64, h: 0.95, fontFace: BODY_FONT, fontSize: 12, color: MUTED, valign: "top", margin: 0 });
  });
}

// =====================================================================
// 11 — Qué falta (técnico)
// =====================================================================
{
  const s = base(
    "Qué falta, en clave técnica. La métrica de calidad del plan generado es la brecha más importante. El coste por usuario no está instrumentado por tenant, así que cualquier precio hoy es una hipótesis. Y hay deuda identificada y priorizada, no escondida: normalización de nombres de ejercicio, clasificador de grupo muscular, y la variable de entorno que Compose todavía no reenvía correctamente."
  );
  title(s, "Qué falta", "Brechas técnicas priorizadas, no escondidas");

  const next = [
    ["Métrica de calidad del plan generado", "No existe hoy. Sin ella, la arquitectura multiproveedor es una capacidad que no se puede explotar con criterio.", WARN],
    ["Coste por usuario, no instrumentado", "Langfuse traza tokens y latencia por llamada; falta agregarlo por tenant y contrastarlo con el precio.", WARN],
    ["Deuda técnica identificada", "Normalización de nombres de ejercicio, clasificador de grupo muscular y una variable de estilo de voz que Compose aún interpola mal.", WARN],
  ];
  let y = 2.05;
  next.forEach((n, i) => {
    card(s, M, y, W - 2 * M, 1.25);
    pill(s, M + 0.35, y + 0.32, 0.6, String(i + 1));
    s.addText(n[0], { x: M + 1.3, y: y + 0.24, w: 5.8, h: 0.42, fontFace: TITLE_FONT, fontSize: 17, bold: true, color: n[2], margin: 0 });
    s.addText(n[1], { x: M + 1.3, y: y + 0.68, w: 10.0, h: 0.5, fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0 });
    y += 1.42;
  });

  s.addText("El capítulo de producto detalla, además, la falta de validación clínica y de usuarios reales.", {
    x: M, y: 6.55, w: 11.5, h: 0.45,
    fontFace: BODY_FONT, fontSize: 13, color: MUTED, margin: 0,
  });
}

// =====================================================================
// 12 — Cierre
// =====================================================================
{
  const s = base(
    "La conclusión de fondo es esta: cuando escribir código deja de ser lo caro, lo caro pasa a ser saber qué pedir y comprobar que lo que llega es correcto. El método no consiste en que la inteligencia artificial decida, sino en construir el andamiaje que permite a una persona decidir mucho más rápido sin decidir peor. Gracias por su atención."
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

const OUT_FILE = path.join(__dirname, "kinora-tecnica.pptx");
pres.writeFile({ fileName: OUT_FILE }).then(() => {
  console.log(`Deck escrito: ${OUT_FILE}`);
});
