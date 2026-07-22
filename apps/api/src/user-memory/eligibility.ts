import type { UserMemory } from "@kinora/contracts";

const SECRET_PATTERNS = [
  /\bpassword\b/i,
  /\bapi[_ -]?key\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
];
const RAW_TRANSCRIPT_PATTERNS = [
  /^user:/im,
  /^assistant:/im,
  /^speaker\s*\d+:/im,
  /transcript/i,
];
const FULL_PLAN_PATTERNS = [
  /weeklysessions/i,
  /day\s*1/i,
  /restSeconds/i,
  /sets?\s*[x×-]\s*reps?/i,
];

// Health classification is deliberately conservative: unknown medical-shaped
// text must not become durable memory by falling through to "eligible".
const SENSITIVE_HEALTH_PATTERNS = [
  /\bdiagnos/i,
  /\binjury\b/i,
  /\bpain\b/i,
  /\brehab\b/i,
  /\bhernia/i,
  /\bmedication\b/i,
  /\bdiabetes\b/i,
  /\bblood pressure\b/i,
  /\basthma\b/i,
  /\ballerg(?:y|ies|ic)\b/i,
  /\btorn\s+(?:acl|ligament|meniscus|tendon|muscle)\b/i,
  /\bmigraine\b/i,
  /\bepilepsy\b/i,
  /\bceliac\b/i,
  /\bosteoporosis\b/i,
  /\bheart condition\b/i,
  /\bchronic condition\b/i,
  /\bpregnan(?:t|cy)\b/i,
  /\bsciatica\b/i,
  /\barthritis\b/i,
  /\bsurger(?:y|ies|ical)\b/i,
  /\bfractur(?:e|ed|ing)\b/i,
  /\bstroke\b/i,
  /\bhypertension\b/i,
  /\bhigh\s+cholesterol\b/i,
  /\btorn\s+acl\b/i,
  /\b(?:medical|health)\s+(?:fact|issue|condition|history|problem)\b/i,
  /\b(?:medical|health)\b/i,
  /\b(?:condition|disease|disorder|syndrome|symptom|treatment|prescription)\b/i,
];

export function classifyMemoryEligibility(input: string): UserMemory["eligibility"] {
  if (input.length < 3) {
    return "other";
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(input))) {
    return "secret";
  }
  if (RAW_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(input))) {
    return "raw_transcript";
  }
  if (FULL_PLAN_PATTERNS.some((pattern) => pattern.test(input))) {
    return "full_plan";
  }
  if (SENSITIVE_HEALTH_PATTERNS.some((pattern) => pattern.test(input))) {
    return "sensitive_health";
  }
  return "eligible";
}

export function isRejectedMemoryText(input: string): boolean {
  return classifyMemoryEligibility(input) !== "eligible";
}
