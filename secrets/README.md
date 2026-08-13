# Local secrets

Create these files locally or on the Synology. Never commit their contents:

- `iam_password` — the IAM password used by the browser worker;
- `worker_token` — the one-time token generated from Jarvis → Systems.

Restrict the directory and files to the account that runs Container Manager.
