import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeLoginUrl, redactText, redactUrl } from "../src/inspection.mjs";
import {
  iamUsernameFor,
  isAllowedCredentialHost,
  isAllowedPasswordHost,
  isMicrosoftIdentityHost,
  schoolEmailFor,
} from "../src/authentication.mjs";
import {
  identityEntryAttributeSelector,
  identityEntryNamePattern,
  providerEntryNamePattern,
} from "../src/identity.mjs";

test("recognizes IAM and Microsoft identity pages", () => {
  assert.equal(looksLikeLoginUrl("https://auth.education.lu/module.php/saml/disco"), true);
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

test("credential entry is restricted to exact identity hosts", () => {
  assert.equal(isAllowedCredentialHost("https://auth.education.lu/module.php/saml/disco"), true);
  assert.equal(isAllowedCredentialHost("https://iam.auth.education.lu/module.php/core/loginuserpass.php"), true);
  assert.equal(isAllowedCredentialHost("https://iam.education.lu/login"), true);
  assert.equal(isAllowedCredentialHost("https://login.microsoftonline.com/tenant"), true);
  assert.equal(isAllowedCredentialHost("https://academy.am.lu/login/index.php"), false);
  assert.equal(isAllowedCredentialHost("https://ssl.education.lu/eduMoodle/login/index.php"), true);
  assert.equal(isAllowedCredentialHost("https://lam.webuntis.com/WebUntis/"), false);
  assert.equal(isAllowedCredentialHost("https://example.com/fake-iam"), false);
  assert.equal(isAllowedCredentialHost("https://iam.education.lu.example.com/login"), false);
  assert.equal(isAllowedCredentialHost("https://signin.iam.education.lu/login"), false);
  assert.equal(isAllowedCredentialHost("https://login.microsoftonline.com.evil.example/tenant"), false);
});

test("passwords are restricted to Education IAM and never entered at Microsoft", () => {
  assert.equal(isAllowedPasswordHost("https://auth.education.lu/module.php/core/loginuserpass.php"), true);
  assert.equal(isAllowedPasswordHost("https://iam.auth.education.lu/module.php/core/loginuserpass.php"), true);
  assert.equal(isAllowedPasswordHost("https://ssl.education.lu/idp/login"), true);
  assert.equal(isAllowedPasswordHost("https://iam.education.lu/login"), true);
  assert.equal(isAllowedPasswordHost("https://login.microsoftonline.com/tenant"), false);
  assert.equal(isAllowedPasswordHost("https://lam.webuntis.com/WebUntis/"), false);
  assert.equal(isAllowedPasswordHost("https://iam.auth.education.lu.evil.example/login"), false);
  assert.equal(isMicrosoftIdentityHost("https://login.microsoftonline.com/tenant"), true);
});

test("derives the school email while preserving the IAM username", () => {
  assert.equal(schoolEmailFor("student123"), "student123@school.lu");
  assert.equal(schoolEmailFor("student@school.lu"), "student@school.lu");
  assert.equal(iamUsernameFor("student@school.lu"), "student");
  assert.equal(iamUsernameFor("student"), "student");
});

test("recognizes IAM and Microsoft provider choices", () => {
  assert.equal(identityEntryNamePattern.test("IAM"), true);
  assert.equal(identityEntryNamePattern.test("Login with IAM"), true);
  assert.equal(providerEntryNamePattern.test("IAM"), true);
  assert.equal(providerEntryNamePattern.test("Office 365"), true);
  assert.equal(providerEntryNamePattern.test("Sign in"), false);
  assert.match(identityEntryAttributeSelector, /value\*="iam"/i);
});
