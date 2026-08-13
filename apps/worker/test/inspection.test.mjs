import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeLoginUrl, redactText, redactUrl } from "../src/inspection.mjs";
import { isAllowedCredentialHost } from "../src/authentication.mjs";
import { identityEntryAttributeSelector, identityEntryNamePattern } from "../src/identity.mjs";

test("recognizes IAM and Microsoft identity pages", () => {
  assert.equal(looksLikeLoginUrl("https://iam.education.lu/login"), true);
  assert.equal(looksLikeLoginUrl("https://login.microsoftonline.com/tenant/oauth2"), true);
  assert.equal(looksLikeLoginUrl("https://lam.webuntis.com/WebUntis/"), false);
});

test("redacts school email addresses and long tokens", () => {
  const redacted = redactText("student@school.lu abcdefghijklmnopqrstuvwxyz0123456789");
  assert.equal(redacted.includes("student@school.lu"), false);
  assert.equal(redacted.includes("abcdefghijklmnopqrstuvwxyz0123456789"), false);
});

test("removes query strings and fragments from stored URLs", () => {
  assert.equal(redactUrl("https://example.com/path?code=secret#token"), "https://example.com/path");
});

test("IAM credentials are restricted to known identity hosts", () => {
  assert.equal(isAllowedCredentialHost("https://iam.education.lu/login"), true);
  assert.equal(isAllowedCredentialHost("https://login.microsoftonline.com/tenant"), true);
  assert.equal(isAllowedCredentialHost("https://academy.am.lu/login/index.php"), true);
  assert.equal(isAllowedCredentialHost("https://ssl.education.lu/eduMoodle/login/index.php"), true);
  assert.equal(isAllowedCredentialHost("https://lam.webuntis.com/WebUntis/"), true);
  assert.equal(isAllowedCredentialHost("https://example.com/fake-iam"), false);
  assert.equal(isAllowedCredentialHost("https://iam.education.lu.example.com/login"), false);
  assert.equal(isAllowedCredentialHost("https://signin.iam.education.lu/login"), false);
  assert.equal(isAllowedCredentialHost("https://login.microsoftonline.com.evil.example/tenant"), false);
});

test("recognizes the standalone WebUntis IAM provider choice", () => {
  assert.equal(identityEntryNamePattern.test("IAM"), true);
  assert.equal(identityEntryNamePattern.test("Login with IAM"), true);
  assert.match(identityEntryAttributeSelector, /value\*=\"iam\"/i);
});
