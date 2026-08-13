import { syncMoodle } from "./moodle.mjs";
import { syncTeams } from "./teams.mjs";
import { syncWebUntis } from "./webuntis.mjs";

export function syncSource(page, source) {
  if (source.key === "webuntis") return syncWebUntis(page, source);
  if (source.key === "teams") return syncTeams(page, source);
  return syncMoodle(page, source);
}
