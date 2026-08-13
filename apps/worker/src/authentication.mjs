import { inspectSession, navigateToSource } from "./inspection.mjs";

const credentialHosts = [
  "iam.education.lu",
  "login.education.lu",
  "login.microsoftonline.com",
  "academy.am.lu",
  "ssl.education.lu",
  "lam.webuntis.com",
];

export function isAllowedCredentialHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return credentialHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function clickIdentityEntry(page) {
  const candidate = await firstVisible(page.getByRole("button", {
    name: /office\s*365|microsoft|iam|single sign.on|sso|sign in|log in|anmelden|connexion/i,
  }).or(page.getByRole("link", {
    name: /office\s*365|microsoft|iam|single sign.on|sso|sign in|log in|anmelden|connexion/i,
  })));
  if (!candidate) return false;
  await candidate.click({ timeout: 12_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  return true;
}

async function clickNextOrSubmit(page) {
  const button = await firstVisible(page.getByRole("button", {
    name: /^(next|continue|sign in|log in|connexion|weiter|anmelden)$/i,
  }).or(page.locator('input[type="submit"]')));
  if (!button) return false;
  await button.click({ timeout: 12_000 });
  await page.waitForTimeout(1_100);
  return true;
}

async function detectsMfa(page) {
  const locator = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i]');
  if (await locator.count().catch(() => 0)) return true;
  const text = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /verification code|one.time code|authenticator|eduKey|code de vérification|bestätigungscode/i.test(text);
}

async function hasCredentialField(page) {
  return (await page.locator('input[type="email"], input[type="password"], input[name="loginfmt"], input[name*="user" i]').count().catch(() => 0)) > 0;
}

export async function ensureAuthenticated(page, source, credentials) {
  let health = await navigateToSource(page, source);
  if (!health.requiresUserAction) return health;

  if (!isAllowedCredentialHost(page.url()) || !await hasCredentialField(page)) {
    await clickIdentityEntry(page);
  }

  if (!isAllowedCredentialHost(page.url())) {
    return { ...health, state: "auth_required", requiresUserAction: true };
  }

  const usernameInput = await firstVisible(page.locator([
    'input[type="email"]',
    'input[name="loginfmt"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
  ].join(", ")));
  if (usernameInput) {
    await usernameInput.fill(credentials.username);
    await clickNextOrSubmit(page);
  }

  if (!isAllowedCredentialHost(page.url())) {
    health = await inspectSession(page, source);
    return health;
  }

  const passwordInput = await firstVisible(page.locator('input[type="password"]'));
  if (!passwordInput) {
    if (await detectsMfa(page)) {
      return { ...await inspectSession(page, source), state: "mfa_required", requiresUserAction: true };
    }
    return { ...await inspectSession(page, source), state: "auth_required", requiresUserAction: true };
  }

  if (!isAllowedCredentialHost(page.url())) {
    throw new Error("Refusing to enter IAM credentials on a non-allowlisted host.");
  }
  await passwordInput.fill(credentials.password);
  await clickNextOrSubmit(page);

  if (await detectsMfa(page)) {
    return { ...await inspectSession(page, source), state: "mfa_required", requiresUserAction: true };
  }

  const staySignedIn = await firstVisible(page.getByRole("button", { name: /^(yes|oui|ja)$/i }));
  if (staySignedIn && isAllowedCredentialHost(page.url())) {
    await staySignedIn.click({ timeout: 8_000 });
  }

  await page.waitForTimeout(2_000);
  health = await inspectSession(page, source);
  return health;
}
