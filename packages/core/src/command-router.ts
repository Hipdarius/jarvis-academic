export const commandActions = [
  "create_homework",
  "create_project_canvas",
  "create_study_session",
  "create_knowledge_note",
  "ask_jarvis",
] as const;

export type CommandAction = (typeof commandActions)[number];

export type CommandIntent = {
  action: CommandAction;
  title: string;
  subject: string | null;
  dueLabel: string | null;
  canvasTitle: string | null;
  response: string;
  confidence: number;
  provider: "openai" | "hermes" | "nous" | "openrouter" | "anthropic" | "local";
};

const subjectRules: Array<[subject: string, pattern: RegExp]> = [
  ["Mathematics", /\b(algebra|analysis|calculus|derivative|equation|function|geometry|integral|math|matrix|probability|trigonometry)\b/i],
  ["Databases", /\b(access|database|dbms|erd|normalization|query|relational|schema|sql)\b/i],
  ["Computer Science", /\b(algorithm|code|computer science|git(?:hub)?|java|netbeans|programming|python|software)\b/i],
  ["Physics", /\b(acceleration|electricity|energy|force|mechanics|momentum|physics|radiation|velocity)\b/i],
  ["Economics", /\b(accounting|economics?|economy|finance|inflation|market|microeconomics|macroeconomics)\b/i],
  ["English", /\b(english|essay|literature|novel|shakespeare|vocabulary)\b/i],
  ["French", /\b(francais|fran[cç]ais|french|grammaire|vocabulaire)\b/i],
  ["German", /\b(deutsch|german|grammatik)\b/i],
];

const weekdayPattern = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

export function inferSubject(text: string): string | null {
  return subjectRules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export function inferDueLabel(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\btoday\b/.test(normalized)) return "Today";
  if (/\btomorrow\b/.test(normalized)) return "Tomorrow";

  const weekday = normalized.match(new RegExp(`\\b(?:by|due|for|on)\\s+(next\\s+)?(${weekdayPattern})\\b`, "i"));
  if (weekday) {
    const prefix = weekday[1] ? "Next " : "";
    return `${prefix}${weekday[2][0].toUpperCase()}${weekday[2].slice(1)}`;
  }

  const inDays = normalized.match(/\bin\s+(\d{1,2})\s+days?\b/);
  if (inDays) return `In ${inDays[1]} days`;
  if (/\bnext week\b/.test(normalized)) return "Next week";
  return null;
}

function sentenceCase(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "");
  if (!trimmed) return "Untitled command";
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function projectTitle(text: string) {
  const withoutLeadIn = text
    .replace(/^\s*(?:new\s+)?(?:project\s+idea|idea|brainstorm)\s*[:\-]?\s*/i, "")
    .replace(/^\s*(?:what if|could i|should i|imagine)\s+/i, "")
    .replace(/^\s*i\s+(?:built|build|made|make|created|create)\s+/i, "")
    .replace(/^\s*(?:built|build|made|make|created|create)\s+/i, "");
  return sentenceCase(withoutLeadIn || text);
}

export function interpretCommandLocally(text: string): CommandIntent {
  const normalized = text.trim();
  const subject = inferSubject(normalized);
  const dueLabel = inferDueLabel(normalized);

  const strongProjectSignal = /\b(brainstorm|concept|hypothetical|project idea|startup idea)\b|\bwhat if\b|\bcould i (?:build|make|create)\b/i;
  const buildSignal = /\b(?:build|design|invent|make|create) (?:a|an|my)\b/i;
  const homeworkSignal = /\b(algebra book|assignment|bring|complete|corrected test|due|exercise(?:s)?|finish|hand in|homework|page(?:s)?|problem set|sheet|submit|worksheet)\b/i;
  const studySignal = /\b(focus session|practice|prepare for|revision|revise|study|test prep)\b/i;
  const noteSignal = /\b(add a note|concept note|knowledge note|remember this|save this|take a note)\b/i;

  let action: CommandAction = "ask_jarvis";
  if (strongProjectSignal.test(normalized)) action = "create_project_canvas";
  else if (homeworkSignal.test(normalized)) action = "create_homework";
  else if (buildSignal.test(normalized)) action = "create_project_canvas";
  else if (studySignal.test(normalized)) action = "create_study_session";
  else if (noteSignal.test(normalized)) action = "create_knowledge_note";

  const title = action === "create_project_canvas"
    ? projectTitle(normalized)
    : sentenceCase(normalized);
  const canvasTitle = action === "create_project_canvas" ? title : null;

  const responseByAction: Record<CommandAction, string> = {
    create_homework: `Homework created${subject ? ` in ${subject}` : " in the inbox"}${dueLabel ? ` for ${dueLabel}` : ""}.`,
    create_project_canvas: `A brainstorm canvas is ready for “${title}”, with research queued when an agent worker is connected.`,
    create_study_session: `A study session was added${subject ? ` for ${subject}` : ""}.`,
    create_knowledge_note: `A knowledge note was saved${subject ? ` under ${subject}` : ""}.`,
    ask_jarvis: "I understood this as a question and queued it for the academic agent worker.",
  };

  const confidence = action === "ask_jarvis"
    ? 0.58
    : subject || action === "create_project_canvas"
      ? 0.91
      : 0.78;

  return {
    action,
    title,
    subject,
    dueLabel,
    canvasTitle,
    response: responseByAction[action],
    confidence,
    provider: "local",
  };
}

export function isCommandAction(value: unknown): value is CommandAction {
  return typeof value === "string" && commandActions.includes(value as CommandAction);
}
