import {
  canonicalSubjectName,
  curriculumSubjectFor,
  normalizedAcademicText,
  terminale1CISubjects,
} from "./academic-catalog.ts";

export type KnowledgeClassification = {
  subject: string;
  confidence: number;
  reason: string;
  academicPeriod: string;
  topicPath: string[];
};

export type KnowledgeClassificationInput = {
  name: string;
  text?: string | null;
  sourcePath?: string | null;
  subjectHint?: string | null;
  academicItemTitle?: string | null;
  createdAt?: Date;
};

const genericPathParts = new Set([
  "allgemeines", "assignments", "course", "course materials", "documents", "files", "general",
  "homework", "material", "materials", "moodle", "resources", "teams", "unterrichtsmaterial",
]);

const topicRules: Record<string, Array<[string, RegExp]>> = {
  Mathematics: [
    ["Calculus", /\b(calculus|derivative|differentiat|integral|ableitung|stammfunktion)\b/i],
    ["Probability & Statistics", /\b(probability|statistics?|wahrscheinlichkeit|statistik)\b/i],
    ["Matrices & Vectors", /\b(matrix|matrices|vector|vektor)\b/i],
    ["Functions", /\b(functions?|funktionen?|fonctions?)\b/i],
    ["Complex Numbers", /\b(complex numbers?|komplexe zahlen|nombres complexes)\b/i],
    ["Geometry", /\b(geometry|geometrie|géométrie|trigonometry)\b/i],
  ],
  Programming: [
    ["Java", /\b(java|netbeans|junit)\b/i],
    ["Object-Oriented Programming", /\b(object oriented|oop|classes?|inheritance|polymorphism|vererbung)\b/i],
    ["Algorithms & Data Structures", /\b(algorithm|data structure|sorting|searching|recursion)\b/i],
    ["Web Development", /\b(html|css|javascript|typescript|web development)\b/i],
    ["Python", /\bpython\b/i],
  ],
  "Information Analysis & Modeling": [
    ["SQL", /\b(sql|select|joins?|queries|abfragen)\b/i],
    ["Data Modeling", /\b(entity relationship|erd|data model|datenmodell|modélisation des données)\b/i],
    ["Normalization", /\b(normalization|normalisation|normalformen?)\b/i],
    ["XML & Structured Data", /\b(xml|xsd|xpath|json schema)\b/i],
  ],
  "Media Communication": [
    ["Communication Theory", /\b(communication theory|communication model|sender receiver|semiotics)\b/i],
    ["Media Analysis", /\b(media analysis|analyse des médias|fake news|journalism|journalisme)\b/i],
    ["Presentation & Rhetoric", /\b(rhetoric|rhétorique|presentation skills|public speaking|pitch)\b/i],
  ],
  "Technology & Innovation": [
    ["Networks & Cybersecurity", /\b(networks?|networking|reseau|réseau|cybersecurity|security|sécurité)\b/i],
    ["Robotics & IoT", /\b(robot|robotics|iot|arduino|sensor|microcontroller)\b/i],
    ["Artificial Intelligence", /\b(artificial intelligence|machine learning|neural network|intelligence artificielle)\b/i],
    ["Systems & Hardware", /\b(hardware|operating system|computer architecture|processor|cpu)\b/i],
  ],
  "Project Management": [
    ["Requirements", /\b(requirements?|cahier des charges|specification|user stor(?:y|ies))\b/i],
    ["UML & Architecture", /\b(uml|use case|class diagram|architecture)\b/i],
    ["Planning & Delivery", /\b(gantt|milestone|sprint|scrum|kanban|project plan)\b/i],
    ["Testing & Quality", /\b(test plan|quality assurance|acceptance criteria|validation)\b/i],
  ],
  Physics: [
    ["Mechanics", /\b(mechanics?|mechanik|mécanique|kinetic|momentum|force|bewegung)\b/i],
    ["Electricity & Magnetism", /\b(electric|circuit|voltage|current|magnet|elektr)\b/i],
    ["Waves & Optics", /\b(waves?|optics?|light|frequency|wellen|optik)\b/i],
    ["Thermodynamics", /\b(thermodynamic|temperature|heat|wärme)\b/i],
  ],
  Philosophy: [
    ["Ethics", /\b(ethics?|morality|éthique|moral)\b/i],
    ["Knowledge & Truth", /\b(epistemology|knowledge|truth|vérité|erkenntnis)\b/i],
    ["Politics & Society", /\b(political philosophy|justice|state|society|gesellschaft)\b/i],
  ],
  "Economics & Finance": [
    ["Accounting", /\b(accounting|balance sheet|income statement|comptabilit|buchhaltung)\b/i],
    ["Markets & Microeconomics", /\b(supply|demand|market|microeconom|offre|demande)\b/i],
    ["Macroeconomics", /\b(macroeconom|inflation|gdp|unemployment|pib)\b/i],
    ["Finance", /\b(interest|investment|portfolio|finance|zins)\b/i],
  ],
  English: [
    ["Literature", /\b(novel|poetry|poem|drama|literature|shakespeare)\b/i],
    ["Writing", /\b(essay|writing|argumentative|summary|commentary)\b/i],
    ["Language", /\b(grammar|vocabulary|listening|reading comprehension)\b/i],
  ],
  "Language option": [
    ["Literature", /\b(literatur|littérature|roman|poésie|gedicht|lektüre)\b/i],
    ["Writing", /\b(dissertation|commentaire|erörterung|aufsatz|rédaction)\b/i],
    ["Language", /\b(grammaire|grammatik|vocabulaire|wortschatz)\b/i],
  ],
};

function aliasMatch(value: string, alias: string) {
  const needle = normalizedAcademicText(alias);
  return needle && ` ${value} `.includes(` ${needle} `);
}

function classifySubject(input: KnowledgeClassificationInput) {
  const regions = [
    { label: "linked assignment", value: input.subjectHint ?? "", weight: 12 },
    { label: "source folder", value: input.sourcePath ?? "", weight: 8 },
    { label: "filename", value: input.name, weight: 6 },
    { label: "assignment title", value: input.academicItemTitle ?? "", weight: 5 },
    { label: "document text", value: (input.text ?? "").slice(0, 24_000), weight: 1 },
  ].map((region) => ({ ...region, normalized: normalizedAcademicText(region.value) }));

  const scored = terminale1CISubjects.map((subject) => {
    let score = 0;
    let strongest = "document text";
    for (const region of regions) {
      const aliases = [subject.name, subject.officialName, ...subject.aliases];
      if (!region.normalized || !aliases.some((alias) => aliasMatch(region.normalized, alias))) continue;
      score += region.weight;
      if (region.weight > (regions.find((candidate) => candidate.label === strongest)?.weight ?? 0)) strongest = region.label;
    }
    return { subject, score, strongest };
  }).sort((first, second) => second.score - first.score);

  if (scored[0]?.score >= 5 && scored[0].score > (scored[1]?.score ?? 0)) {
    return {
      subject: scored[0].subject.name,
      confidence: Math.min(98, 58 + scored[0].score * 3),
      reason: `Matched the ${scored[0].strongest} to the 1CI curriculum.`,
    };
  }

  const hinted = String(input.subjectHint ?? "").trim();
  if (hinted && !/^general$/i.test(hinted)) {
    return { subject: canonicalSubjectName(hinted), confidence: 88, reason: "Kept the subject supplied by the school source." };
  }
  return { subject: "General", confidence: 0, reason: "No reliable subject signal was found." };
}

function academicYear(value: string, reference: Date) {
  const normalized = value.replace(/[\\_]/g, "-");
  const explicit = /\b(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})\b/.exec(normalized);
  if (explicit) {
    const start = Number(explicit[1]);
    const end = explicit[2].length === 2 ? 2000 + Number(explicit[2]) : Number(explicit[2]);
    if (end === start + 1) return `${start}-${end}`;
  }
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const start = month >= 7 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function semester(value: string, reference: Date) {
  const normalized = normalizedAcademicText(value);
  const explicit = /\b(?:semester|semestre|halbjahr|trimester|s)\s*([12])\b/.exec(normalized)
    ?? /\b([12])\s*(?:semester|semestre|halbjahr)\b/.exec(normalized);
  if (explicit) return `Semester ${explicit[1]}`;
  const month = reference.getUTCMonth();
  return month >= 7 || month === 0 ? "Semester 1" : "Semester 2";
}

function cleanPathPart(value: string) {
  return value.replace(/\.[a-z0-9]{1,8}$/i, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function sourceTopics(sourcePath: string, subject: string) {
  const curriculum = curriculumSubjectFor(subject);
  const subjectTerms = [subject, curriculum?.officialName ?? "", ...(curriculum?.aliases ?? [])].map(normalizedAcademicText);
  return sourcePath.split(/\s*(?:>|\/|\\|\|)\s*/).map(cleanPathPart).filter((part) => {
    const normalized = normalizedAcademicText(part);
    return normalized.length >= 3
      && !genericPathParts.has(normalized)
      && !subjectTerms.some((term) => term && (normalized === term || aliasMatch(normalized, term)))
      && !/^20\d{2}\s*20\d{2}$/.test(normalized)
      && !/^(?:semester|semestre|halbjahr|s)\s*[12]$/.test(normalized);
  }).slice(-2);
}

function explicitChapter(value: string) {
  const match = /\b(chapter|chapitre|kapitel|unit|unite|unité|module|theme|thème|topic|lesson|lecon|leçon)[\s._-]*([0-9ivx]+(?:[._-][0-9]+)?(?:\s*[-:]\s*[a-z][^/\\|]{1,45})?)/i.exec(value);
  if (!match) return null;
  const label = `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function inferredTopic(subject: string, value: string) {
  return topicRules[subject]?.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

export function classifyKnowledgeFile(input: KnowledgeClassificationInput): KnowledgeClassification {
  const reference = input.createdAt && !Number.isNaN(input.createdAt.getTime()) ? input.createdAt : new Date();
  const subject = classifySubject(input);
  const structuralText = [input.sourcePath, input.name, input.academicItemTitle].filter(Boolean).join(" | ");
  const fullText = `${structuralText} | ${(input.text ?? "").slice(0, 30_000)}`;
  const chapter = explicitChapter(structuralText);
  const folders = sourceTopics(input.sourcePath ?? "", subject.subject);
  const topic = inferredTopic(subject.subject, fullText);
  const topicPath = [...new Set([...folders, chapter, topic].filter((value): value is string => Boolean(value)))].slice(0, 3);
  return {
    ...subject,
    academicPeriod: `${academicYear(structuralText, reference)} / ${semester(structuralText, reference)}`,
    topicPath: topicPath.length ? topicPath : ["Unclassified"],
  };
}
