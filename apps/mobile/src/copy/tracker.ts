/**
 * Centralized copy for the workout tracker screen.
 *
 * The mobile app has NO i18n layer today (the existing Login/SignUp/Home
 * screens hardcode English literals inline). Rather than scatter Spanish
 * string literals across the tracker components, all user-facing copy lives
 * here in one module. The strings are Spanish to match the authoritative
 * Open Design mockup (`screens/mobile-tracker.html`).
 *
 * FOLLOW-UP: introduce a real i18n layer (e.g. i18n-js / react-intl) for the
 * mobile app and route this copy (EN/ES) through it. Tracked as tech debt —
 * this module is the single seam where that migration will happen.
 */

export const trackerCopy = {
  /** Session header. */
  sessionActiveEyebrow: "Sesión activa",
  elapsedLabel: "Tiempo",
  pauseLabel: "Pausar sesión",
  resumeLabel: "Reanudar sesión",

  /** Progress. */
  progressLabel: (current: number, total: number) =>
    `Ejercicio ${current} de ${total}`,
  progressA11y: (current: number, total: number) =>
    `${current} de ${total} ejercicios`,

  /** Exercise card. */
  currentExerciseEyebrow: "Ejercicio actual",
  setInfo: (setNumber: number, setTotal: number, targetLabel: string) =>
    `Serie ${setNumber} de ${setTotal} · Objetivo: ${targetLabel}`,
  objectiveLabel: (weightKg: number, reps: string) =>
    `${weightKg} kg × ${reps} reps`,
  loadLabel: "Carga",
  loadUnit: "kg",
  repsLabel: "Reps",
  repsUnit: "reps",
  decreaseLoad: "Reducir carga 2.5 kg",
  increaseLoad: "Aumentar carga 2.5 kg",
  decreaseReps: "Reducir repetición",
  increaseReps: "Aumentar repetición",
  completeSet: "Completar serie",
  completeSetA11y: (setNumber: number) => `Completar serie ${setNumber}`,

  /** Rest timer. */
  restActive: "Descanso activo",
  restLabelSm: "descanso",
  addTime: "+15 s",
  addTimeA11y: "Agregar 15 segundos",
  skip: "Saltar",
  skipRest: "Saltar descanso",
  restA11y: "Temporizador de descanso",

  /** Next preview. */
  nextEyebrow: "A continuación",
  nextDetail: (sets: number, weightKg: number, reps: string) =>
    `${sets} series · ${weightKg} kg × ${reps} reps`,
  nextDetailNoWeight: (sets: number, reps: string) =>
    `${sets} series · ${reps} reps`,

  /** Finish. */
  finishSession: "Finalizar sesión",
  finishSessionA11y: "Finalizar sesión de entrenamiento",

  /** States. */
  loading: "Cargando sesión…",
  sessionCompleteTitle: "Sesión completada",
  sessionCompleteBody: "¡Buen trabajo! Registramos tu entrenamiento.",
  backHome: "Volver al inicio",

  /** Errors / conflict. */
  conflictWithScope: (planName: string, day: number) =>
    `Ya tenés una sesión activa en «${planName}» (Día ${day}). Terminala antes de empezar otra.`,
  conflictWithPlan: (planName: string) =>
    `Ya tenés una sesión activa en «${planName}». Terminala antes de empezar otra.`,
  conflictGeneric: "Ya tenés una sesión activa. Terminala antes de empezar otra.",
  errorStart: "No pudimos iniciar la sesión. Intentá de nuevo.",
  errorLoad: "No pudimos cargar la sesión. Intentá de nuevo.",
  errorRecord: "No pudimos guardar la serie. Intentá de nuevo.",
  errorComplete: "No pudimos finalizar la sesión. Intentá de nuevo.",
  retry: "Reintentar",
} as const;
