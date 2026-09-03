"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  CalendarDays,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ClipboardCopy,
  CloudUpload,
  Clock3,
  Database,
  Download,
  FileText,
  FileCheck2,
  FolderKanban,
  Gauge,
  GraduationCap,
  GitBranch,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  NotebookPen,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
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
  DashboardStagedUpload,
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
  const attentionCopy: Record<string, string> = {
    consent_required: "Accept the Education IAM charter in a headed browser",
    mfa_required: "Complete the verification step in a headed browser",
    auth_required: "School sign-in is required",
    account_attention: "Teams is showing an account or browser warning",
    workspace_not_ready: "Teams opened, but its workspace did not finish loading",
    assignments_surface_not_found: "Teams opened, but Jarvis could not find Assignments",
  };
  if (attentionCopy[source.detail]) return attentionCopy[source.detail];
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

function formatPlanDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(date);
}

function fileTypeLabel(mimeType: string | null) {
  if (!mimeType) return "File";
  const subtype = mimeType.split("/")[1]?.split(";")[0] ?? mimeType;
  return subtype.replace("vnd.openxmlformats-officedocument.", "").replaceAll("-", " ").toUpperCase();
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${Math.round(sizeBytes / 1_024)} KB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function uploadStatus(status: DashboardStagedUpload["status"]) {
  if (status === "indexed") return { label: "indexed", tone: "live" };
  if (status === "processing") return { label: "indexing", tone: "attention" };
  if (status === "stored") return { label: "stored only", tone: "attention" };
  if (status === "failed") return { label: "needs attention", tone: "error" };
  if (status === "submitted") return { label: "submitted", tone: "live" };
  if (status === "ready_for_review") return { label: "review ready", tone: "attention" };
  return { label: "waiting", tone: "idle" };
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
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);
  const [studyPendingId, setStudyPendingId] = useState<string | null>(null);
  const [proposalConfirmId, setProposalConfirmId] = useState<string | null>(null);
  const [proposalPendingId, setProposalPendingId] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTarget, setUploadTarget] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [uploadDeleteConfirmId, setUploadDeleteConfirmId] = useState<string | null>(null);
  const [uploadDeletePendingId, setUploadDeletePendingId] = useState<string | null>(null);
  const [uploadRetryPendingId, setUploadRetryPendingId] = useState<string | null>(null);

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
  const attentionSources = (state?.sources ?? []).filter((source) => source.status === "attention" || source.status === "error").length;
  const totalSources = Math.max(state?.sources.length ?? 0, 4);
  const dashboardFreshness = state?.mode === "live"
    ? formatFreshness(state.generatedAt)
    : state?.mode === "database_unavailable"
      ? "Live database unavailable"
      : "Waiting for live state";
  const subjectGroups = useMemo(() => {
    const grouped = new Map<string, DashboardItem[]>();
    for (const item of state?.items ?? []) grouped.set(item.subject, [...(grouped.get(item.subject) ?? []), item]);
    for (const document of state?.documents ?? []) if (!grouped.has(document.subject)) grouped.set(document.subject, []);
    for (const block of state?.studyBlocks ?? []) if (!grouped.has(block.subject)) grouped.set(block.subject, []);
    for (const note of state?.notes ?? []) if (!grouped.has(note.subject)) grouped.set(note.subject, []);
    for (const upload of state?.stagedUploads ?? []) {
      const uploadSubject = upload.destination?.subject ?? "General";
      if (upload.status === "indexed" && !grouped.has(uploadSubject)) {
        grouped.set(uploadSubject, []);
      }
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  const activeStudyBlocks = useMemo(
    () => (state?.studyBlocks ?? []).filter((block) => block.status !== "done" && block.status !== "skipped"),
    [state],
  );
  const submissionCandidates = useMemo(
    () => (state?.items ?? []).filter((item) => (
      ["teams", "academy_moodle", "edu_moodle"].includes(item.sourceKind)
      && !["done", "cancelled"].includes(item.status)
      && ["homework", "presentation", "deadline"].includes(item.type)
    )).sort((first, second) => {
      const firstTime = dashboardItemDate(first)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const secondTime = dashboardItemDate(second)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return firstTime - secondTime;
    }),
    [state],
  );

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

  async function askSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatText.trim();
    if (!message || chatPending) return;
    setChatPending(true);
    setChatError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, subject: selectedSubject }),
      });
      const payload = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !payload.jobId) throw new Error(payload.error ?? "Jarvis could not queue that question.");
      setActiveChatJobId(payload.jobId);
      setChatText("");
      await loadState(true);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Jarvis could not queue that question.");
    } finally {
      setChatPending(false);
    }
  }

  async function changeStudyStatus(id: string, status: "accepted" | "done" | "skipped") {
    if (studyPendingId) return;
    setStudyPendingId(id);
    const previous = state;
    setState((current) => current ? {
      ...current,
      studyBlocks: current.studyBlocks.map((block) => block.id === id ? { ...block, status } : block),
    } : current);
    try {
      const response = await fetch(`/api/study/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Study plan update failed.");
    } catch {
      setState(previous);
    } finally {
      setStudyPendingId(null);
    }
  }

  async function approveProposal(id: string) {
    if (proposalConfirmId !== id) {
      setProposalConfirmId(id);
      return;
    }
    setProposalPendingId(id);
    try {
      const response = await fetch(`/api/improvements/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "prepare_branch" }),
      });
      if (!response.ok) throw new Error("Branch preparation could not be approved.");
      setProposalConfirmId(null);
      await loadState(true);
    } finally {
      setProposalPendingId(null);
    }
  }

  async function stageUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile || uploadPending) return;
    setUploadPending(true);
    setUploadError("");
    setUploadNotice("");
    const form = new FormData();
    form.set("file", uploadFile);
    if (uploadTarget) form.set("academicItemId", uploadTarget);
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const payload = await response.json() as {
        error?: string;
        match?: { confidence: number; reason: string } | null;
      };
      if (!response.ok) throw new Error(payload.error ?? "The file could not be staged.");
      setUploadNotice(payload.match
        ? `Stored privately and queued for indexing. Destination match: ${payload.match.confidence}% confidence.`
        : "Stored privately and queued for indexing without a destination match.");
      setUploadFile(null);
      setUploadTarget("");
      setUploadInputKey((value) => value + 1);
      await loadState(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The file could not be staged.");
    } finally {
      setUploadPending(false);
    }
  }

  async function deleteUpload(id: string) {
    if (uploadDeleteConfirmId !== id) {
      setUploadDeleteConfirmId(id);
      return;
    }
    setUploadDeletePendingId(id);
    setUploadError("");
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The staged file could not be deleted.");
      setUploadDeleteConfirmId(null);
      await loadState(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The staged file could not be deleted.");
    } finally {
      setUploadDeletePendingId(null);
    }
  }

  async function retryUpload(id: string) {
    if (uploadRetryPendingId) return;
    setUploadRetryPendingId(id);
    setUploadError("");
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(id)}/retry`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The file could not be queued again.");
      setUploadNotice("Queued for another local indexing attempt.");
      await loadState(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The file could not be queued again.");
    } finally {
      setUploadRetryPendingId(null);
    }
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

        <section className="study-plan-band">
          <div className="section-heading compact">
            <div><p className="eyebrow">Adaptive plan</p><h2>Study windows</h2></div>
            <span className="count-chip">{activeStudyBlocks.length}</span>
          </div>
          {activeStudyBlocks.length ? (
            <div className="study-block-list">
              {activeStudyBlocks.slice(0, 4).map((block) => (
                <article className="study-block-row" key={block.id}>
                  <span className="study-date"><strong>{formatPlanDate(block.scheduledFor)}</strong><small>{block.durationMinutes} min</small></span>
                  <div><strong>{block.title}</strong><span>{block.subject} / {block.reason}</span></div>
                  <button
                    aria-label={block.status === "accepted" ? `Mark ${block.title} done` : `Accept ${block.title}`}
                    disabled={studyPendingId === block.id}
                    onClick={() => void changeStudyStatus(block.id, block.status === "accepted" ? "done" : "accepted")}
                    title={block.status === "accepted" ? "Mark done" : "Accept study window"}
                    type="button"
                  >
                    {studyPendingId === block.id ? <LoaderCircle className="spin" size={16} /> : block.status === "accepted" ? <CheckCircle2 size={16} /> : <CalendarCheck2 size={16} />}
                    {block.status === "accepted" ? "Done" : "Accept"}
                  </button>
                </article>
              ))}
            </div>
          ) : <p className="section-empty-copy">Study windows appear when verified work has an exact deadline. Date-only records stay unscheduled until a time is known.</p>}
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
    if (selectedSubject) {
      const subjectItems = state?.items.filter((item) => item.subject === selectedSubject) ?? [];
      const subjectDocuments = state?.documents.filter((document) => document.subject === selectedSubject) ?? [];
      const subjectUploads = state?.stagedUploads.filter((upload) => upload.status === "indexed" && (upload.destination?.subject ?? "General") === selectedSubject) ?? [];
      const subjectBlocks = state?.studyBlocks.filter((block) => block.subject === selectedSubject && block.status !== "skipped") ?? [];
      const chatJobs = state?.agentJobs.filter((job) => job.kind === "subject_chat" && job.subject === selectedSubject) ?? [];
      const activeChat = activeChatJobId ? state?.agentJobs.find((job) => job.id === activeChatJobId) : null;
      return (
        <section className="collection-page subject-workspace">
          <button className="back-action" onClick={() => { setSelectedSubject(null); setActiveChatJobId(null); setChatError(""); }} type="button"><ArrowLeft size={16} />All subjects</button>
          <div className="page-heading subject-heading">
            <div><p className="eyebrow">Subject workspace</p><h1>{selectedSubject}</h1><p>{subjectItems.length} verified record{subjectItems.length === 1 ? "" : "s"}, {subjectDocuments.length + subjectUploads.length} indexed file{subjectDocuments.length + subjectUploads.length === 1 ? "" : "s"}, and {subjectBlocks.length} study window{subjectBlocks.length === 1 ? "" : "s"}.</p></div>
          </div>

          <div className="subject-layout">
            <div className="subject-evidence">
              <section className="data-section">
                <div className="section-heading compact"><div><p className="eyebrow">Source evidence</p><h2>Assignments and updates</h2></div><span className="count-chip">{subjectItems.length}</span></div>
                {subjectItems.length ? <div className="academic-list">{activeDashboardItems(subjectItems).map((item) => <AcademicItemRow item={item} key={item.id} />)}</div> : <p className="section-empty-copy">No academic records are indexed for this subject.</p>}
              </section>

              <section className="data-section">
                <div className="section-heading compact"><div><p className="eyebrow">Teacher and personal material</p><h2>Indexed files</h2></div><span className="count-chip">{subjectDocuments.length + subjectUploads.length}</span></div>
                {subjectDocuments.length || subjectUploads.length ? (
                  <div className="document-list">
                    {subjectDocuments.map((document) => (
                      <article className="document-row" key={document.id}>
                        <span><Paperclip size={17} /></span>
                        <div><strong>{document.name}</strong><small>{document.source} / {fileTypeLabel(document.mimeType)} / {document.extracted ? "text indexed" : "stored locally"}</small></div>
                        {document.sourceUrl ? <a aria-label={`Open source for ${document.name}`} href={document.sourceUrl} rel="noreferrer" target="_blank" title="Open source"><ArrowRight size={16} /></a> : null}
                      </article>
                    ))}
                    {subjectUploads.map((upload) => (
                      <article className="document-row" key={upload.id}>
                        <span><LockKeyhole size={17} /></span>
                        <div><strong>{upload.name}</strong><small>Private upload / {upload.pageCount ? `${upload.pageCount} page${upload.pageCount === 1 ? "" : "s"}` : fileTypeLabel(upload.mimeType)} / text indexed</small></div>
                        <a aria-label={`Download ${upload.name}`} href={`/api/uploads/${encodeURIComponent(upload.id)}/file`} title="Download private upload"><Download size={16} /></a>
                      </article>
                    ))}
                  </div>
                ) : <p className="section-empty-copy">No teacher files have been indexed for this subject.</p>}
              </section>

              <section className="data-section">
                <div className="section-heading compact"><div><p className="eyebrow">Study load</p><h2>Suggested windows</h2></div><span className="count-chip">{subjectBlocks.length}</span></div>
                {subjectBlocks.length ? <div className="study-block-list">{subjectBlocks.map((block) => (
                  <article className="study-block-row" key={block.id}>
                    <span className="study-date"><strong>{formatPlanDate(block.scheduledFor)}</strong><small>{block.durationMinutes} min</small></span>
                    <div><strong>{block.title}</strong><span>{block.reason}</span></div>
                    <button aria-label={block.status === "accepted" ? `Mark ${block.title} done` : `Accept ${block.title}`} onClick={() => void changeStudyStatus(block.id, block.status === "accepted" ? "done" : "accepted")} title={block.status === "accepted" ? "Mark done" : "Accept"} type="button">{block.status === "accepted" ? <CheckCircle2 size={16} /> : <CalendarCheck2 size={16} />}</button>
                  </article>
                ))}</div> : <p className="section-empty-copy">No exact deadlines currently require a study window.</p>}
              </section>
            </div>

            <aside className="data-section subject-chat">
              <div className="section-heading compact"><div><p className="eyebrow">Evidence-aware tutor</p><h2>Ask Jarvis</h2></div><MessageSquareText size={19} /></div>
              <form onSubmit={askSubject}>
                <label><span className="sr-only">Ask about {selectedSubject}</span><textarea maxLength={4000} onChange={(event) => setChatText(event.target.value)} placeholder={`Ask about ${selectedSubject}`} rows={4} value={chatText} /></label>
                <button disabled={!chatText.trim() || chatPending} type="submit">{chatPending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{chatPending ? "Queuing" : "Ask"}</button>
              </form>
              {chatError ? <p className="form-error" role="alert">{chatError}</p> : null}
              <div className="chat-history" aria-live="polite">
                {activeChat && !chatJobs.some((job) => job.id === activeChat.id) ? (
                  <article><span className={`job-state ${activeChat.status}`}>{activeChat.status}</span><strong>Your question</strong><p>{activeChat.result ?? "Waiting for the local worker."}</p></article>
                ) : null}
                {chatJobs.slice(0, 6).map((job) => (
                  <article key={job.id}>
                    <span className={`job-state ${job.status}`}>{job.status}</span>
                    <strong>{job.prompt ?? "Subject question"}</strong>
                    <p>{job.result ?? (job.error || "Waiting for the local worker.")}</p>
                    <small>{job.provider ? `${job.provider}${job.model ? ` / ${job.model}` : ""}` : "Queued locally"}</small>
                  </article>
                ))}
                {!chatJobs.length && !activeChat ? <p className="section-empty-copy">No subject conversation yet.</p> : null}
              </div>
            </aside>
          </div>
        </section>
      );
    }

    return (
      <section className="collection-page">
        <div className="page-heading"><div><p className="eyebrow">Courses from real records</p><h1>Subjects</h1><p>{subjectGroups.length} subject{subjectGroups.length === 1 ? "" : "s"} currently indexed.</p></div></div>
        {subjectGroups.length ? (
          <div className="subject-index">
            {subjectGroups.map(([subject, items]) => {
              const openCount = items.filter((item) => item.status !== "done" && item.status !== "cancelled").length;
              const sourceCount = new Set(items.map((item) => item.source)).size;
              const documentCount = (state?.documents.filter((document) => document.subject === subject).length ?? 0)
                + (state?.stagedUploads.filter((upload) => upload.status === "indexed" && (upload.destination?.subject ?? "General") === subject).length ?? 0);
              const studyCount = state?.studyBlocks.filter((block) => block.subject === subject && block.status !== "done" && block.status !== "skipped").length ?? 0;
              return (
                <button className="subject-index-row" key={subject} onClick={() => setSelectedSubject(subject)} type="button">
                  <span className="entity-icon"><GraduationCap size={19} /></span>
                  <div><h2>{subject}</h2><p>{openCount} open / {sourceCount} source{sourceCount === 1 ? "" : "s"}</p></div>
                  <span><strong>{documentCount}</strong><small>files</small></span>
                  <span><strong>{studyCount}</strong><small>study</small></span>
                  <ArrowRight size={18} />
                </button>
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
    const indexedDocuments = state?.documents ?? [];
    const stagedUploads = state?.stagedUploads ?? [];
    const indexedUploadCount = stagedUploads.filter((upload) => upload.status === "indexed").length;
    const waitingUploadCount = stagedUploads.filter((upload) => upload.status === "staged" || upload.status === "processing").length;
    const attentionUploadCount = stagedUploads.filter((upload) => upload.status === "stored" || upload.status === "failed").length;
    return (
      <section className="collection-page">
        <div className="page-heading"><div><p className="eyebrow">Captured and source-derived context</p><h1>Knowledge</h1><p>{notes.length} note{notes.length === 1 ? "" : "s"}, {indexedDocuments.length} school file{indexedDocuments.length === 1 ? "" : "s"}, {indexedUploadCount} personal file{indexedUploadCount === 1 ? "" : "s"} indexed.</p></div><button className="primary-action" onClick={() => openCommand("Remember this: ")} type="button"><Plus size={17} />New note</button></div>

        <section className="data-section upload-section">
          <div className="section-heading compact">
            <div><p className="eyebrow">Private object storage</p><h2>File inbox</h2></div>
            <span className={`status-chip ${indexedUploadCount ? "live" : "idle"}`}>{indexedUploadCount} indexed</span>
          </div>
          <div className="upload-pipeline-summary" aria-label="Private file indexing summary">
            <span><strong>{indexedUploadCount}</strong><small>indexed</small></span>
            <span><strong>{waitingUploadCount}</strong><small>waiting</small></span>
            <span><strong>{attentionUploadCount}</strong><small>needs attention</small></span>
          </div>
          <form className="upload-form" onSubmit={(event) => void stageUpload(event)}>
            <label className={`upload-picker ${uploadFile ? "selected" : ""}`}>
              <CloudUpload size={20} />
              <span><strong>{uploadFile?.name ?? "Choose a file"}</strong><small>{uploadFile ? formatFileSize(uploadFile.size) : "PDF, Office, image, text or ZIP / 25 MB max"}</small></span>
              <input
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.ods,.odp,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.zip"
                key={uploadInputKey}
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <label className="upload-destination">
              <span>Destination</span>
              <select onChange={(event) => setUploadTarget(event.target.value)} value={uploadTarget}>
                <option value="">Suggest a current assignment</option>
                {submissionCandidates.map((item) => (
                  <option key={item.id} value={item.id}>{item.subject} / {item.title} / {item.source}</option>
                ))}
              </select>
            </label>
            <button className="primary-action" disabled={!uploadFile || uploadPending} type="submit">
              {uploadPending ? <LoaderCircle className="spin" size={17} /> : <CloudUpload size={17} />}
              {uploadPending ? "Staging..." : "Stage file"}
            </button>
          </form>
          {uploadNotice ? <p className="form-success" role="status"><CheckCircle2 size={15} />{uploadNotice} Nothing was sent to a school system.</p> : null}
          {uploadError ? <p className="form-error" role="alert">{uploadError}</p> : null}
          {stagedUploads.length ? (
            <div className="staged-upload-list">
              {stagedUploads.map((upload) => {
                const status = uploadStatus(upload.status);
                const retryable = upload.status === "stored" || upload.status === "failed";
                return (
                  <article className="staged-upload-row" key={upload.id}>
                    <span className="staged-file-icon">{upload.status === "processing" ? <LoaderCircle className="spin" size={17} /> : <FileCheck2 size={17} />}</span>
                    <div className="staged-file-main">
                      <strong>{upload.name}</strong>
                      <small>{formatFileSize(upload.sizeBytes)} / SHA-256 {upload.checksum.slice(0, 12)} / attempt {upload.attemptCount}</small>
                      {upload.destination ? <p><span>{upload.destination.subject}</span>{upload.destination.title} / {upload.destination.source}{upload.matchConfidence ? ` / ${upload.matchConfidence}% match` : ""}</p> : <p>No current assignment match</p>}
                      <span className="processing-detail">{upload.processingMessage ?? (upload.status === "staged" ? "Waiting for the local worker." : "Processing details unavailable.")} <b>Private in Jarvis; not submitted.</b></span>
                    </div>
                    <span className={`status-chip ${status.tone}`}>{status.label}</span>
                    <div className={`staged-file-actions ${retryable ? "can-retry" : ""}`}>
                      <a aria-label={`Download ${upload.name}`} href={`/api/uploads/${encodeURIComponent(upload.id)}/file`} title="Download private file"><Download size={16} /></a>
                      {retryable ? (
                        <button
                          aria-label={`Retry indexing ${upload.name}`}
                          disabled={uploadRetryPendingId === upload.id}
                          onClick={() => void retryUpload(upload.id)}
                          title="Retry local indexing"
                          type="button"
                        >
                          <RefreshCw className={uploadRetryPendingId === upload.id ? "spin" : ""} size={16} />
                        </button>
                      ) : null}
                      <button
                        aria-label={uploadDeleteConfirmId === upload.id ? `Confirm deletion of ${upload.name}` : `Delete ${upload.name}`}
                        className={uploadDeleteConfirmId === upload.id ? "confirm" : ""}
                        disabled={upload.status === "processing" || uploadDeletePendingId === upload.id}
                        onClick={() => void deleteUpload(upload.id)}
                        title={upload.status === "processing" ? "Indexing in progress" : uploadDeleteConfirmId === upload.id ? "Confirm delete" : "Delete private file"}
                        type="button"
                      >
                        {uploadDeletePendingId === upload.id ? <LoaderCircle className="spin" size={16} /> : uploadDeleteConfirmId === upload.id ? <Check size={16} /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className="section-empty-copy">No files are waiting for review.</p>}
        </section>

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
        <section className="data-section knowledge-documents">
          <div className="section-heading compact"><div><p className="eyebrow">Protected worker storage</p><h2>School files</h2></div><span className="count-chip">{indexedDocuments.length}</span></div>
          {indexedDocuments.length ? <div className="document-list">{indexedDocuments.map((document) => (
            <article className="document-row" key={document.id}>
              <span>{document.extracted ? <FileCheck2 size={17} /> : <Paperclip size={17} />}</span>
              <div><strong>{document.name}</strong><small>{document.subject} / {document.source} / {document.extracted ? "text indexed" : fileTypeLabel(document.mimeType)}</small></div>
              {document.sourceUrl ? <a aria-label={`Open source for ${document.name}`} href={document.sourceUrl} rel="noreferrer" target="_blank" title="Open source"><ArrowRight size={16} /></a> : null}
            </article>
          ))}</div> : <p className="section-empty-copy">No teacher files have been downloaded by the worker.</p>}
        </section>
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
          <div className="section-heading compact"><div><p className="eyebrow">Bounded autonomy</p><h2>Agent runs</h2></div><span className="count-chip">{state?.agentRuns.length ?? 0}</span></div>
          {state?.agentRuns.length ? (
            <div className="agent-run-list">
              {state.agentRuns.map((run) => (
                <article className="agent-run-row" key={run.id}>
                  <div className="agent-run-heading">
                    <span className={`job-state ${run.status}`}>{run.status}</span>
                    <div><strong>{run.objective}</strong><span>{run.trigger} trigger / {run.usedJobs} of {run.budgetJobs} jobs / {run.usedTokens.toLocaleString()} of {run.budgetTokens.toLocaleString()} tokens</span></div>
                  </div>
                  {run.messages.length ? (
                    <div className="agent-message-flow">
                      {run.messages.slice().reverse().map((message) => (
                        <div key={message.id}><span>{message.sender} <ArrowRight size={12} /> {message.recipient}</span><p>{message.content}</p></div>
                      ))}
                    </div>
                  ) : <p className="section-empty-copy">The orchestrator is waiting for the first worker claim.</p>}
                </article>
              ))}
            </div>
          ) : <p className="section-empty-copy">No autonomous run has started. A verified source change or subject question will create one.</p>}
          {state?.agentJobs.length ? (
            <details className="recent-jobs">
              <summary>Recent individual jobs ({state.agentJobs.length})</summary>
              <div className="agent-list">
                {state.agentJobs.map((job) => (
                  <article className="agent-row" key={job.id}>
                    <span className={`job-state ${job.status}`}>{job.status}</span>
                    <div><strong>{job.agentRole} / {job.kind.replaceAll("_", " ")}</strong><span>{job.provider ? `${job.provider}${job.model ? ` / ${job.model}` : ""}` : "Waiting for the local worker"}</span>{job.result ? <p>{job.result}</p> : null}{job.error ? <p className="form-error">{job.error}</p> : null}</div>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <section className="data-section proposal-section">
          <div className="section-heading compact"><div><p className="eyebrow">Self-improvement boundary</p><h2>Improvement proposals</h2></div><GitBranch size={19} /></div>
          {state?.improvementProposals.length ? (
            <div className="proposal-list">
              {state.improvementProposals.map((proposal) => (
                <article className="proposal-row" key={proposal.id}>
                  <div><span className={`job-state ${proposal.status}`}>{proposal.status.replaceAll("_", " ")}</span><h3>{proposal.title}</h3><p>{proposal.rationale}</p>{proposal.branchName ? <code>{proposal.branchName}</code> : null}{proposal.implementationSummary ? <small>{proposal.implementationSummary}</small> : null}</div>
                  {proposal.status === "proposed" ? (
                    <button className={proposalConfirmId === proposal.id ? "confirm-action" : "secondary-action"} disabled={proposalPendingId === proposal.id} onClick={() => void approveProposal(proposal.id)} type="button">
                      {proposalPendingId === proposal.id ? <LoaderCircle className="spin" size={16} /> : <GitBranch size={16} />}
                      {proposalPendingId === proposal.id ? "Approving" : proposalConfirmId === proposal.id ? "Confirm branch" : "Prepare branch"}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : <p className="section-empty-copy">No recurring connector issue has produced an improvement proposal.</p>}
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
              {label === "Systems" && attentionSources > 0 ? <span className="nav-alert" aria-label={`${attentionSources} source${attentionSources === 1 ? "" : "s"} need attention`}>{attentionSources}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sidebar-status ${healthySources ? "live" : "waiting"}`}><span>{healthySources ? <ShieldCheck size={16} /> : <Database size={16} />}</span><div><strong>{attentionSources ? `${attentionSources} needs attention` : healthySources ? "Worker online" : "Worker waiting"}</strong><small>{healthySources}/{totalSources} sources live</small></div></div>
          <button className="profile-button" onClick={() => setActiveSection("Systems")} type="button"><span className="avatar">DF</span><span><strong>Darius</strong><small>Private workspace</small></span><Settings2 size={16} /></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">J</span><strong>Jarvis</strong></div>
          <button aria-label="Open Universal Command" className="command-trigger" onClick={() => openCommand()} title="Open Universal Command" type="button"><Search size={17} /><span>Search or capture anything</span></button>
          <span className={`live-badge ${attentionSources ? "partial" : healthySources ? "online" : "offline"}`}><i />{attentionSources ? `${attentionSources} needs attention` : `${healthySources}/${totalSources} sources live`}</span>
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
