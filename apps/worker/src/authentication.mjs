import { inspectSession, navigateToSource } from "./inspection.mjs";
import {
  identityEntryAttributeSelector,
  identityEntryNamePattern,
  providerEntryNamePattern,
} from "./identity.mjs";

const microsoftIdentityHosts = ["login.microsoftonline.com", "login.live.com"];
const educationIdentityHosts = [
  "auth.education.lu",
  "iam.auth.education.lu",
  "iam.education.lu",
  "login.education.lu",
  "ssl.education.lu",
];
const credentialHosts = [...educationIdentityHosts, ...microsoftIdentityHosts];

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function traceAuthentication(page, step, action) {
  if (process.env.JARVIS_AUTH_TRACE !== "true") return;
  let location = "unknown";
  try {
    const parsed = new URL(page.url());
    location = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Keep malformed or transient URLs out of diagnostics.
  }
  console.error(JSON.stringify({ type: "auth_trace", step, action, location }));
}

export function isAllowedCredentialHost(value) {
  return credentialHosts.includes(hostname(value));
}

export function isAllowedPasswordHost(value) {
  return educationIdentityHosts.includes(hostname(value));
}

export function isMicrosoftIdentityHost(value) {
  return microsoftIdentityHosts.includes(hostname(value));
}

export function schoolEmailFor(username) {
  const value = String(username).trim();
  return value.includes("@") ? value : `${value}@school.lu`;
}

export function iamUsernameFor(username) {
  const value = String(username).trim();
  return value.toLowerCase().endsWith("@school.lu") ? value.slice(0, -"@school.lu".length) : value;
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

function identityEntryLocator(page, providerOnly) {
  const name = providerOnly ? providerEntryNamePattern : identityEntryNamePattern;
  return page.getByRole("button", { name })
    .or(page.getByRole("link", { name }))
    .or(page.locator(identityEntryAttributeSelector))
    .or(page.getByText(/^\s*IAM\s*$/i));
}

async function visibleIdentityEntry(page, providerOnly = false) {
  return firstVisible(identityEntryLocator(page, providerOnly));
}

export async function clickIdentityEntry(page, { providerOnly = false } = {}) {
  const candidate = await visibleIdentityEntry(page, providerOnly);
  if (!candidate) return null;

  const newPagePromise = Promise.race([
    page.waitForEvent("popup", { timeout: 5_000 }),
    page.context().waitForEvent("page", { timeout: 5_000 }),
  ]).catch(() => null);
  await candidate.click({ timeout: 12_000 });
  const popup = await newPagePromise;
  const destination = popup ?? page;
  await destination.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await destination.bringToFront().catch(() => undefined);
  await destination.waitForTimeout(500).catch(() => undefined);
  return destination;
}

async function clickNextOrSubmit(page, input) {
  const button = await firstVisible(page.getByRole("button", {
    name: /^(next|continue|submit|sign in|log in|connexion|continuer|suivant|weiter|fortfahren|anmelden)$/i,
  }).or(page.locator('input[type="submit"], input[type="button"][value*="continue" i], input[type="button"][value*="next" i]')));
  if (button) await button.click({ timeout: 12_000 });
  else await input.press("Enter", { timeout: 12_000 });
}

async function detectsMfa(page) {
  const locator = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="code" i]');
  if (await locator.count().catch(() => 0)) return true;
  const text = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /verification code|one.time code|authenticator|eduKey|code de v.rification|best.tigungscode/i.test(text);
}

export function isConsentUrl(value) {
  try {
    const parsed = new URL(value);
    return educationIdentityHosts.includes(parsed.hostname.toLowerCase())
      && /\/IAM\/(?:terms_getconsent|consent)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function visibleUsernameInput(page) {
  return firstVisible(page.locator([
    'input[type="email"]',
    'input[name="loginfmt"]',
    'input[autocomplete="username"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
  ].join(", ")));
}

async function visiblePasswordInput(page) {
  return firstVisible(page.locator('input[type="password"]'));
}

async function hasCredentialField(page) {
  return Boolean(await visiblePasswordInput(page) || await visibleUsernameInput(page));
}

async function waitForStageChange(page, previousUrl, previousStage) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (page.isClosed()) return;
    const password = await visiblePasswordInput(page);
    const username = await visibleUsernameInput(page);
    if (page.url() !== previousUrl) return;
    if (previousStage === "username" && password && !isMicrosoftIdentityHost(page.url())) return;
    if (previousStage === "password" && !password) return;
    if (previousStage === "provider" && (password || username)) return;
    if (await detectsMfa(page)) return;
    await page.waitForTimeout(250).catch(() => undefined);
  }
}

function actionKey(page, stage) {
  try {
    const url = new URL(page.url());
    return `${stage}:${url.origin}${url.pathname}`;
  } catch {
    return `${stage}:${page.url()}`;
  }
}

async function manualResult(page, source, state = "auth_required") {
  const result = await inspectSession(page, source);
  return { ...result, state: result.state === "provider_account_rejected" ? result.state : state, requiresUserAction: true };
}

async function verifySource(sourcePage, source) {
  await sourcePage.bringToFront().catch(() => undefined);
  await sourcePage.waitForTimeout(1_000).catch(() => undefined);
  return navigateToSource(sourcePage, source);
}

export async function ensureAuthenticated(page, source, credentials) {
  const sourcePage = page;
  let authPage = page;
  let identityRouteStarted = false;
  const completedActions = new Set();
  let health = await navigateToSource(sourcePage, source);
  if (!health.requiresUserAction) return health;

  for (let step = 0; step < 12; step += 1) {
    traceAuthentication(authPage, step, "inspect");
    if (authPage.isClosed()) {
      health = await verifySource(sourcePage, source);
      if (!health.requiresUserAction) return health;
      authPage = sourcePage;
    }

    if (isConsentUrl(authPage.url())) return manualResult(authPage, source, "consent_required");
    if (await detectsMfa(authPage)) return manualResult(authPage, source, "mfa_required");

    if (isAllowedPasswordHost(authPage.url()) && hostname(authPage.url()) !== hostname(source.url)) {
      identityRouteStarted = true;
    }

    // School portals often show local username/password fields beside the IAM
    // provider. IAM must win so credentials are never entered into that form.
    const providerEntry = identityRouteStarted ? null : await visibleIdentityEntry(authPage, true);
    if (providerEntry && !isMicrosoftIdentityHost(authPage.url())) {
      traceAuthentication(authPage, step, "select_identity_provider");
      const key = actionKey(authPage, "provider");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      authPage = await clickIdentityEntry(authPage, { providerOnly: true }) ?? authPage;
      identityRouteStarted = true;
      await waitForStageChange(authPage, previousUrl, "provider");
      continue;
    }

    // Microsoft's legacy sign-in DOM can expose both the email and password
    // controls at once. The school flow must submit the @school.lu identity
    // first and follow the redirect; Jarvis never enters IAM passwords here.
    const microsoftUsernameInput = isMicrosoftIdentityHost(authPage.url())
      ? await visibleUsernameInput(authPage)
      : null;
    if (microsoftUsernameInput) {
      traceAuthentication(authPage, step, "submit_school_email");
      const key = actionKey(authPage, "microsoft-username");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      await microsoftUsernameInput.fill(schoolEmailFor(credentials.username));
      identityRouteStarted = true;
      await clickNextOrSubmit(authPage, microsoftUsernameInput);
      await waitForStageChange(authPage, previousUrl, "username");
      continue;
    }

    const passwordInput = await visiblePasswordInput(authPage);
    if (passwordInput) {
      traceAuthentication(authPage, step, "submit_iam_password");
      if (!identityRouteStarted || !isAllowedPasswordHost(authPage.url())) return manualResult(authPage, source);
      const key = actionKey(authPage, "password");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      await passwordInput.fill(credentials.password);
      await clickNextOrSubmit(authPage, passwordInput);
      await waitForStageChange(authPage, previousUrl, "password");
      continue;
    }

    const usernameInput = await visibleUsernameInput(authPage);
    if (usernameInput) {
      traceAuthentication(authPage, step, "submit_iam_username");
      if (!isAllowedCredentialHost(authPage.url())) return manualResult(authPage, source);
      const key = actionKey(authPage, "username");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      const username = isMicrosoftIdentityHost(authPage.url())
        ? schoolEmailFor(credentials.username)
        : iamUsernameFor(credentials.username);
      if (!isMicrosoftIdentityHost(authPage.url()) && !identityRouteStarted) {
        return manualResult(authPage, source);
      }
      await usernameInput.fill(username);
      if (isMicrosoftIdentityHost(authPage.url())) identityRouteStarted = true;
      await clickNextOrSubmit(authPage, usernameInput);
      await waitForStageChange(authPage, previousUrl, "username");
      continue;
    }

    const staySignedIn = await firstVisible(authPage.getByRole("button", { name: /^(yes|oui|ja)$/i }));
    if (staySignedIn && isMicrosoftIdentityHost(authPage.url())) {
      traceAuthentication(authPage, step, "confirm_stay_signed_in");
      const key = actionKey(authPage, "consent");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      await staySignedIn.click({ timeout: 8_000 });
      await waitForStageChange(authPage, previousUrl, "consent");
      continue;
    }

    const entry = await visibleIdentityEntry(authPage);
    if (entry) {
      traceAuthentication(authPage, step, "open_identity_entry");
      const key = actionKey(authPage, "entry");
      if (completedActions.has(key)) return manualResult(authPage, source);
      completedActions.add(key);
      const previousUrl = authPage.url();
      authPage = await clickIdentityEntry(authPage) ?? authPage;
      await waitForStageChange(authPage, previousUrl, "provider");
      continue;
    }

    if (!isAllowedCredentialHost(authPage.url()) && !await hasCredentialField(authPage)) {
      health = await verifySource(sourcePage, source);
      if (!health.requiresUserAction) return health;
      authPage = sourcePage;
      continue;
    }

    await authPage.waitForTimeout(1_000).catch(() => undefined);
  }

  return manualResult(authPage.isClosed() ? sourcePage : authPage, source);
}
