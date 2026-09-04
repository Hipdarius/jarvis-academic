# Academic Jarvis

A private academic command center for Darius's final year at LAM. Jarvis reads
WebUntis, Microsoft Teams, academy.am.lu, and eduMoodle through a local browser
worker, normalizes real school items into one timeline, and routes bounded AI
tasks to the most appropriate configured provider.

Live dashboard: <https://academic-jarvis.darius-ferent.chatgpt.site>

## Current milestone: Phase 2 / connected academic intelligence

Implemented:

- real D1-backed dashboard state; there are no sample assignments or fake source
  heartbeats;
- a compact Universal Command (`Ctrl/Cmd + K`) that understands homework,
  study sessions, knowledge notes, questions, and project ideas;
- persistent homework, project canvases, and notes with an audit trail;
- configurable Universal Command fallback routing across OpenAI, Hermes Agent,
  Nous, OpenRouter, and Anthropic;
- one-time dashboard-to-worker pairing tokens stored as hashes;
- Playwright worker for WebUntis, Teams, academy.am.lu, and eduMoodle;
- opt-in automatic IAM login using Windows DPAPI or a NAS Docker secret;
- conservative source normalization with stable IDs, provenance, Luxembourg
  timezone handling, and intentionally blank uncertain dates;
- explicit Teams attention states for login, MFA, account problems, and the
  Education charter consent page;
- bounded Teams and Moodle assignment-detail traversal plus protected local
  indexing of teacher-provided files, checksums, plain text, and page-marked
  text extraction from digital PDFs;
- private dashboard file intake in R2 with format checks, SHA-256 integrity,
  deterministic current-assignment suggestions, private download, and deletion;
- leased local-worker processing for private uploads, including a second size and
  checksum verification, PDF/text/modern Office extraction, retryable status,
  and visible indexed/waiting/attention counts;
- adaptive study suggestions built only from verified, dated school items;
- the fixed terminale classique 1CI curriculum (12 courses / 31 weekly lessons)
  grouped by languages, specialization, and general education;
- subject workspaces plus a searchable Knowledge tree organized by subject,
  school year/semester, and a dynamic source-folder, chapter, and topic path;
- automatic file classification that prefers linked assignments and existing
  Teams/Moodle folders, then uses filenames and extracted text conservatively;
- assignments, source and personal files, study blocks, and query-ranked chat
  citations that retain PDF page, PowerPoint slide, and spreadsheet sheet locators;
- persistent, budgeted curator, planner, tutor, reviewer, and improver runs,
  including visible handoffs and provider/token audit data;
- optional code-agent branch preparation behind two independent approval
  gates, with scope validation in a separate worktree;
- root-level Windows setup and `jarvis` commands that never require navigating
  into `apps/worker`;
- persistent local configuration, DPAPI IAM storage, a protected worker-token
  file, headed authentication troubleshooting, and a self-recovering Windows task;
- queued on-demand syncs, 60-second worker heartbeats, bounded rotating logs,
  seven-day reliability metrics, and deduplicated deadline/source alerts;
- a deterministic Top 3 daily list plus persistent task corrections, completion,
  cancellation, dismissal, and 120-minute study-plan actions;
- Synology DS1522+ Compose foundation and ignored secret files.

Still requires live-school validation:

- Teams must pass the one-time Education charter consent before its live
  2026/27 assignment selectors and downloads can be calibrated;
- eduMoodle still needs a successful headed login on this account;
- every school portal can change markup, so failed selectors surface as
  attention or partial extraction instead of invented records;
- Samsung Notes ingestion is not available through a stable public API and
  needs a deliberate export/share workflow;
- portal uploads and submissions remain disabled until a preview,
  approval-and-receipt flow is built and tested; dashboard staging is live;
- scanned-image PDF and image OCR are not implemented yet; legacy Office and
  OpenDocument formats remain stored without fabricated extraction.

## Security model

There are four separate credential classes:

1. **IAM password:** stays on the HP or NAS worker. It is never stored in D1,
   sent to an AI model, printed in logs, or committed.
2. **Worker token:** created in Jarvis > Systems, shown once, and stored locally.
   D1 stores only its SHA-256 hash.
3. **Sites bypass token:** passes the private Sites sign-in gate for worker API
   calls. Jarvis still verifies the separate worker token before accepting data.
4. **AI API keys:** server/worker secrets only. They never belong in browser
   JavaScript.

Automatic password login is explicitly enabled with
`JARVIS_ALLOW_PASSWORD_LOGIN=true`. Credentials are entered only on exact
allowlisted IAM, Microsoft, LAM Academy, eduMoodle, and LAM WebUntis hosts. If a
one-time code, authenticator prompt, or legal consent appears, the worker
reports an attention state instead of bypassing it. Jarvis never accepts a
school charter or consent screen for you.

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
- `sites_bypass_token` contains the private Sites API bypass with a user-only ACL;
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

For WebUntis and Moodle, Jarvis selects the `IAM` identity-provider option even
when the portal also shows local username/password fields. On the separate SSL
Education page it submits the IAM username, waits for the password step, then
submits the password. For Microsoft 365 it first submits `<IAM username>@school.lu`
at Microsoft, follows the redirect, and performs the same two-step IAM login.
The password is filled only on exact Education IAM hosts (`auth.education.lu`,
`iam.auth.education.lu`, and the documented IAM aliases), never on Microsoft,
WebUntis, or a local Moodle form. If automatic authentication needs
troubleshooting, headed mode pauses for you to complete MFA, consent, or an
unfamiliar provider screen before it verifies the school page. Manual login
is also available with `.\scripts\jarvis.ps1 login webuntis`.

### Connect and sync the four school sources

Run these commands from the repository root. The same persistent browser
profile is reused, so completed logins survive normal worker restarts.

1. In Jarvis > Systems, create a one-time worker token. Store it through the
   hidden prompt with `.\scripts\jarvis.ps1 token`.
2. Run `.\scripts\jarvis.ps1 credentials` and enter the IAM username and
   password only in the native Windows credential dialog.
3. Authenticate WebUntis with
   `.\scripts\jarvis.ps1 auth webuntis -Headed`.
4. Authenticate academy Moodle with
   `.\scripts\jarvis.ps1 auth academy -Headed`.
5. Authenticate Teams with `.\scripts\jarvis.ps1 auth teams -Headed`. Jarvis
   enters the `@school.lu` email at Microsoft, follows the Education redirect,
   and completes the IAM username/password steps. If the Education charter is
   shown, read and accept it yourself, then return to PowerShell and press
   Enter. Jarvis deliberately cannot accept legal consent.
6. Authenticate eduMoodle with
   `.\scripts\jarvis.ps1 auth edumoodle -Headed` and complete any unfamiliar
   portal step in the visible browser.
7. Verify and publish current data with:

```powershell
.\scripts\jarvis.ps1 health all
.\scripts\jarvis.ps1 sync all
```

Refresh the dashboard after the sync completes. A source marked `Attention`
needs another headed authentication pass; an empty healthy source means the
extractor found no qualifying current records and does not fabricate any.

Start the worker in the current terminal, or install a current-user Task
Scheduler entry that starts immediately and at Windows sign-in, retries five
times after a crash, and checks every 15 minutes that the daemon still exists:

```powershell
.\scripts\jarvis.ps1 start
.\scripts\jarvis.ps1 install
.\scripts\jarvis.ps1 status
```

Remove only the automatic-start task with `.\scripts\jarvis.ps1 uninstall`.
This does not delete credentials, browser sessions, or school data. The daemon
checks school sources every 30 minutes, listens for dashboard sync requests
every 15 seconds, publishes a heartbeat every 60 seconds, and rotates five
5 MB worker logs. AI output is capped at 1,500 tokens per job and the hosted
queue claims at most 20 jobs per Luxembourg day.

Real source changes queue one bounded curator -> planner -> reviewer run by
default. Set `JARVIS_AGENT_AUTO_TRIAGE=false` in the private worker environment
to keep synchronization running without proactive academic agents.

## How the worker and AI fit together

The local Node worker is the orchestrator and credential boundary, not a single
always-running model. Its main flow is:

1. Playwright uses the persistent browser profile to read allowlisted school
   sites. IAM credentials and cookies stay inside that local browser boundary.
2. Source adapters turn visible WebUntis, Teams, and Moodle evidence into the
   shared academic schema. Uncertain dates and assignments remain blank rather
   than being guessed.
3. Teacher files are downloaded automatically into protected local storage,
   checksummed, and text-extracted when supported. Their Teams/Moodle course and
   section path is preserved for subject/topic organization. Digital PDFs retain
   page markers, PowerPoints retain slide markers, and spreadsheets retain sheet
   names and cell labels.
4. Files added through Knowledge stay in private R2. The worker claims them with
   a short-lived lease, verifies size and SHA-256 again, and returns only bounded
   extracted text and processing metadata.
5. The worker publishes bounded records and excerpts to the private dashboard.
   The original downloaded school-file bytes remain local.
6. D1 queues bounded curator, planner, tutor, reviewer, improver, or coder jobs.
   The worker claims each job and routes it through the configured provider
   chain. Without an API key it returns a limited deterministic local result;
   no hidden model runs on the laptop.

OpenAI, Anthropic, Nous, OpenRouter, and an isolated OpenAI-compatible Hermes
gateway are interchangeable provider routes. They receive only the evidence
needed for a job, never the IAM password, browser cookies, or credential files.

## Moodle and document coverage

For each current Moodle course, the connector discovers structured activity
modules, follows assignment details, reads due/submission rows, and downloads
bounded course resources and teacher attachments from the same allowlisted
Moodle host. Archived courses are deprioritized unless they contain recent
work. Selector failures produce warnings and attention states instead of fake
tasks.

Digital PDFs, plain-text formats, DOCX, PPTX, and XLSX can now be parsed locally
for subject chat and agent citations. The modern Office path validates the
declared package type and bounds archive entries, decompressed bytes, and
compression ratios before strict XML parsing. Jarvis ranks bounded excerpts
against each question and keeps PDF page, PowerPoint slide, and spreadsheet
sheet locators in the citation record. The same processing applies to files
added through Knowledge. Jarvis sorts files under the 1CI subject catalog using
assignment and source-folder evidence first, then filename and extracted text;
uncertain files remain visibly `General / Unclassified` instead of being guessed.
A scanned PDF can still contain no machine-readable text. OCR, diagrams,
handwriting, legacy Office formats, and OpenDocument extraction remain separate
document-intelligence steps. Jarvis stores those files and labels them `stored
only`; it does not claim to understand content it did not extract.

Individual setup pieces can be repeated safely with
`.\scripts\jarvis.ps1 credentials`, `.\scripts\jarvis.ps1 token`, and
`.\scripts\jarvis.ps1 sites-token`. Stored URLs
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
.\scripts\jarvis.ps1 uploads
.\scripts\jarvis.ps1 jobs
```

`uploads` processes up to ten waiting private files without running a school
sync. It never submits a file to Teams or Moodle.

Provider failures automatically fall through the configured route. Only
normalized, redacted item fields are sent during automatic triage; IAM
credentials and browser cookies never enter a model prompt.

### Agent coordination and controlled improvements

On each real sync change, Jarvis can run a bounded curator -> planner ->
reviewer handoff. Subject chat uses a separate tutor run and cites the indexed
assignment, document, and note records supplied to it. Systems shows every run,
message, provider, model, budget, and result so autonomous work stays visible.

Repeated connector warnings may create an improvement proposal. Nothing edits
code until you confirm `Prepare branch` in Systems and set
`JARVIS_AGENT_CODE_ENABLED=true` on the local worker. Even then the coder can
only modify the approved file scope in a new `agent/*` worktree and cannot
execute generated code, push, merge, deploy, or use IAM/browser secrets. Static
diff checks run automatically; review and test that branch before merging it
manually. A future OS-isolated runner can add automatic execution safely.

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

Hermes remains disabled until Systems shows at least 95% successful scheduled
reads for seven days and fresh-data age stays below 45 minutes at the 95th
percentile. Prepare its isolated NAS volume without starting the gateway:

```bash
docker compose --profile hermes run --rm hermes setup --portal
docker compose --profile hermes run --rm hermes tools disable terminal file browser code_execution delegation messaging cronjob
docker compose --profile hermes run --rm hermes tools list
```

The final command is a required capability check: each listed powerful toolset
must report disabled before startup. Then set a random `HERMES_API_SERVER_KEY`,
bind `HERMES_LAN_BIND_IP` to the NAS private-LAN address, and allow port 8642
only from the HP in the NAS firewall. The Compose profile mounts only
`hermes-data`; it receives no school files, browser state, repositories, Docker
socket, or Jarvis credentials.

After the seven-day gate passes, start and verify the private gateway:

```bash
docker compose --profile hermes up -d hermes
curl -H "Authorization: Bearer $HERMES_API_SERVER_KEY" http://127.0.0.1:8642/health
```

Configure the HP worker with the NAS `/v1` URL and a protected
`JARVIS_HERMES_API_KEY_FILE`. Keep Hermes out of the provider routes until its
20-question, four-subject citation evaluation passes.

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

Reading, indexing, planning, research, summaries, draft generation, and private
dashboard staging may run without changing a school system. Uploading or
replacing assessed work, sending a message, or submitting to Teams/Moodle will
require a clear preview, explicit action-time confirmation, post-action portal
verification, and a timestamped receipt. The worker currently performs no
school uploads or submissions.
