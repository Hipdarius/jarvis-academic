export type CurriculumSubject = {
  id: string;
  name: string;
  officialName: string;
  group: "Languages and mathematics" | "Specialization" | "General education";
  weeklyLessons: number;
  aliases: string[];
};

export const terminale1CISubjects: CurriculumSubject[] = [
  {
    id: "english",
    name: "English",
    officialName: "Anglais",
    group: "Languages and mathematics",
    weeklyLessons: 3,
    aliases: ["english", "anglais", "englisch", "angla"],
  },
  {
    id: "language-option",
    name: "Language option",
    officialName: "Français ou Allemand",
    group: "Languages and mathematics",
    weeklyLessons: 3,
    aliases: ["french", "francais", "français", "franc", "german", "deutsch", "allemand", "allem", "language option", "option linguistique"],
  },
  {
    id: "mathematics",
    name: "Mathematics",
    officialName: "Mathématiques",
    group: "Languages and mathematics",
    weeklyLessons: 6,
    aliases: ["mathematics", "mathematik", "mathematiques", "mathématiques", "maths", "mathe", "math1", "math2"],
  },
  {
    id: "media-communication",
    name: "Media Communication",
    officialName: "Communication média",
    group: "Specialization",
    weeklyLessons: 2,
    aliases: ["media communication", "communication media", "communication média", "communication medias", "communication médias", "comme"],
  },
  {
    id: "programming",
    name: "Programming",
    officialName: "Science de la programmation",
    group: "Specialization",
    weeklyLessons: 3,
    aliases: ["programming", "programmation", "science de la programmation", "computer science", "informatik", "scipr", "coding"],
  },
  {
    id: "information-modeling",
    name: "Information Analysis & Modeling",
    officialName: "Analyse et modélisation d'informations",
    group: "Specialization",
    weeklyLessons: 2,
    aliases: ["information analysis", "information modeling", "information modelling", "analyse et modelisation", "analyse et modélisation", "database", "databases", "datenbank", "aminf"],
  },
  {
    id: "technology-innovation",
    name: "Technology & Innovation",
    officialName: "Technologie et innovations",
    group: "Specialization",
    weeklyLessons: 2,
    aliases: ["technology and innovation", "technology innovation", "technologie et innovations", "technologies et innovations", "teinn"],
  },
  {
    id: "project-management",
    name: "Project Management",
    officialName: "Maîtrise d'ouvrage",
    group: "Specialization",
    weeklyLessons: 2,
    aliases: ["project management", "maitrise d ouvrage", "maîtrise d'ouvrage", "maîtrise d ouvrage", "maiou"],
  },
  {
    id: "physics",
    name: "Physics",
    officialName: "Physique",
    group: "General education",
    weeklyLessons: 3,
    aliases: ["physics", "physique", "physik", "physi"],
  },
  {
    id: "philosophy",
    name: "Philosophy",
    officialName: "Philosophie",
    group: "General education",
    weeklyLessons: 2,
    aliases: ["philosophy", "philosophie", "philo"],
  },
  {
    id: "economics-finance",
    name: "Economics & Finance",
    officialName: "Économie et finances",
    group: "General education",
    weeklyLessons: 2,
    aliases: ["economics", "economy", "finance", "financial economics", "economie et finances", "économie et finances", "economie financiere", "économie financière", "wirtschaft", "ecofi"],
  },
  {
    id: "physical-education",
    name: "Physical Education",
    officialName: "Éducation physique et sportive",
    group: "General education",
    weeklyLessons: 1,
    aliases: ["physical education", "education physique", "éducation physique", "sport", "sports", "eduph"],
  },
];

export function normalizedAcademicText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsAlias(value: string, alias: string) {
  const normalizedAlias = normalizedAcademicText(alias);
  return normalizedAlias.length > 0 && ` ${value} `.includes(` ${normalizedAlias} `);
}

export function curriculumSubjectFor(value: string | null | undefined) {
  const normalized = normalizedAcademicText(value ?? "");
  if (!normalized) return null;
  return terminale1CISubjects.find((subject) => (
    containsAlias(normalized, subject.name)
    || containsAlias(normalized, subject.officialName)
    || subject.aliases.some((alias) => containsAlias(normalized, alias))
  )) ?? null;
}

export function canonicalSubjectName(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || /^general$/i.test(trimmed)) return "General";
  return curriculumSubjectFor(trimmed)?.name ?? trimmed.slice(0, 200);
}
