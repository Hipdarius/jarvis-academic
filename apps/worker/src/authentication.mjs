import { inspectSession, navigateToSource } from "./inspection.mjs";
import { identityEntryAttributeSelector, identityEntryNamePattern } from "./identity.mjs";

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
    return credentialHosts.includes(host);
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

export async function clickIdentityEntry(page) {
  const candidate = await firstVisible(page.getByRole("button", {
    name: identityEntryNamePattern,
  }).or(page.getByRole("link", {
    name: identityEntryNamePattern,
  })).or(page.locator(identityEntryAttributeSelector)).or(page.getByText(/^\s*IAM\s*$/i)));
  if (!candidate) return null;

  const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
  await candidate.click({ timeout: 12_000 });
  const popup = await popupPromise;
  const destination = popup ?? page;
  await destination.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  if (popup) {
    for (let attempt = 0; attempt < 40 && !destination.isClosed(); attempt += 1) {
      if (isAllowedCredentialHost(destination.url()) || await hasCredentialField(destination)) break;
      await destination.waitForTimeout(250).catch(() => undefined);
    }
  }
  await destination.bringToFront().catch(() => undefined);
  await destination.waitForTimeout(800).catch(() => undefined);
  return destination;
}

async function clickNextOrSubmit(page) {
  const button = await firstVisible(page.getByRole("button", {
    name: /^(next|continue|sign in|log in|connexion|weiter|anmelden)$/i,
  }).or(page.locator('input[type="submit"]')));
  if (!button) return false;
  await button.click({ timeout: 12_000 });
  await page.waitForTimeout(1_100).catch(() => undefined);
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
  const sourcePage = page;
  let authPage = page;
  let health = await navigateToSource(page, source);
  if (!health.requiresUserAction) return health;

  if (!isAllowedCredentialHost(authPage.url()) || !await hasCredentialField(authPage)) {
    authPage = await clickIdentityEntry(authPage) ?? authPage;
  }

  if (!isAllowedCredentialHost(authPage.url())) {
    return { ...health, state: "auth_required", requiresUserAction: true };
  }

  const usernameInput = await firstVisible(authPage.locator([
    'input[type="email"]',
    'input[name="loginfmt"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
  ].join(", ")));
  if (usernameInput) {
    await usernameInput.fill(credentials.username);
    await clickNextOrSubmit(authPage);
  }

  if (!authPage.isClosed() && !isAllowedCredentialHost(authPage.url())) {
    health = await inspectSession(authPage, source);
    return health;
  }

  const passwordInput = authPage.isClosed() ? null : await firstVisible(authPage.locator('input[type="password"]'));
  if (!passwordInput) {
    if (!authPage.isClosed() && await detectsMfa(authPage)) {
      return { ...await inspectSession(authPage, source), state: "mfa_required", requiresUserAction: true };
    }
    if (authPage !== sourcePage && authPage.isClosed()) {
      await sourcePage.waitForTimeout(2_000).catch(() => undefined);
      const sourceHealth = await inspectSession(sourcePage, source);
      if (!sourceHealth.requiresUserAction) return sourceHealth;
    }
    return { ...await inspectSession(sourcePage, source), state: "auth_required", requiresUserAction: true };
  }

  if (!isAllowedCredentialHost(authPage.url())) {
    throw new Error("Refusing to enter IAM credentials on a non-allowlisted host.");
  }
  await passwordInput.fill(credentials.password);
  await clickNextOrSubmit(authPage);

  if (!authPage.isClosed() && await detectsMfa(authPage)) {
    return { ...await inspectSession(authPage, source), state: "mfa_required", requiresUserAction: true };
  }

  const staySignedIn = authPage.isClosed() ? null : await firstVisible(authPage.getByRole("button", { name: /^(yes|oui|ja)$/i }));
  if (staySignedIn && isAllowedCredentialHost(authPage.url())) {
    await staySignedIn.click({ timeout: 8_000 });
  }

  if (authPage !== sourcePage && !authPage.isClosed()) {
    await authPage.waitForEvent("close", { timeout: 12_000 }).catch(() => undefined);
  }
  await sourcePage.bringToFront().catch(() => undefined);
  await sourcePage.waitForTimeout(2_000).catch(() => undefined);
  health = await inspectSession(sourcePage, source);
  return health;
}
