export const identityEntryNamePattern = /office\s*365|microsoft|\biam\b|single sign.on|sso|sign in|log in|anmelden|connexion/i;

export const providerEntryNamePattern = /office\s*365|microsoft|\biam\b|single sign.on|sso|authentication with username and password/i;

export const identityEntryAttributeSelector = [
  'input[type="button"][value*="iam" i]',
  'input[type="submit"][value*="iam" i]',
  'button[name$=":auth:iam" i]',
  '[aria-label*="iam" i]',
  '[title*="iam" i]',
].join(", ");
