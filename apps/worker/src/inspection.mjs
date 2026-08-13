import { identityEntryAttributeSelector, identityEntryNamePattern } from "./identity.mjs";

const loginHosts = [
  "auth.education.lu",
  "iam.education.lu",
  "login.education.lu",
  "login.microsoftonline.com",
  "login.live.com",
];

export function looksLikeLoginUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return loginHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
  } catch {
    return false;
  }
}

export function redactText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[school-email]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\b\d{7,}\b/g, "[identifier]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

export async function inspectSession(page, source) {
  const passwordVisible = await page.locator('input[type="password"]:visible').count().catch(() => 0);
  const usernameVisible = await page.locator('input[name*="user" i]:visible, input[type="email"]:visible').count().catch(() => 0);
  const loginEntryVisible = await page.getByRole("button", {
    name: identityEntryNamePattern,
  }).count().catch(() => 0);
  const identityTileVisible = await page.locator(identityEntryAttributeSelector).count().catch(() => 0)
    + await page.getByText(/^\s*IAM\s*$/i).count().catch(() => 0);
  const moodleLoggedOut = ["academy", "edumoodle"].includes(source.key)
    && await page.locator("body.notloggedin").count().catch(() => 0) > 0;
  const authRequired = moodleLoggedOut || looksLikeLoginUrl(page.url()) || passwordVisible > 0
    || usernameVisible > 0 || loginEntryVisible > 0 || identityTileVisible > 0;

  let state = authRequired ? "auth_required" : "ready";
  let requiresUserAction = authRequired;
  if (source.key === "teams" && !authRequired) {
    const visibleText = redactText(await page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""));
    if (/we.ve run into an issue|there was a problem|something went wrong|browser.*not supported/i.test(visibleText)) {
      state = "account_attention";
      requiresUserAction = true;
    }
  }

  return {
    source: source.key,
    label: source.label,
    state,
    requiresUserAction,
    checkedAt: new Date().toISOString(),
    pageTitle: redactText(await page.title().catch(() => "")),
    url: redactUrl(page.url()),
  };
}

export async function navigateToSource(page, source) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(source.settleMs ?? 1_200);
  return inspectSession(page, source);
}

export async function collectVisibleItems(page, selectors) {
  const rawItems = await page.locator(selectors.join(", ")).evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    })
    .map((element) => ({
      text: element.textContent || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      href: element instanceof HTMLAnchorElement ? element.href : "",
      cells: Array.from(element.querySelectorAll("th, td"), (cell) => cell.textContent || ""),
    }))
    .filter((item) => item.text.trim() || item.ariaLabel || item.title)
    .slice(0, 350));

  const seen = new Set();
  return rawItems.flatMap((item) => {
    const normalized = {
      text: redactText(item.text),
      ariaLabel: redactText(item.ariaLabel),
      title: redactText(item.title),
      href: redactUrl(item.href),
      cells: item.cells.map((cell) => redactText(cell)).filter(Boolean).slice(0, 20),
    };
    const fingerprint = JSON.stringify(normalized);
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [normalized];
  });
}
