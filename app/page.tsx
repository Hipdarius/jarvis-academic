"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock3,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  GraduationCap,
  Inbox,
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

import {
  activeDashboardItems,
  dashboardItemDate,
  evidenceLabel,
  filterPlannerItems,
  inboxDashboardItems,
  scheduledDashboardItems,
  type PlannerFilter,
} from "@/app/lib/dashboard-view";
import type { CommandIntent } from "@/packages/core/src/command-router";
import type {
  DashboardItem,
  DashboardSource,
  DashboardState,
} from "@/packages/core/src/dashboard";

type NavItem = { label: string; icon: LucideIcon };
type CommandResponse = CommandIntent & { stored: boolean; queuedJobId: string | null };

const commandExamples = [
  "Algebra exercises 4-8 for Friday",
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
  local: "local router",
};

const plannerFilters: Array<{ id: PlannerFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "work", label: "Work" },
  { id: "deadlines", label: "Deadlines" },
  { id: "announcements", label: "Updates" },
];

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatItemDate(item: DashboardItem) {
  const date = dashboardItemDate(item);
  if (!date) return item.dueLabel ?? "Unscheduled";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: item.startsAt ? "2-digit" : undefined,
    minute: item.startsAt ? "2-digit" : undefined,
  }).format(date);
}

function formatFreshness(value: string | null | undefined) {
  if (!value) return "No successful read yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Freshness unavailable";
  const deltaMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (deltaMinutes < 1) return "Updated just now";
  if (deltaMinutes < 60) return `Updated ${deltaMinutes} min ago`;
  if (deltaMinutes < 1_440) return `Updated ${Math.round(deltaMinutes / 60)} hr ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date)}`;
}

function relativeSourceDetail(source: DashboardSource) {
  if (!source.lastSuccessAt) return source.detail;
  const date = new Date(source.lastSuccessAt);
  if (Number.isNaN(date.getTime())) return source.detail;
  return `Read ${new Intl.DateTimeFormat(undefined, {
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

function itemTypeLabel(type: DashboardItem["type"]) {
  return type.replaceAll("_", " ");
}

function SourceMark({ source }: { source: DashboardSource }) {
  return <span className={`source-mark ${sourceTone(source.status)}`} aria-hidden="true" />;
}

function EvidenceBadge({ item }: { item: DashboardItem }) {
  return (
    <span className={`evidence-badge ${item.evidence}`} title={`${item.confidence}% confidence`}>
      <ShieldCheck size={12} />
      {evidenceLabel(item.evidence)}
    </span>
  );
}

function AcademicItemRow({ item, compact = false }: { item: DashboardItem; compact?: boolean }) {
  const Icon = item.type === "announcement" ? Inbox : item.type === "personal" ? Clock3 : FileText;
  return (
    <article className={`academic-row ${compact ? "compact" : ""}`}>
      <span className={`academic-icon ${item.type}`} aria-hidden="true"><Icon size={17} /></span>
      <div className="academic-main">
        <div className="academic-origin"><span>{item.subject}</span><span>{item.source}</span></div>
        <h3>{item.title}</h3>
        {!compact && item.description ? <p>{item.description}</p> : null}
        <div className="trust-row">
          <EvidenceBadge item={item} />
          <span>{item.confidence}% confidence</span>
        </div>
      </div>
      <div className="academic-when">
        <strong>{formatItemDate(item)}</strong>
        <span>{itemTypeLabel(item.type)}</span>
      </div>
    </article>
  );
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
    <div className="empty-state">
      <span><Icon size={24} /></span>
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
  const [plannerFilter, setPlannerFilter] = useState<PlannerFilter>("all");
  const [plannerQuery, setPlannerQuery] = useState("");
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

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setStateLoading(true);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = await response.json() as DashboardState;
      setState(payload);
      setStateError(payload.mode === "database_unavailable"
        ? "The live database is unavailable here. Jarvis has not substituted sample data."
        : "");
    } catch {
      setState(null);
      setStateError("Jarvis could not read the live database. No sample data has been substituted.");
    } finally {
      if (!silent) setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadState(); }, 0);
    const initialClock = window.setTimeout(() => setCurrentDate(new Date()), 0);
    const clock = window.setInterval(() => setCurrentDate(new Date()), 60_000);
    const refresh = window.setInterval(() => { void loadState(true); }, 60_000);
    const refreshOnFocus = () => { void loadState(true); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearTimeout(initialClock);
      window.clearInterval(clock);
      window.clearInterval(refresh);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadState]);

  useEffect(() => {
    document.title = `${activeSection} | Academic Jarvis`;
  }, [activeSection]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommand();
      }
      if (event.key === "Escape") setCommandOpen(false);
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const activeItems = useMemo(() => activeDashboardItems(state?.items ?? []), [state]);
  const scheduledItems = useMemo(() => scheduledDashboardItems(state?.items ?? []), [state]);
  const inboxItems = useMemo(() => inboxDashboardItems(state?.items ?? []), [state]);
  const filteredPlannerItems = useMemo(
    () => filterPlannerItems(state?.items ?? [], plannerFilter, plannerQuery),
    [plannerFilter, plannerQuery, state],
  );
  const todayItems = scheduledItems.filter((item) => {
    const date = dashboardItemDate(item);
    return date && currentDate ? dateKey(date) === dateKey(currentDate) : false;
  });
  const nextDeadline = scheduledItems[0] ?? null;
  const healthySources = (state?.sources ?? []).filter((source) => source.status === "healthy").length;
  const totalSources = Math.max(state?.sources.length ?? 0, 4);
  const dashboardFreshness = state?.mode === "live"
    ? formatFreshness(state.generatedAt)
    : state?.mode === "database_unavailable"
      ? "Live database unavailable"
      : "Waiting for live state";
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
      if (payload.stored) await loadState(true);
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
    const greeting = !currentDate
      ? "Welcome back"
      : currentDate.getHours() < 12
        ? "Good morning"
        : currentDate.getHours() < 18
          ? "Good afternoon"
          : "Good evening";
    const focusTitle = nextDeadline
      ? nextDeadline.title
      : healthySources
        ? "No verified deadlines right now."
        : "Waiting for the first verified sync.";
    const focusCopy = nextDeadline
      ? `${nextDeadline.subject} / ${nextDeadline.source}`
      : healthySources
        ? "School notices remain in the inbox until they contain actionable work or a confirmed date."
        : "Open Systems to finish the local worker connection.";

    return (
      <>
        <section className="page-heading today-heading">
          <div>
            <p className="eyebrow">{currentDate ? new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(currentDate) : "Academic workspace"}</p>
            <h1>{greeting}, Darius.</h1>
            <p>{stateLoading ? "Reading verified school data..." : `${healthySources} of ${totalSources} sources reporting. ${dashboardFreshness}`}</p>
          </div>
          <button className="quiet-action" onClick={() => void loadState()} type="button">
            <RefreshCw className={stateLoading ? "spin" : ""} size={16} />
            Refresh
          </button>
        </section>

        {stateError ? (
          <div className="truth-banner" role="alert">
            <AlertTriangle size={17} />
            <span>{stateError}</span>
            <button onClick={() => void loadState()} type="button">Retry</button>
          </div>
        ) : null}

        <section className={`focus-band ${nextDeadline ? "has-work" : "is-clear"}`}>
          <span className="focus-symbol">{nextDeadline ? <Clock3 size={20} /> : healthySources ? <CheckCircle2 size={20} /> : <Unplug size={20} />}</span>
          <div className="focus-copy">
            <p className="eyebrow">{nextDeadline ? "Next scheduled item" : healthySources ? "Schedule clear" : "Worker status"}</p>
            <h2>{focusTitle}</h2>
            <p>{focusCopy}</p>
            {nextDeadline ? (
              <div className="focus-meta">
                <span><CalendarDays size={14} />{formatItemDate(nextDeadline)}</span>
                <EvidenceBadge item={nextDeadline} />
                <span>{nextDeadline.confidence}% confidence</span>
              </div>
            ) : null}
          </div>
          <button onClick={() => setActiveSection(nextDeadline || healthySources ? "Planner" : "Systems")} type="button">
            {nextDeadline || healthySources ? "Open planner" : "Open systems"}<ArrowRight size={16} />
          </button>
        </section>

        <section className="overview-strip" aria-label="Academic overview">
          <div><strong>{todayItems.length}</strong><span>Due today</span></div>
          <div><strong>{scheduledItems.length}</strong><span>Scheduled</span></div>
          <div><strong>{inboxItems.length}</strong><span>Inbox updates</span></div>
          <div><strong>{healthySources}/{totalSources}</strong><span>Sources live</span></div>
        </section>

        <div className="dashboard-layout">
          <section className="data-section upcoming-section">
            <div className="section-heading">
              <div><p className="eyebrow">Actionable work</p><h2>Upcoming</h2></div>
              <button onClick={() => setActiveSection("Planner")} type="button">View all<ArrowRight size={15} /></button>
            </div>
            {scheduledItems.length ? (
              <div className="academic-list">
                {scheduledItems.slice(0, 6).map((item) => <AcademicItemRow item={item} key={item.id} />)}
              </div>
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="No scheduled work"
                copy={healthySources ? "Your connected sources have not reported a dated assignment yet." : "Scheduled work will appear after the worker completes its first sync."}
                action={healthySources ? "Capture work" : "Open systems"}
                onAction={() => healthySources ? openCommand() : setActiveSection("Systems")}
              />
            )}
          </section>

          <aside className="dashboard-aside">
            <section className="data-section inbox-section">
              <div className="section-heading compact">
                <div><p className="eyebrow">Not treated as deadlines</p><h2>School inbox</h2></div>
                <span className="count-chip">{inboxItems.length}</span>
              </div>
              {inboxItems.length ? (
                <div className="academic-list compact-list">
                  {inboxItems.slice(0, 4).map((item) => <AcademicItemRow compact item={item} key={item.id} />)}
                </div>
              ) : <p className="section-empty-copy">No undated updates are waiting.</p>}
            </section>

            <section className="data-section source-section">
              <div className="section-heading compact">
                <div><p className="eyebrow">Worker evidence</p><h2>Source health</h2></div>
                <span className={`status-summary ${healthySources ? "live" : "idle"}`}>{healthySources}/{totalSources} live</span>
              </div>
              <div className="source-list">
                {(state?.sources ?? []).map((source) => (
                  <div className="source-row" key={source.id}>
                    <SourceMark source={source} />
                    <div><strong>{source.name}</strong><span>{relativeSourceDetail(source)}</span></div>
                    <span className={`status-chip ${sourceTone(source.status)}`}>{source.status}</span>
                  </div>
                ))}
                {!state?.sources.length ? <p className="section-empty-copy">No worker heartbeat has arrived.</p> : null}
              </div>
              <button className="section-footer-action" onClick={() => setActiveSection("Systems")} type="button">
                <Settings2 size={15} />Worker settings
              </button>
            </section>
          </aside>
        </div>
      </>
    );
  }

  function renderPlanner() {
    const filterCounts: Record<PlannerFilter, number> = {
      all: activeItems.length,
      work: activeItems.filter((item) => item.type !== "announcement").length,
      deadlines: scheduledItems.length,
      announcements: activeItems.filter((item) => item.type === "announcement").length,
    };
    const hasFilters = plannerFilter !== "all" || plannerQuery.trim().length > 0;
    return (
      <section className="collection-page">
        <div className="page-heading">
          <div><p className="eyebrow">Verified academic items</p><h1>Planner</h1><p>{activeItems.length} open item{activeItems.length === 1 ? "" : "s"} across connected sources.</p></div>
          <button className="primary-action" onClick={() => openCommand()} type="button"><Plus size={17} />Capture work</button>
        </div>

        <div className="planner-toolbar">
          <div className="segment-control" aria-label="Planner filter">
            {plannerFilters.map((filter) => (
              <button aria-pressed={plannerFilter === filter.id} key={filter.id} onClick={() => setPlannerFilter(filter.id)} type="button">
                {filter.label}<span>{filterCounts[filter.id]}</span>
              </button>
            ))}
          </div>
          <label className="planner-search">
            <Search size={16} />
            <span className="sr-only">Search planner</span>
            <input onChange={(event) => setPlannerQuery(event.target.value)} placeholder="Search title, subject, or source" type="search" value={plannerQuery} />
          </label>
        </div>

        <section className="data-section planner-results">
          <div className="section-heading compact">
            <div><p className="eyebrow">{hasFilters ? "Filtered view" : "All open items"}</p><h2>{filteredPlannerItems.length} result{filteredPlannerItems.length === 1 ? "" : "s"}</h2></div>
            {hasFilters ? <button onClick={() => { setPlannerFilter("all"); setPlannerQuery(""); }} type="button">Clear filters</button> : null}
          </div>
          {filteredPlannerItems.length ? (
            <div className="academic-list">
              {filteredPlannerItems.map((item) => <AcademicItemRow item={item} key={item.id} />)}
            </div>
          ) : (
            <EmptyState
              icon={ListTodo}
              title={hasFilters ? "No matching items" : "The planner is empty"}
              copy={hasFilters ? "Try another search or clear the active filter." : "Jarvis has not received verified school work or a manual command yet."}
              action={hasFilters ? "Clear filters" : healthySources ? "Capture work" : "Open systems"}
              onAction={() => {
                if (hasFilters) { setPlannerFilter("all"); setPlannerQuery(""); }
                else if (healthySources) openCommand();
                else setActiveSection("Systems");
              }}
            />
          )}
        </section>
      </section>
    );
  }

  function renderSubjects() {
    return (
      <section className="collection-page">
        <div className="page-heading"><div><p className="eyebrow">Courses from real records</p><h1>Subjects</h1><p>{subjectGroups.length} subject{subjectGroups.length === 1 ? "" : "s"} currently indexed.</p></div></div>
        {subjectGroups.length ? (
          <div className="entity-grid">
            {subjectGroups.map(([subject, items]) => {
              const openCount = items.filter((item) => item.status !== "done" && item.status !== "cancelled").length;
              const sourceCount = new Set(items.map((item) => item.source)).size;
              return (
                <article className="entity-card" key={subject}>
                  <span className="entity-icon"><GraduationCap size={19} /></span>
                  <p className="eyebrow">{openCount} open / {sourceCount} source{sourceCount === 1 ? "" : "s"}</p>
                  <h2>{subject}</h2>
                  <p>{items.length} verified record{items.length === 1 ? "" : "s"}</p>
                </article>
              );
            })}
          </div>
        ) : <EmptyState icon={GraduationCap} title="No subjects indexed" copy="Subjects will be created from imported school records, never from placeholders." />}
      </section>
    );
  }

  function renderProjects() {
    const projects = state?.projects ?? [];
    return (
      <section className="collection-page">
        <div className="page-heading"><div><p className="eyebrow">Active investigations</p><h1>Projects</h1><p>{projects.length} saved project canvas{projects.length === 1 ? "" : "es"}.</p></div><button className="primary-action" onClick={() => openCommand("What if I built ")} type="button"><Plus size={17} />New idea</button></div>
        {projects.length ? (
          <div className="entity-grid">
            {projects.map((project) => (
              <article className="entity-card project-card" key={project.id}>
                <span className="entity-icon amber"><Lightbulb size={19} /></span>
                <p className="eyebrow">{project.status} / {project.subject}</p>
                <h2>{project.title}</h2>
                <p>{project.brief}</p>
                <span className="entity-status">Stored in Jarvis</span>
              </article>
            ))}
          </div>
        ) : <EmptyState icon={Lightbulb} title="No projects yet" copy="Capture a project idea and Jarvis will store the first canvas." action="Start an idea" onAction={() => openCommand(commandExamples[1])} />}
      </section>
    );
  }

  function renderKnowledge() {
    const notes = state?.notes ?? [];
    return (
      <section className="collection-page">
        <div className="page-heading"><div><p className="eyebrow">Captured context</p><h1>Knowledge</h1><p>{notes.length} saved note{notes.length === 1 ? "" : "s"}.</p></div><button className="primary-action" onClick={() => openCommand("Remember this: ")} type="button"><Plus size={17} />New note</button></div>
        {notes.length ? (
          <div className="entity-grid">
            {notes.map((note) => (
              <article className="entity-card note-card" key={note.id}>
                <span className="entity-icon green"><NotebookPen size={19} /></span>
                <p className="eyebrow">{note.subject}</p>
                <h2>{note.title}</h2>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        ) : <EmptyState icon={NotebookPen} title="No notes yet" copy="Facts and teacher remarks you capture will appear here." />}
      </section>
    );
  }

  function renderSystems() {
    const sources = state?.sources ?? [];
    const providers = state?.providers ?? [];
    const workerLive = sources.some((source) => source.status === "healthy");
    return (
      <section className="collection-page systems-page">
        <div className="page-heading">
          <div><p className="eyebrow">Private worker and integrations</p><h1>Systems</h1><p>{workerLive ? `Worker online. ${formatFreshness(state?.generatedAt)}` : "No healthy worker source is reporting."}</p></div>
          <button className="quiet-action" onClick={() => void loadState()} type="button"><RefreshCw className={stateLoading ? "spin" : ""} size={16} />Refresh</button>
        </div>

        <section className={`worker-banner ${workerLive ? "live" : "waiting"}`}>
          <span>{workerLive ? <ShieldCheck size={21} /> : <Database size={21} />}</span>
          <div><p className="eyebrow">Local worker</p><h2>{workerLive ? "School data is reporting securely." : "Connect the HP worker to begin."}</h2><p>{workerLive ? `${healthySources} source${healthySources === 1 ? "" : "s"} passed the latest health check.` : "Credentials stay in Windows DPAPI and are used only on allowlisted identity pages."}</p></div>
        </section>

        <div className="systems-grid">
          <section className="data-section">
            <div className="section-heading compact"><div><p className="eyebrow">School sources</p><h2>Browser worker</h2></div><span className={`status-summary ${healthySources ? "live" : "idle"}`}>{healthySources}/{Math.max(sources.length, 4)} live</span></div>
            <div className="system-list">
              {sources.map((source) => (
                <div className="system-row" key={source.id}>
                  <SourceMark source={source} />
                  <div><strong>{source.name}</strong><span>{relativeSourceDetail(source)}</span></div>
                  <span className={`status-chip ${sourceTone(source.status)}`}>{source.status}</span>
                </div>
              ))}
              {!sources.length ? <p className="section-empty-copy">No source heartbeat has reached Jarvis.</p> : null}
            </div>
          </section>

          <section className="data-section">
            <div className="section-heading compact"><div><p className="eyebrow">AI routing</p><h2>Providers</h2></div><span className="count-chip">fallbacks</span></div>
            <div className="system-list">
              {providers.map((provider) => (
                <div className="system-row" key={provider.id}>
                  <span className={`provider-mark ${provider.configured ? "configured" : ""}`}><Bot size={14} /></span>
                  <div><strong>{provider.name}</strong><span>{provider.role}</span></div>
                  <span className={`status-chip ${provider.configured ? "live" : "idle"}`}>{provider.configured ? "ready" : "not set"}</span>
                </div>
              ))}
              {!providers.length ? <p className="section-empty-copy">No provider status has been published.</p> : null}
            </div>
          </section>
        </div>

        <div className="systems-grid setup-grid">
          <section className="data-section pairing-section">
            <div className="section-heading compact"><div><p className="eyebrow">Worker pairing</p><h2>{workerLive ? "Replace worker access" : "Connect this worker"}</h2></div><KeyRound size={18} /></div>
            <p>A pairing token may publish normalized school records. It cannot read the IAM password stored on this PC.</p>
            {pairToken ? (
              <div className="token-box">
                <code>{pairToken}</code>
                <button aria-label="Copy worker token" onClick={() => void copyPairToken()} title="Copy token" type="button">{copied ? <Check size={16} /> : <ClipboardCopy size={16} />}</button>
              </div>
            ) : (
              <button className={workerLive ? "secondary-action" : "primary-action"} disabled={pairPending} onClick={() => void createPairToken()} type="button">
                {pairPending ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
                {pairPending ? "Creating..." : workerLive ? "Create replacement token" : "Create one-time token"}
              </button>
            )}
            {pairToken ? <p className="token-warning">Shown once. Store it with <code>.\scripts\jarvis.ps1 token</code>.</p> : null}
            {pairError ? <p className="form-error" role="alert">{pairError}</p> : null}
          </section>

          <section className="data-section credential-section">
            <div className="section-heading compact"><div><p className="eyebrow">Credential boundary</p><h2>IAM stays local</h2></div><LockKeyhole size={18} /></div>
            <p>The IAM password is encrypted for this Windows account. It is never sent to the dashboard, an AI provider, GitHub, or Universal Command.</p>
            <div className="security-note"><ShieldCheck size={16} /><span>Password entry is limited to approved IAM and Microsoft identity hosts. MFA still pauses for you.</span></div>
          </section>
        </div>

        <section className="data-section agent-section">
          <div className="section-heading compact"><div><p className="eyebrow">Asynchronous work</p><h2>Agent queue</h2></div><span className="count-chip">{state?.agentJobs.length ?? 0}</span></div>
          {state?.agentJobs.length ? (
            <div className="agent-list">
              {state.agentJobs.map((job) => (
                <article className="agent-row" key={job.id}>
                  <span className={`job-state ${job.status}`}>{job.status}</span>
                  <div><strong>{job.kind.replaceAll("_", " ")}</strong><span>{job.provider ? `${job.provider}${job.model ? ` / ${job.model}` : ""}` : "Waiting for the local worker"}</span>{job.result ? <p>{job.result}</p> : null}{job.error ? <p className="form-error">{job.error}</p> : null}</div>
                </article>
              ))}
            </div>
          ) : <p className="section-empty-copy">No queued or recent agent work.</p>}
        </section>

        <section className="data-section setup-section">
          <div className="section-heading compact"><div><p className="eyebrow">Local controls</p><h2>Worker commands</h2></div><Database size={18} /></div>
          <div className="setup-steps">
            <div><span>1</span><strong>Check installation</strong><code>.\scripts\jarvis.ps1 doctor</code></div>
            <div><span>2</span><strong>Open login flows</strong><code>.\scripts\jarvis.ps1 auth all -Headed</code></div>
            <div><span>3</span><strong>Read all sources now</strong><code>.\scripts\jarvis.ps1 sync all</code></div>
            <div><span>4</span><strong>Keep the worker running</strong><code>.\scripts\jarvis.ps1 install</code></div>
          </div>
          <p className="setup-warning"><AlertTriangle size={15} />Enter IAM credentials only in the protected Windows prompt or approved identity page.</p>
        </section>
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
        <div className="brand-block"><span className="brand-mark" aria-hidden="true">J</span><div><strong>Jarvis</strong><span>Academic OS</span></div></div>
        <nav className="nav-list">
          {navItems.map(({ label, icon: Icon }) => (
            <button className={`nav-item ${activeSection === label ? "active" : ""}`} key={label} onClick={() => setActiveSection(label)} type="button">
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {label === "Systems" && healthySources === 0 ? <span className="nav-alert" aria-label="Worker needs attention">!</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sidebar-status ${healthySources ? "live" : "waiting"}`}><span>{healthySources ? <ShieldCheck size={16} /> : <Database size={16} />}</span><div><strong>{healthySources ? "Worker online" : "Worker waiting"}</strong><small>{healthySources}/{totalSources} sources live</small></div></div>
          <button className="profile-button" onClick={() => setActiveSection("Systems")} type="button"><span className="avatar">DF</span><span><strong>Darius</strong><small>Private workspace</small></span><Settings2 size={16} /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">J</span><strong>Jarvis</strong></div>
          <button aria-label="Open Universal Command" className="command-trigger" onClick={() => openCommand()} title="Open Universal Command" type="button"><Search size={17} /><span>Search or capture anything</span></button>
          <span className={`live-badge ${healthySources ? "online" : "offline"}`}><i />{healthySources}/{totalSources} sources live</span>
          <div className="top-actions">
            <button className="icon-button" aria-label="Refresh school data" onClick={() => void loadState()} title="Refresh school data" type="button"><RefreshCw className={stateLoading ? "spin" : ""} size={18} /></button>
            <button aria-label="Capture with Universal Command" className="capture-button" onClick={() => openCommand()} title="Capture with Universal Command" type="button"><Sparkles size={16} /><span>Capture</span></button>
          </div>
        </header>
        <div className="content-wrap">{sectionContent}</div>
      </section>

      {commandOpen ? (
        <div className="command-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setCommandOpen(false); }}>
          <section aria-labelledby="command-title" aria-modal="true" className="command-dialog" role="dialog">
            <div className="command-heading">
              <span className="command-mark"><Sparkles size={18} /></span>
              <div><p className="eyebrow">Universal Command</p><h2 id="command-title">What should Jarvis capture?</h2></div>
              <button aria-label="Close Universal Command" onClick={() => setCommandOpen(false)} title="Close" type="button"><X size={18} /></button>
            </div>
            {!commandResult ? (
              <form onSubmit={runCommand}>
                <label className="command-input-wrap">
                  <span className="sr-only">Natural-language command</span>
                  <textarea autoFocus maxLength={2000} onChange={(event) => setCommandText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Algebra exercises 4-8 for Friday" rows={4} value={commandText} />
                </label>
                {commandError ? <p className="form-error" role="alert">{commandError}</p> : null}
                <div className="command-submit-row">
                  <span>Homework, notes, questions, study, or projects</span>
                  <button disabled={!commandText.trim() || commandPending} type="submit">{commandPending ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{commandPending ? "Understanding..." : "Run command"}</button>
                </div>
              </form>
            ) : (
              <div className="command-result" aria-live="polite">
                <span className={`result-symbol ${commandResult.stored ? "saved" : "warning"}`}>{commandResult.stored ? <Check size={20} /> : <AlertTriangle size={20} />}</span>
                <div><p className="eyebrow">{commandResult.stored ? "Saved" : "Understood, not saved"}</p><h3>{commandResult.response}</h3><p>{commandResult.subject ?? "General"}{commandResult.dueLabel ? ` / ${commandResult.dueLabel}` : ""} / {Math.round(commandResult.confidence * 100)}% confidence</p><small>Routed by {providerNames[commandResult.provider]}{commandResult.queuedJobId ? " / worker job queued" : ""}{!commandResult.stored ? " / database unavailable" : ""}</small></div>
                <div className="result-actions"><button className="secondary-action" onClick={() => { setCommandText(""); setCommandResult(null); setCommandError(""); }} type="button">New command</button>{commandResult.stored && commandResult.action !== "ask_jarvis" ? <button className="primary-action" onClick={openCommandResult} type="button">Open result<ArrowRight size={15} /></button> : null}</div>
              </div>
            )}
            {!commandResult ? <div className="command-examples"><span>Try an example</span>{commandExamples.map((example) => <button key={example} onClick={() => setCommandText(example)} type="button">{example}</button>)}</div> : null}
          </section>
        </div>
      ) : null}

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map(({ label, icon: Icon }) => <button className={activeSection === label ? "active" : ""} key={label} onClick={() => setActiveSection(label)} type="button"><Icon size={18} /><span>{label}</span></button>)}
      </nav>
    </main>
  );
}
