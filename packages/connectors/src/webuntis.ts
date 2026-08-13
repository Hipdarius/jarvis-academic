import type {
  ConnectorHealth,
  NormalizedAcademicItem,
  SchoolConnector,
} from "../../core/src/model";
import { browserProfilePolicy, schoolSources } from "./config";

/**
 * Phase 0 adapter boundary.
 *
 * The NAS worker supplies Playwright after the user completes IAM login in a
 * dedicated persistent profile. This class never accepts a password.
 */
export class WebUntisConnector implements SchoolConnector {
  readonly kind = "webuntis" as const;

  async checkHealth(): Promise<ConnectorHealth> {
    const profileDirectory = process.env[browserProfilePolicy.directoryEnvironmentVariable];

    if (!profileDirectory) {
      return {
        state: "unconfigured",
        message: "A dedicated browser profile has not been configured.",
        checkedAt: new Date().toISOString(),
        requiresUserAction: true,
      };
    }

    return {
      state: "attention",
      message: `Browser profile configured. Live navigation to ${schoolSources.webuntis.baseUrl} still needs interactive IAM validation.`,
      checkedAt: new Date().toISOString(),
      requiresUserAction: true,
    };
  }

  async sync(): Promise<NormalizedAcademicItem[]> {
    throw new Error(
      "Live WebUntis extraction is disabled until the dedicated IAM browser profile is validated.",
    );
  }
}
