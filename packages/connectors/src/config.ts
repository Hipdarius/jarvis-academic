export const schoolSources = {
  webuntis: {
    baseUrl: "https://lam.webuntis.com/WebUntis/",
    navigation: {
      timetable: "Mein Stundenplan",
      homework: "Hausaufgaben",
      exams: "Prüfungen",
      messages: "Mitteilungen",
      courses: "Kurse",
    },
  },
  academyMoodle: { baseUrl: "https://academy.am.lu/" },
  eduMoodle: { baseUrl: "https://ssl.education.lu/eduMoodle/" },
  teams: { baseUrl: "https://teams.microsoft.com/" },
} as const;

export const browserProfilePolicy = {
  directoryEnvironmentVariable: "JARVIS_BROWSER_PROFILE_DIR",
  interactiveLoginOnly: true,
  storePassword: false,
  allowCloudModelAccessToProfile: false,
} as const;
