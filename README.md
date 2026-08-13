# Academic Jarvis

A private academic command center for Darius's final year at LAM. Jarvis reads
WebUntis, Microsoft Teams, academy.am.lu, and eduMoodle through a local browser
worker, normalizes real school items into one timeline, and routes bounded AI
tasks to the most appropriate configured provider.

Live dashboard: <https://academic-jarvis.darius-ferent.chatgpt.site>

## Current milestone: Phase 1 / Windows setup

Implemented:

- real D1-backed dashboard state—there are no sample assignments or fake source
  heartbeats;
- a compact Universal Command (`Ctrl/Cmd + K`) that understands homework,
  study sessions, knowledge notes, questions, and project ideas;
- persistent homework, project canvases, and notes with an audit trail;
- configurable Universal Command fallback routing across OpenAI, Hermes Agent,
  Nous, OpenRouter, and Anthropic;
- one-time dashboard-to-worker pairing tokens stored as hashes;
- Playwright worker for WebUntis, Teams, academy.am.lu, and eduMoodle;
- opt-in automatic IAM login using Windows DPAPI or a NAS Docker secret;
- conservative source normalization: only recognizable school task/test rows are
  published, and uncertain dates remain blank;
- provider routing for triage, planning, research, and review jobs;
- a persistent agent queue: dashboard questions and project ideas are claimed
  by the HP/NAS worker and their results return to the Systems page;
- root-level Windows setup and `jarvis` commands that never require navigating
  into `apps/worker`;
- persistent local configuration, DPAPI IAM storage, a protected worker-token
  file, headed authentication troubleshooting, and an optional logon task;
- Synology DS1522+ Compose foundation and ignored secret files.

Still requires live-school validation:

- each extractor must be calibrated against the authenticated 2026/27 pages;
- Teams file download and document indexing are not implemented yet;
- Samsung Notes ingestion is not available through a stable public API and
  needs a deliberate export/share workflow;
- uploads and submissions remain disabled until an approval-and-receipt flow is
  built and tested.

## Security model

There are three separate credential classes:

1. **IAM password:** stays on the HP or NAS worker. It is never stored in D1,
   sent to an AI model, printed in logs, or committed.
2. **Worker token:** created in Jarvis → Systems, shown once, and stored locally.
   D1 stores only its SHA-256 hash.
3. **AI API keys:** server/worker secrets only. They never belong in browser
   JavaScript.

Automatic password login is explicitly enabled with
`JARVIS_ALLOW_PASSWORD_LOGIN=true`. Credentials are entered only on exact
allowlisted IAM, Microsoft, LAM Academy, eduMoodle, and LAM WebUntis hosts. If a
one-time code or authenticator prompt appears, the worker reports
`mfa_required` instead of attempting to bypass it.

Never commit browser profiles, cookies, passwords, API keys, pairing tokens,
exported school files, or personal notes.

## Windows setup on the HP laptop

Requirements: Node.js 22.13+, Git, and PowerShell.

```powershell
git clone https://github.com/Hipdarius/jarvis-academic.git
cd jarvis-academic
.\scripts\setup-windows.ps1
```

The setup script finds the repository root itself, verifies Node, installs the
worker and Playwright Chromium, creates private folders, opens the native
Windows IAM credential prompt, and accepts the one-time worker token through a
hidden prompt. Create that token first in Jarvis > Systems. Do not put the IAM
password or worker token on a command line.

Local files are kept under `%LOCALAPPDATA%\AcademicJarvis` by default:

- `worker.env` contains non-secret paths and settings;
- `iam-credential.dpapi.json` contains the Windows-user-bound DPAPI cipher;
- `worker_token` contains the dashboard pairing token with a user-only ACL;
- `browser-profile`, `school-files`, `work`, and `logs` contain runtime data.

Run the diagnostic from the repository root at any time:

```powershell
.\scripts\jarvis.ps1 doctor
```

The diagnostic checks Node 22.13+, installed dependencies, the actual Chromium
executable, private folders, dashboard/token/IAM configuration, AI-provider
availability, and public reachability for the dashboard and four school entry
points. It prints only status and paths, never secret values.

Bootstrap WebUntis in a visible browser so MFA or an unfamiliar page can be
completed safely:

```powershell
.\scripts\jarvis.ps1 auth webuntis -Headed
.\scripts\jarvis.ps1 health all
.\scripts\jarvis.ps1 sync webuntis
```

For WebUntis, Jarvis selects the `IAM` identity-provider option and follows its
separate SSL Education login window. Credentials are filled only after the
destination matches an exact allowlisted host. If automatic authentication
needs troubleshooting, headed mode pauses for you to complete MFA, consent, or
an unfamiliar provider screen before it verifies the school page. Manual login
is also available with `.\scripts\jarvis.ps1 login webuntis`.

Start the worker in the current terminal, or install a current-user Task
Scheduler entry that starts at Windows sign-in:

```powershell
.\scripts\jarvis.ps1 start
.\scripts\jarvis.ps1 install
.\scripts\jarvis.ps1 status
```

Remove only the automatic-start task with `.\scripts\jarvis.ps1 uninstall`.
This does not delete credentials, browser sessions, or school data. The daemon
checks school sources every 30 minutes and the agent queue every 60 seconds by
default.

Individual setup pieces can be repeated safely with
`.\scripts\jarvis.ps1 credentials` and `.\scripts\jarvis.ps1 token`. Stored URLs
lose query strings and fragments; common email, token, and long identifier
patterns are redacted.

## Connect AI providers

Jarvis does not require a monthly AI subscription. Add pay-as-you-go API keys
only for the providers you want. Model names are configuration because provider
catalogs change. On hosted deployments, configure provider values as platform
secrets. On the local worker, you can point each key at a protected file with
the matching `*_FILE` variable.

```dotenv
# Cheap command routing / planning
OPENAI_API_KEY=...
JARVIS_COMMAND_MODEL=gpt-5.6-luna

# Optional alternatives
NOUS_API_KEY=...
NOUS_MODEL=provider-model-id
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=provider/model-id
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=provider-model-id

# Ordered fallback chains
JARVIS_AGENT_ROUTE_TRIAGE=nous,openrouter,openai,hermes
JARVIS_AGENT_ROUTE_PLANNING=openai,anthropic,hermes,openrouter,nous
JARVIS_AGENT_ROUTE_REVIEW=anthropic,openai,hermes,openrouter
```

For private local worker key files on Windows:

```powershell
$env:OPENAI_API_KEY_FILE = "$env:LOCALAPPDATA\AcademicJarvis\openai_key"
$env:NOUS_API_KEY_FILE = "$env:LOCALAPPDATA\AcademicJarvis\nous_key"
$env:OPENROUTER_API_KEY_FILE = "$env:LOCALAPPDATA\AcademicJarvis\openrouter_key"
$env:ANTHROPIC_API_KEY_FILE = "$env:LOCALAPPDATA\AcademicJarvis\anthropic_key"
```

The Windows worker loads `%LOCALAPPDATA%\AcademicJarvis\worker.env`
automatically. Put only key-file paths there, then keep each key in its own
user-protected local file. Check configuration without sending school content:

```powershell
.\scripts\jarvis.ps1 providers
```

Run one bounded task:

```powershell
.\scripts\jarvis.ps1 agent planning "Build a study sequence from these confirmed topics: ..."
```

Process queued dashboard jobs immediately (the daemon also does this after each
source-sync cycle):

```powershell
.\scripts\jarvis.ps1 jobs
```

Provider failures automatically fall through the configured route. Only
normalized, redacted item fields are sent during automatic triage; IAM
credentials and browser cookies never enter a model prompt.

### Hermes Agent

Hermes Agent exposes an OpenAI-compatible HTTP gateway. Run it as a separate,
isolated service and point Jarvis at its `/v1` endpoint:

```dotenv
JARVIS_HERMES_BASE_URL=http://hermes:8642/v1
JARVIS_HERMES_API_KEY=a-separate-long-random-gateway-key
JARVIS_HERMES_MODEL=hermes-agent
```

Use either `JARVIS_HERMES_API_KEY` or `JARVIS_HERMES_API_KEY_FILE` on the
worker; do not set both unless they contain the same gateway key.

Do **not** mount the IAM password, browser profile, worker token, or school-file
directory into the Hermes container. Hermes can have powerful tools; isolation
keeps those tools outside the credential boundary.

## Synology DS1522+

Create private files before starting the optional worker profile:

```text
secrets/iam_password
secrets/worker_token
```

Restrict DSM permissions so only the Container Manager service account and your
administrator account can read that directory. Put the username and explicit
opt-in in the private project environment:

```dotenv
JARVIS_IAM_USERNAME=your-login@school.lu
JARVIS_ALLOW_PASSWORD_LOGIN=true
POSTGRES_PASSWORD=a-long-random-password
```

Start the data service, then the browser worker:

```bash
docker compose up -d postgres
docker compose --profile nas-worker up -d --build worker
```

Do not expose PostgreSQL, Playwright, or Hermes directly to the public internet.
The worker needs outbound HTTPS; D1 ingestion is authenticated with the hashed
worker token.

## Repository layout

```text
app/                       Dashboard, APIs, provider router
apps/worker/               IAM browser worker, normalization, agent routes
db/                        D1 schema and persistence
drizzle/                   D1 migrations
packages/core/             Shared academic and command models
compose.yaml               Synology runtime
secrets/                   Ignored local secret files
```

## GitHub and hosted deployment

`origin` (`Hipdarius/jarvis-academic`) is the authoritative GitHub source. The
ChatGPT Site has a separate source repository and deployment version, so a
GitHub push does not by itself redeploy the dashboard. For each release, verify
that the GitHub commit and deployed Sites checkpoint have the same source tree,
then confirm the live URL reports a successful deployment. Keep the prior
working Site version available for rollback.

## Development and verification

```bash
npm install
npm run lint
npm run test:router
npm run test:setup
npm --prefix apps/worker test
npm test
```

## School-action boundary

Reading, indexing, planning, research, summaries, and draft generation may run
automatically. Uploading or replacing assessed work, sending a message, or
submitting to Teams/Moodle will require a clear preview, explicit confirmation,
and a timestamped receipt. The worker currently performs no submissions.
