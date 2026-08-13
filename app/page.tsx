"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCopy,
  Clock3,
  Command,
  CornerDownLeft,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Unplug,
  X,
  type LucideIcon,
} from "lucide-react";

import type { CommandIntent } from "@/packages/core/src/command-router";
import type {
  DashboardItem,
  DashboardSource,
  DashboardState,
} from "@/packages/core/src/dashboard";

type NavItem = { label: string; icon: LucideIcon };
type CommandResponse = CommandIntent & { stored: boolean; queuedJobId: string | null };

const commandExamples = [
  "Algebra book exercises 4–8 for Friday",
  "What if I built a CubeSat radiation monitor?",
  "Study SQL normalization for 30 minutes tomorrow",
];

const navItems: NavItem[] = [
  { label: "Today", icon: LayoutDashboard },
  { label: "Planner", icon: CalendarDays },
  { label: "Subjects", icon: BookOpen },
  { label: "Knowledge", icon: BrainCircuit },
  { label: "Projects", icon: FolderKanban },
  { label: "Systems", icon: Gauge },
];

const providerNames: Record<CommandIntent["provider"], string> = {
  openai: "OpenAI",
  hermes: "Hermes Agent",
  nous: "Nous Portal",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  local: "local safety router",
};

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function itemDate(item: DashboardItem) {
  const value = item.dueAt ?? item.startsAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatItemDate(item: DashboardItem) {
  const date = itemDate(item);
  if (!date) return item.dueLabel ?? "Date not confirmed";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: item.startsAt ? "2-digit" : undefined,
    minute: item.startsAt ? "2-digit" : undefined,
  }).format(date);
}

function relativeSourceDetail(source: DashboardSource) {
  if (!source.lastSuccessAt) return source.detail;
  const date = new Date(source.lastSuccessAt);
  if (Number.isNaN(date.getTime())) return source.detail;
  return `Last read ${new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}

function sourceTone(status: DashboardSource["status"]) {
  if (status === "healthy") return "live";
  if (status === "error") return "error";
  if (status === "attention") return "attention";
  return "idle";
}

function SourceMark({ source }: { source: DashboardSource }) {
  return <span className={`source-mark ${sourceTone(source.status)}`} aria-hidden="true" />;
}

function EmptyState({
  icon: Icon,
  title,
  copy,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  copy: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="collection-empty honest-empty">
      <Icon size={27} />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action && onAction ? <button onClick={onAction} type="button">{action}</button> : null}
    </div>
  );
}

export default function Home() {
  const [activeSection, setActiveSection] = useState("Today");
  const [state, setState] = useState<DashboardState | null>(null);
  const [stateError, setStateError] = useState("");
  const [stateLoading, setStateLoading] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandPending, setCommandPending] = useState(false);
  const [commandResult, setCommandResult] = useState<CommandResponse | null>(null);
  const [commandError, setCommandError] = useState("");
  const [pairPending, setPairPending] = useState(false);
  const [pairToken, setPairToken] = useState("");
  const [pairError, setPairError] = useState("");
  const [copied, setCopied] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);

  const loadState = useCallback(async () => {
    setStateLoading(true);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = await response.json() as DashboardState;
      setState(payload);
      setStateError(payload.mode === "database_unavailable"
        ? "The live database is not available in this environment. No sample data has been substituted."
        : "");
    } catch {
      setState(null);
      setStateError("Jarvis could not load the live database. No sample data has been substituted.");
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadState(); }, 0);
    const clockLoad = window.setTimeout(() => setCurrentDate(new Date()), 0);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearTimeout(clockLoad);
    };
  }, [loadState]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandText("");
        setCommandResult(null);
        setCommandError("");
        setCommandOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const activeItems = useMemo(
    () => (state?.items ?? [])
      .filter((item) => item.status !== "done" && item.status !== "cancelled")
      .sort((a, b) => (itemDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (itemDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER)),
    [state],
  );
  const todayItems = activeItems.filter((item) => {
    const date = itemDate(item);
    return date && currentDate ? dateKey(date) === dateKey(currentDate) : false;
  });
  const nextDeadline = activeItems.find((item) => itemDate(item)) ?? activeItems[0] ?? null;
  const healthySources = (state?.sources ?? []).filter((source) => source.status === "healthy").length;
  const subjectGroups = useMemo(() => {
    const grouped = new Map<string, DashboardItem[]>();
    for (const item of state?.items ?? []) grouped.set(item.subject, [...(grouped.get(item.subject) ?? []), item]);
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  function openCommand(prefill = "") {
    setCommandText(prefill);
    setCommandResult(null);
    setCommandError("");
    setCommandOpen(true);
  }

  async function runCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text || commandPending) return;
    setCommandPending(true);
    setCommandError("");
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json() as CommandResponse | { error?: string };
      if (!response.ok || !("action" in payload)) {
        throw new Error("error" in payload ? payload.error : "Jarvis could not route that command.");
      }
      setCommandResult(payload);
      if (payload.stored) await loadState();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "Jarvis could not route that command.");
    } finally {
      setCommandPending(false);
    }
  }

  function openCommandResult() {
    if (!commandResult) return;
    if (commandResult.action === "create_project_canvas") setActiveSection("Projects");
    else if (commandResult.action === "create_knowledge_note") setActiveSection("Knowledge");
    else setActiveSection("Planner");
    setCommandOpen(false);
  }

  async function createPairToken() {
    if (pairPending || pairToken) return;
    setPairPending(true);
    setPairError("");
    try {
      const response = await fetch("/api/system/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Darius school worker" }),
      });
      const payload = await response.json() as { token?: string; error?: string };
      if (!response.ok || !payload.token) throw new Error(payload.error ?? "Could not create a worker token.");
      setPairToken(payload.token);
    } catch (error) {
      setPairError(error instanceof Error ? error.message : "Could not create a worker token.");
    } finally {
      setPairPending(false);
    }
  }

  async function copyPairToken() {
    if (!pairToken) return;
    await navigator.clipboard.writeText(pairToken);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  function renderToday() {
    const totalSources = state?.sources.length || 4;
    const greeting = !currentDate ? "Welcome back" : currentDate.getHours() < 12 ? "Good morning" : currentDate.getHours() < 18 ? "Good afternoon" : "Good evening";
    return (
      <>
        <section className="welcome-row">
          <div>
            <p className="eyebrow">{currentDate ? new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(currentDate).toUpperCase() : "ACADEMIC COMMAND CENTER"}</p>
            <h1>{greeting}, Darius.</h1>
            <p className="welcome-copy">
              {stateLoading
                ? "Loading your academic system…"
                : healthySources
                  ? `${healthySources} of ${totalSources} school sources are reporting live data.`
                  : "No school source has completed its first verified sync yet."}
            </p>
          </div>
          <div className="day-score honest-score">
            <span className="score-ring">{healthySources}/{totalSources}</span>
            <span><strong>Sources live</strong><small>{activeItems.length} open items</small></span>
          </div>
        </section>

        {stateError ? (
          <div className="truth-banner"><AlertTriangle size={17} /><span>{stateError}</span><button onClick={() => void loadState()} type="button">Retry</button></div>
        ) : null}

        <section className={`focus-card ${nextDeadline ? "" : "focus-empty"}`}>
          <div className="focus-glow" />
          <div className="focus-icon">{nextDeadline ? <Sparkles size={20} /> : <Unplug size={20} />}</div>
          <div className="focus-copy">
            <span className="eyebrow light">{nextDeadline ? "NEXT VERIFIED ITEM" : "WAITING FOR FIRST SYNC"}</span>
            <h2>{nextDeadline ? nextDeadline.title : "Connect the IAM browser worker to begin."}</h2>
            <p>{nextDeadline
              ? `${nextDeadline.subject} · ${nextDeadline.source} · ${formatItemDate(nextDeadline)} · ${nextDeadline.evidence} evidence`
              : "Jarvis will not invent a schedule. Once the worker reads WebUntis, Teams, and Moodle, real assignments will appear here."}</p>
            {nextDeadline ? (
              <div className="focus-tags">
                <span><Clock3 size={14} /> {formatItemDate(nextDeadline)}</span>
                <span><FileText size={14} /> {nextDeadline.source}</span>
                <span><ShieldCheck size={14} /> {nextDeadline.confidence}% confidence</span>
              </div>
            ) : null}
          </div>
          <button className="focus-action" onClick={() => nextDeadline ? setActiveSection("Planner") : setActiveSection("Systems")} type="button">
            {nextDeadline ? <ChevronRight size={18} /> : <KeyRound size={18} />}
            {nextDeadline ? "Open in planner" : "Set up worker"}
          </button>
        </section>

        <section className="metric-grid" aria-label="Today at a glance">
          <article className="metric-card"><span className="metric-icon indigo"><ListTodo size={19} /></span><div><strong>{todayItems.length}</strong><span>due today</span></div><small>Verified or manually captured</small></article>
          <article className="metric-card"><span className="metric-icon emerald"><CalendarDays size={19} /></span><div><strong>{activeItems.length}</strong><span>open items</span></div><small>Across every connected source</small></article>
          <article className="metric-card"><span className="metric-icon amber"><ShieldCheck size={19} /></span><div><strong>{healthySources}</strong><span>healthy sources</span></div><small>No fixture connectors</small></article>
        </section>

        <div className="dashboard-grid">
          <section className="panel agenda-panel">
            <div className="panel-heading"><div><span className="eyebrow">REAL DATA ONLY</span><h2>Open work</h2></div><button onClick={() => setActiveSection("Planner")} type="button">Open planner <ArrowRight size={15} /></button></div>
            {activeItems.length ? (
              <div className="timeline">
                {activeItems.slice(0, 7).map((item, index) => (
                  <article className="timeline-item" key={item.id}>
                    <div className="time-column"><strong>{item.dueAt ? "Due" : item.startsAt ? "Starts" : "Inbox"}</strong><small>{formatItemDate(item)}</small></div>
                    <div className="timeline-rail"><span className={item.type === "test" ? "captured-dot" : item.type === "personal" ? "study" : "focus"} />{index < Math.min(activeItems.length, 7) - 1 ? <i /> : null}</div>
                    <div className="timeline-copy"><span>{item.subject} · {item.source}</span><h3>{item.title}</h3></div>
                    <button aria-label={`Open ${item.title}`} onClick={() => setActiveSection("Planner")} type="button"><ChevronRight size={18} /></button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="panel-empty"><Database size={23} /><h3>No academic items yet</h3><p>Run the IAM worker or capture something with Universal Command.</p></div>
            )}
          </section>

          <aside className="right-column">
            <section className="panel deadlines-panel">
              <div className="panel-heading compact"><div><span className="eyebrow">UPCOMING</span><h2>Deadlines</h2></div><span className="health-pill neutral">{activeItems.filter((item) => item.dueAt).length} known</span></div>
              {activeItems.some((item) => item.dueAt) ? (
                <div className="deadline-list">
                  {activeItems.filter((item) => item.dueAt).slice(0, 4).map((item) => {
                    const date = itemDate(item)!;
                    return <article className="deadline-item" key={item.id}><div className="date-tile blue"><small>{new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).toUpperCase()}</small><strong>{date.getDate()}</strong></div><div><h3>{item.title}</h3><p>{item.subject} · {item.source}</p></div></article>;
                  })}
                </div>
              ) : <div className="micro-empty">No verified deadlines yet.</div>}
            </section>

            <section className="panel sources-panel">
              <div className="panel-heading compact"><div><span className="eyebrow">CONNECTORS</span><h2>Source health</h2></div><span className="health-pill">{healthySources} / {state?.sources.length || 4} live</span></div>
              <div className="source-list">
                {(state?.sources ?? []).map((source) => <div className="source-item" key={source.id}><SourceMark source={source} /><strong>{source.name}</strong><span>{relativeSourceDetail(source)}</span></div>)}
                {!state?.sources.length ? <div className="micro-empty">Waiting for live source records.</div> : null}
              </div>
              <button className="reauth-button" onClick={() => setActiveSection("Systems")} type="button"><Settings2 size={16} /> Configure local worker</button>
            </section>
          </aside>
        </div>
      </>
    );
  }

  function renderPlanner() {
    return (
      <section className="collection-page">
        <div className="collection-heading"><div><p className="eyebrow">UNIFIED SCHOOL INBOX</p><h1>Planner</h1><p>WebUntis, Teams, both Moodles, and manual commands—sorted without sample entries.</p></div><button onClick={() => openCommand()} type="button"><Plus size={17} /> Capture work</button></div>
        {activeItems.length ? <div className="work-list">{activeItems.map((item) => <article className="work-card" key={item.id}><span className={`work-type ${item.type}`}>{item.type.replace("_", " ")}</span><div><span className="eyebrow">{item.subject} · {item.source}</span><h2>{item.title}</h2><p>{item.description ?? `${item.evidence} evidence · ${item.confidence}% confidence`}</p></div><div className="work-date"><strong>{formatItemDate(item)}</strong><small>{item.status}</small></div></article>)}</div> : <EmptyState icon={ListTodo} title="The planner is empty" copy="That means Jarvis has not received any verified school item or manual command yet." action="Open worker setup" onAction={() => setActiveSection("Systems")} />}
      </section>
    );
  }

  function renderSubjects() {
    return (
      <section className="collection-page">
        <div className="collection-heading"><div><p className="eyebrow">KNOWLEDGE BY COURSE</p><h1>Subjects</h1><p>Subjects appear automatically from imported work and files.</p></div></div>
        {subjectGroups.length ? <div className="canvas-grid">{subjectGroups.map(([subject, items]) => <article className="canvas-card subject-card" key={subject}><span className="canvas-icon"><GraduationCap size={20} /></span><span className="eyebrow">{items.length} ITEM{items.length === 1 ? "" : "S"}</span><h2>{subject}</h2><p>{items.filter((item) => item.status !== "done").length} open · {new Set(items.map((item) => item.source)).size} source{new Set(items.map((item) => item.source)).size === 1 ? "" : "s"}</p></article>)}</div> : <EmptyState icon={GraduationCap} title="No subjects indexed yet" copy="The first worker sync will build this list from actual school data." />}
      </section>
    );
  }

  function renderProjects() {
    const projects = state?.projects ?? [];
    return (
      <section className="collection-page">
        <div className="collection-heading"><div><p className="eyebrow">IDEAS → ACTION</p><h1>Project canvases</h1><p>Brainstorms captured in Universal Command become persistent canvases.</p></div><button onClick={() => openCommand("What if I built ")} type="button"><Plus size={17} /> New idea</button></div>
        {projects.length ? <div className="canvas-grid">{projects.map((project) => <article className="canvas-card" key={project.id}><span className="canvas-icon"><Lightbulb size={20} /></span><span className="eyebrow">{project.status.toUpperCase()} · {project.subject.toUpperCase()}</span><h2>{project.title}</h2><p>{project.brief}</p><div className="canvas-footer"><span>Stored in Jarvis</span><button type="button">Open canvas <ArrowRight size={14} /></button></div></article>)}</div> : <EmptyState icon={Lightbulb} title="No project canvases yet" copy="Describe a hypothetical project naturally; Jarvis will recognize it and create the canvas." action="Brainstorm an idea" onAction={() => openCommand(commandExamples[1])} />}
      </section>
    );
  }

  function renderKnowledge() {
    const notes = state?.notes ?? [];
    return (
      <section className="collection-page">
        <div className="collection-heading"><div><p className="eyebrow">PERSONAL KNOWLEDGE</p><h1>Knowledge notes</h1><p>Teacher remarks and facts captured through Universal Command.</p></div><button onClick={() => openCommand("Remember this: ")} type="button"><Plus size={17} /> New note</button></div>
        {notes.length ? <div className="canvas-grid">{notes.map((note) => <article className="canvas-card note-card" key={note.id}><span className="canvas-icon"><NotebookPen size={20} /></span><span className="eyebrow">{note.subject.toUpperCase()}</span><h2>{note.title}</h2><p>{note.body}</p></article>)}</div> : <EmptyState icon={NotebookPen} title="No knowledge notes yet" copy="Say “Remember this…” and Jarvis will save the note under the inferred subject." />}
      </section>
    );
  }

  function renderSystems() {
    const sources = state?.sources ?? [];
    const providers = state?.providers ?? [];
    return (
      <section className="collection-page systems-page">
        <div className="collection-heading"><div><p className="eyebrow">LOCAL SECRETS · CLOUD INTELLIGENCE</p><h1>Systems</h1><p>Pair your worker, inspect source health, and see which AI routes are actually configured.</p></div><button className="refresh-button" onClick={() => void loadState()} type="button"><RefreshCw size={16} className={stateLoading ? "spin" : ""} /> Refresh</button></div>

        <div className="systems-grid">
          <article className="system-card credential-card">
            <span className="system-icon green"><LockKeyhole size={21} /></span><span className="eyebrow">IAM CREDENTIAL BOUNDARY</span><h2>Your password stays on your worker</h2>
            <p>Jarvis stores the IAM password in Windows DPAPI on the HP or in a Docker secret file on your NAS. It is entered only on approved IAM/Microsoft identity hosts and is never sent to an AI model or this dashboard.</p>
            <div className="security-rule"><ShieldCheck size={16} /><span>Automatic password login is opt-in. MFA pauses for you if IAM requests it.</span></div>
          </article>

          <article className="system-card pair-card">
            <span className="system-icon purple"><KeyRound size={21} /></span><span className="eyebrow">WORKER PAIRING</span><h2>Connect the HP or Synology</h2>
            <p>Create a one-time token, save it locally as the worker secret, then run the browser worker. The token can publish normalized items; it cannot read your IAM password.</p>
            {pairToken ? <div className="token-box"><code>{pairToken}</code><button aria-label="Copy worker token" onClick={() => void copyPairToken()} type="button">{copied ? <Check size={16} /> : <ClipboardCopy size={16} />}</button></div> : <button className="primary-system-action" disabled={pairPending} onClick={() => void createPairToken()} type="button">{pairPending ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}{pairPending ? "Creating…" : "Create one-time worker token"}</button>}
            {pairToken ? <p className="token-warning">Shown once. Save it with <code>.\scripts\jarvis.ps1 token</code>; do not paste it into chat or GitHub.</p> : null}
            {pairError ? <p className="command-error">{pairError}</p> : null}
          </article>
        </div>

        <div className="systems-grid lower">
          <section className="panel systems-panel"><div className="panel-heading compact"><div><span className="eyebrow">SCHOOL SOURCES</span><h2>Browser worker status</h2></div><span className="health-pill">{sources.filter((source) => source.status === "healthy").length} / {sources.length || 4} live</span></div><div className="system-status-list">{sources.map((source) => <div className="system-status" key={source.id}><SourceMark source={source} /><div><strong>{source.name}</strong><small>{relativeSourceDetail(source)}</small></div><span className={`status-chip ${sourceTone(source.status)}`}>{source.status}</span></div>)}{!sources.length ? <div className="micro-empty">No worker heartbeat has reached D1 yet.</div> : null}</div></section>
          <section className="panel systems-panel"><div className="panel-heading compact"><div><span className="eyebrow">AI ROUTER</span><h2>Configured providers</h2></div><span className="health-pill neutral">fallback chain</span></div><div className="system-status-list">{providers.map((provider) => <div className="system-status provider-status" key={provider.id}><span className={`provider-dot ${provider.configured ? "configured" : ""}`}><Bot size={14} /></span><div><strong>{provider.name}</strong><small>{provider.role}</small></div><span className={`status-chip ${provider.configured ? "live" : "idle"}`}>{provider.configured ? "ready" : "not set"}</span></div>)}{!providers.length ? <div className="micro-empty">Provider status will appear when D1 is live.</div> : null}</div></section>
        </div>

        <section className="panel systems-panel agent-queue-panel">
          <div className="panel-heading compact">
            <div><span className="eyebrow">ASYNCHRONOUS WORK</span><h2>Agent queue</h2></div>
            <span className="health-pill neutral">{state?.agentJobs.length ?? 0} recent</span>
          </div>
          {state?.agentJobs.length ? (
            <div className="agent-job-list">
              {state.agentJobs.map((job) => (
                <article className="agent-job" key={job.id}>
                  <span className={`job-state ${job.status}`}>{job.status}</span>
                  <div>
                    <strong>{job.kind.replaceAll("_", " ")}</strong>
                    <small>{job.provider ? `${job.provider}${job.model ? ` · ${job.model}` : ""}` : "Waiting for the HP/NAS worker"}</small>
                    {job.result ? <p>{job.result}</p> : null}
                    {job.error ? <p className="job-error">{job.error}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="micro-empty">Questions and project research jobs will appear here after Universal Command queues them.</div>}
        </section>

        <article className="system-card command-line-card"><span className="eyebrow">LOCAL SETUP</span><h2>Run these steps from the repository root</h2><div className="setup-steps"><div><span>1</span><code>.\scripts\setup-windows.ps1</code></div><div><span>2</span><code>.\scripts\jarvis.ps1 doctor</code></div><div><span>3</span><code>.\scripts\jarvis.ps1 auth webuntis -Headed</code></div><div><span>4</span><code>.\scripts\jarvis.ps1 health all</code></div><div><span>5</span><code>.\scripts\jarvis.ps1 install</code></div></div><p>Setup uses native protected prompts for IAM credentials and the worker token. Never type either into Universal Command.</p></article>
      </section>
    );
  }

  const sectionContent = activeSection === "Today" ? renderToday()
    : activeSection === "Planner" ? renderPlanner()
      : activeSection === "Subjects" ? renderSubjects()
        : activeSection === "Projects" ? renderProjects()
          : activeSection === "Knowledge" ? renderKnowledge()
            : renderSystems();

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-block"><div className="brand-mark" aria-hidden="true">J</div><div><p className="brand-name">JARVIS</p><p className="brand-edition">ACADEMIC OS</p></div></div>
        <nav className="nav-list">{navItems.map(({ label, icon: Icon }) => <button className={`nav-item ${activeSection === label ? "active" : ""}`} key={label} onClick={() => setActiveSection(label)} type="button"><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === "Systems" && healthySources === 0 ? <span className="nav-badge">!</span> : null}</button>)}</nav>
        <div className="sidebar-bottom"><div className={`sync-card ${healthySources ? "" : "waiting"}`}><div className="sync-row">{healthySources ? <ShieldCheck size={17} /> : <Database size={17} />}<span>{healthySources ? "Live data connected" : "Awaiting worker"}</span></div><p>{healthySources} healthy source{healthySources === 1 ? "" : "s"}</p></div><button className="profile-card" onClick={() => setActiveSection("Systems")} type="button"><span className="avatar">DF</span><span><strong>Darius</strong><small>Private workspace</small></span><Settings2 size={16} /></button></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">J</span><strong>JARVIS</strong></div><button className="search-box" onClick={() => openCommand()} type="button"><Search size={18} /><span>Tell Jarvis anything…</span><kbd><Command size={12} /> K</kbd></button><span className="phase-badge live-phase">PHASE 1 · REAL DATA</span><div className="top-actions"><button className="icon-button" aria-label="Systems" onClick={() => setActiveSection("Systems")} type="button"><CircleHelp size={19} /></button><button className="capture-button" onClick={() => openCommand()} type="button"><Sparkles size={17} /><span>Universal command</span></button></div></header>
        <div className="content-wrap">{sectionContent}</div>
      </section>

      {commandOpen ? (
        <div className="command-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setCommandOpen(false); }}>
          <section aria-labelledby="command-title" aria-modal="true" className="command-dialog compact-command" role="dialog">
            <div className="command-heading">
              <span className="command-mark"><Sparkles size={19} /></span>
              <div><p className="eyebrow">UNIVERSAL COMMAND</p><h2 id="command-title">Say what happened—or what you want.</h2></div>
              <button aria-label="Close Universal Command" onClick={() => setCommandOpen(false)} type="button"><X size={18} /></button>
            </div>
            {!commandResult ? (
              <form onSubmit={runCommand}>
                <label className="command-input-wrap">
                  <span className="sr-only">Natural-language command</span>
                  <textarea autoFocus maxLength={2000} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Algebra book exercises 4–8 for Friday" rows={3} value={commandText} />
                  <span className="command-hint">Jarvis infers whether this is homework, a study session, a note, a question, or a project canvas.</span>
                </label>
                {commandError ? <p className="command-error">{commandError}</p> : null}
                <div className="command-submit-row">
                  <span><Command size={12} /> K to open · Enter to run</span>
                  <button disabled={!commandText.trim() || commandPending} type="submit">{commandPending ? <LoaderCircle className="spin" size={16} /> : <CornerDownLeft size={16} />}{commandPending ? "Understanding…" : "Run command"}</button>
                </div>
              </form>
            ) : (
              <div className="command-result">
                <span className={`result-check ${commandResult.stored ? "" : "warning"}`}>{commandResult.stored ? <Check size={21} /> : <AlertTriangle size={21} />}</span>
                <div>
                  <span className="eyebrow">{commandResult.stored ? "SAVED" : "UNDERSTOOD · NOT SAVED"}</span>
                  <h3>{commandResult.response}</h3>
                  <p>{commandResult.subject ?? "General"}{commandResult.dueLabel ? ` · ${commandResult.dueLabel}` : ""}{` · ${Math.round(commandResult.confidence * 100)}% confidence`}</p>
                  <small>Routed by {providerNames[commandResult.provider]}{commandResult.queuedJobId ? " · worker job queued" : ""}{!commandResult.stored ? " · database unavailable" : ""}</small>
                </div>
                <div className="result-actions">
                  <button className="secondary" onClick={() => { setCommandText(""); setCommandResult(null); setCommandError(""); }} type="button">New command</button>
                  {commandResult.stored && commandResult.action !== "ask_jarvis" ? <button onClick={openCommandResult} type="button">Open result <ArrowRight size={15} /></button> : null}
                </div>
              </div>
            )}
            {!commandResult ? <div className="command-examples"><span>Examples</span>{commandExamples.map((example) => <button key={example} onClick={() => setCommandText(example)} type="button">{example}</button>)}</div> : null}
          </section>
        </div>
      ) : null}

      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.slice(0, 5).map(({ label, icon: Icon }) => <button className={activeSection === label ? "active" : ""} key={label} onClick={() => setActiveSection(label)} type="button"><Icon size={18} /><span>{label}</span></button>)}</nav>
    </main>
  );
}
