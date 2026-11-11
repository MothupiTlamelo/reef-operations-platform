
 import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Clock3,
  Crosshair,
  Database,
  Factory,
  Filter,
  Gauge,
  Search,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Target,
  Wrench,
} from "lucide-react";
import { useList } from "@/lib/reef-db";
import { detectReefRisks, type RiskLevel, type SentinelRisk } from "@/lib/reef-sentinel";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/sentinel")({ component: SentinelPage });

type RiskFilter = "All" | RiskLevel;
type CategoryFilter = "All" | SentinelRisk["category"];
type RiskSort = "score" | "newest" | "oldest" | "title";

const riskTone: Record<RiskLevel, { badge: "destructive" | "secondary" | "default"; dot: string; bar: string; label: string }> = {
  High: { badge: "destructive", dot: "bg-red-500", bar: "bg-red-500", label: "Critical attention" },
  Medium: { badge: "secondary", dot: "bg-amber-400", bar: "bg-amber-400", label: "Planned intervention" },
  Low: { badge: "default", dot: "bg-emerald-500", bar: "bg-emerald-500", label: "Monitor" },
};

const categoryIcon: Record<SentinelRisk["category"], typeof Activity> = {
  Equipment: Gauge,
  Maintenance: Wrench,
  Inventory: Boxes,
  Downtime: Clock3,
  Production: Factory,
};

const categoryDescription: Record<SentinelRisk["category"], string> = {
  Equipment: "Asset life and replacement exposure",
  Maintenance: "Service intervals and overdue work",
  Inventory: "Stock availability and replenishment exposure",
  Downtime: "Recurring interruption patterns",
  Production: "Output movement across reporting periods",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently detected";
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  accent?: "neutral" | "red" | "amber" | "green";
}) {
  const accentClass = {
    neutral: "text-muted-foreground bg-muted",
    red: "text-red-400 bg-red-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    green: "text-emerald-400 bg-emerald-500/10",
  }[accent];

  return (
    <Card className="relative overflow-hidden border-border/70 bg-card/90 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
          <div className={`rounded-xl p-3 ${accentClass}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RiskPill({ level }: { level: RiskLevel }) {
  return (
    <Badge variant={riskTone[level].badge} className="gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]">
      <span className={`h-1.5 w-1.5 rounded-full ${riskTone[level].dot}`} />
      {level} risk
    </Badge>
  );
}

function ScoreBlock({ risk }: { risk: SentinelRisk }) {
  return (
    <div className="min-w-[104px] rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-right">
      <div className="text-2xl font-semibold tabular-nums leading-none">{risk.score}<span className="ml-1 text-xs font-normal text-muted-foreground">/25</span></div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">{risk.likelihood} likelihood × {risk.impact} impact</div>
    </div>
  );
}

function RiskRow({ risk, onOpen }: { risk: SentinelRisk; onOpen: (risk: SentinelRisk) => void }) {
  const Icon = categoryIcon[risk.category];

  return (
    <button
      type="button"
      onClick={() => onOpen(risk)}
      className="group grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-xl border border-border/70 bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <RiskPill level={risk.level} />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{risk.category}</span>
          </div>
          <p className="truncate text-sm font-semibold text-foreground">{risk.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{risk.asset}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{risk.evidence}</p>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-3">
        <ScoreBlock risk={risk} />
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-80 transition-all group-hover:translate-x-0.5 group-hover:opacity-100">
          Investigate <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

function ExposureBars({ risks }: { risks: SentinelRisk[] }) {
  const categories = Object.keys(categoryDescription) as SentinelRisk["category"][];
  const counts = categories.map((category) => ({
    category,
    count: risks.filter((risk) => risk.category === category).length,
    high: risks.filter((risk) => risk.category === category && risk.level === "High").length,
  }));
  const max = Math.max(1, ...counts.map((item) => item.count));

  return (
    <div className="space-y-4">
      {counts.map(({ category, count, high }) => {
        const Icon = categoryIcon[category];

        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 font-medium"><Icon className="h-3.5 w-3.5 text-muted-foreground" />{category}</span>
              <span className="tabular-nums text-muted-foreground">{count} finding{count === 1 ? "" : "s"}{high > 0 ? <span className="ml-2 text-red-400">· {high} high</span> : null}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${(count / max) * 100}%` }}>
                {high > 0 && <div className="h-full bg-red-500" style={{ width: `${(high / count) * 100}%` }} />}
                {count - high > 0 && <div className="h-full flex-1 bg-amber-400" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RiskMatrix({ risks, onCellSelect }: { risks: SentinelRisk[]; onCellSelect: (likelihood: number, impact: number) => void }) {
  const cells = Array.from({ length: 25 }, (_, index) => {
    const likelihood = 5 - Math.floor(index / 5);
    const impact = (index % 5) + 1;
    const count = risks.filter((risk) => risk.likelihood === likelihood && risk.impact === impact).length;
    const score = likelihood * impact;
    const tone = score >= 15 ? "bg-red-500/20 text-red-300 border-red-500/20" : score >= 6 ? "bg-amber-400/15 text-amber-300 border-amber-400/20" : "bg-emerald-500/10 text-emerald-300 border-emerald-500/15";

    return { likelihood, impact, count, tone };
  });

  return (
    <div>
      <div className="mb-2 grid grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1">
        <span />
        {[1, 2, 3, 4, 5].map((value) => <span key={value} className="text-center text-[9px] text-muted-foreground">{value}</span>)}
      </div>
      <div className="space-y-1">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="grid grid-cols-[22px_repeat(5,minmax(0,1fr))] gap-1">
            <span className="flex items-center justify-center text-[9px] text-muted-foreground">{5 - row}</span>
            {cells.slice(row * 5, row * 5 + 5).map((cell) => (
              <button
                key={`${cell.likelihood}-${cell.impact}`}
                type="button"
                onClick={() => onCellSelect(cell.likelihood, cell.impact)}
                aria-label={`${cell.count} risks at likelihood ${cell.likelihood}, impact ${cell.impact}`}
                className={`flex aspect-square items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cell.tone}`}
              >
                {cell.count || "·"}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>Likelihood ↑</span><span>Impact →</span>
      </div>
    </div>
  );
}

function RiskDetail({ risk, onClose }: { risk: SentinelRisk | null; onClose: () => void }) {
  if (!risk) return null;

  const Icon = categoryIcon[risk.category];
  const likelihoodPercent = Math.max(0, Math.min(100, (risk.likelihood / 5) * 100));
  const impactPercent = Math.max(0, Math.min(100, (risk.impact / 5) * 100));
  const calculatedScore = risk.likelihood * risk.impact;
  const scoreMatches = calculatedScore === risk.score;

  return (
    <Dialog open={Boolean(risk)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <RiskPill level={risk.level} />
            <Badge variant="outline">{risk.category}</Badge>
          </div>
          <DialogTitle className="pr-7 text-xl">{risk.title}</DialogTitle>
          <DialogDescription>
            {risk.asset} · Detected {formatTime(risk.detectedAt)}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Icon className="h-4 w-4" /> Investigation evidence
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
            <p className="text-sm leading-relaxed">{risk.evidence || "No additional evidence was supplied for this finding."}</p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{categoryDescription[risk.category]}. Review the recorded evidence against the source operational records before approving any intervention.</p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Risk assessment</h3>
              <p className="text-xs text-muted-foreground">Likelihood × impact scoring</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-2 text-right">
              <p className="text-3xl font-semibold tabular-nums">{risk.score}<span className="ml-1 text-xs font-normal text-muted-foreground">/25</span></p>
              <p className="text-[10px] text-muted-foreground">{risk.level} priority</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Likelihood</span>
                <span className="text-sm font-semibold tabular-nums">{risk.likelihood}/5</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${likelihoodPercent}%` }} />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Estimated chance or frequency of the event.</p>
            </div>
            <div className="rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Impact</span>
                <span className="text-sm font-semibold tabular-nums">{risk.impact}/5</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-red-500" style={{ width: `${impactPercent}%` }} />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Potential operational consequence if it occurs.</p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Calculation: {risk.likelihood} × {risk.impact} = {calculatedScore}
            {!scoreMatches ? ` · Displayed finding score: ${risk.score}` : " · Score verified"}
          </div>
        </section>

        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            <Target className="h-4 w-4" /> Recommended intervention
          </div>
          <p className="text-sm leading-relaxed">{risk.recommendedAction || "Review the source records and determine the appropriate operational response."}</p>
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          This investigation is read-only. Sentinel provides evidence-based recommendations; authorised REEF users remain responsible for verifying findings and approving maintenance, purchasing or operational changes.
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SentinelPage() {
  const equipment = useList<any>("equipment", "name", true);
  const maintenance = useList<any>("maintenance_logs", "date");
  const stock = useList<any>("stock_items", "name", true);
  const downtime = useList<any>("downtime_events", "start_time");
  const production = useList<any>("production_logs", "date");
  const mines = useList<any>("mines", "name", true);

  const [tab, setTab] = useState("overview");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("All");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");
  const [riskSort, setRiskSort] = useState<RiskSort>("score");
  const [query, setQuery] = useState("");
  const [selectedRisk, setSelectedRisk] = useState<SentinelRisk | null>(null);

  const risks = useMemo(() => detectReefRisks({
    equipment: equipment.data,
    maintenance: maintenance.data,
    stock: stock.data,
    downtime: downtime.data,
    production: production.data,
    mines: mines.data,
  }), [equipment.data, maintenance.data, stock.data, downtime.data, production.data, mines.data]);

  const high = risks.filter((risk) => risk.level === "High").length;
  const medium = risks.filter((risk) => risk.level === "Medium").length;
  const low = risks.filter((risk) => risk.level === "Low").length;
  const highExposure = risks.filter((risk) => risk.level === "High" || risk.level === "Medium").length;
  const loading = equipment.isLoading || maintenance.isLoading || stock.isLoading || downtime.isLoading || production.isLoading || mines.isLoading;
  const failed = equipment.isError || maintenance.isError || stock.isError || downtime.isError || production.isError || mines.isError;
  const sourceCount = [equipment.data, maintenance.data, stock.data, downtime.data, production.data].filter((rows) => Array.isArray(rows)).length;
  const totalRecords = [equipment.data, maintenance.data, stock.data, downtime.data, production.data].reduce((sum, rows) => sum + (rows?.length ?? 0), 0);

  // Filter and sort the register without mutating the original risk collection.
  const filteredRisks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    const matchingRisks = risks.filter((risk) => {
      const matchesLevel = riskFilter === "All" || risk.level === riskFilter;
      const matchesCategory = categoryFilter === "All" || risk.category === categoryFilter;

      const searchableFields = [
        risk.title,
        risk.asset,
        risk.evidence,
        risk.category,
        risk.recommendedAction,
      ];

      const searchText = searchableFields.filter(Boolean).join(" ").toLocaleLowerCase();

      return matchesLevel && matchesCategory && (!normalizedQuery || searchText.includes(normalizedQuery));
    });

    return [...matchingRisks].sort((a, b) => {
      if (riskSort === "newest" || riskSort === "oldest") {
        const aTime = new Date(a.detectedAt).getTime();
        const bTime = new Date(b.detectedAt).getTime();
        const safeATime = Number.isNaN(aTime) ? 0 : aTime;
        const safeBTime = Number.isNaN(bTime) ? 0 : bTime;

        return riskSort === "newest" ? safeBTime - safeATime : safeATime - safeBTime;
      }

      if (riskSort === "title") {
        return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
      }

      return b.score - a.score || a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    });
  }, [risks, riskFilter, categoryFilter, riskSort, query]);

  const hasActiveFilters = query.trim().length > 0 || riskFilter !== "All" || categoryFilter !== "All";

  const clearRegisterFilters = () => {
    setQuery("");
    setRiskFilter("All");
    setCategoryFilter("All");
    setRiskSort("score");
  };

  const priorityRisks = risks.filter((risk) => risk.level === "High").slice(0, 4);

  const refreshAll = () => {
    void Promise.all([
      equipment.refetch(),
      maintenance.refetch(),
      stock.refetch(),
      downtime.refetch(),
      production.refetch(),
      mines.refetch(),
    ]);
  };

  const inspectMatrixCell = (likelihood: number, impact: number) => {
    const match = risks.find((risk) => risk.likelihood === likelihood && risk.impact === impact);

    if (match) setSelectedRisk(match);

    setRiskFilter("All");
    setCategoryFilter("All");
    setQuery("");
    setTab("register");
  };

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="REEF Sentinel"
        description="Operational risk intelligence · Detect earlier. Understand faster. Act with confidence."
        actions={
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading} className="gap-2">
            <Activity className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
            Refresh intelligence
          </Button>
        }
      />

      <section className="relative overflow-hidden rounded-2xl border border-slate-700/70 bg-[#101a20] text-white shadow-xl">
        <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-[28%] h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Intelligence layer active
            </div>

            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-300/80">R.E.E.F / Sentinel systems</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              See the risk before it becomes <span className="text-amber-300">downtime.</span>
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
              A unified operational view across equipment health, maintenance, inventory, downtime and production signals.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button onClick={() => setTab("register")} className="gap-2 bg-amber-400 text-slate-950 hover:bg-amber-300">
                <Crosshair className="h-4 w-4" /> Explore risk register
              </Button>
              <span className="text-xs text-slate-400">
                {loading ? "Scanning operational records…" : `${totalRecords.toLocaleString("en-ZA")} records in the current assessment`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] uppercase tracking-[0.16em]">Total findings</span>
                <Activity className="h-4 w-4" />
              </div>
              <p className="mt-3 text-4xl font-semibold tabular-nums">{loading ? "—" : risks.length}</p>
              <p className="mt-1 text-[11px] text-slate-400">Across available signals</p>
            </div>

            <div className="rounded-xl border border-red-400/20 bg-red-500/[0.08] p-4">
              <div className="flex items-center justify-between text-red-200/80">
                <span className="text-[10px] uppercase tracking-[0.16em]">High priority</span>
                <Siren className="h-4 w-4" />
              </div>
              <p className="mt-3 text-4xl font-semibold tabular-nums text-red-200">{loading ? "—" : high}</p>
              <p className="mt-1 text-[11px] text-red-100/60">Require prompt review</p>
            </div>

            <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-4">
              <div className="flex items-center justify-between text-amber-100/70">
                <span className="text-[10px] uppercase tracking-[0.16em]">Medium priority</span>
                <AlertTriangle className="h-4 w-4" />
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-amber-100">{loading ? "—" : medium}</p>
              <p className="mt-1 text-[11px] text-amber-100/60">Plan an intervention</p>
            </div>

            <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
              <div className="flex items-center justify-between text-emerald-100/70">
                <span className="text-[10px] uppercase tracking-[0.16em]">Low priority</span>
                <ShieldCheck className="h-4 w-4" />
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums text-emerald-100">{loading ? "—" : low}</p>
              <p className="mt-1 text-[11px] text-emerald-100/60">Continue monitoring</p>
            </div>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/10 px-5 py-3 text-[10px] text-slate-400 sm:px-7">
          <span className="inline-flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-emerald-300" /> {sourceCount}/5 operational data streams available
          </span>
          <span className="inline-flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5" /> Assessment recalculates from current records
          </span>
        </div>
      </section>

      {failed && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">Some operational data could not be loaded.</p>
            <p className="mt-1 text-xs text-muted-foreground">Refresh the assessment. Findings may be incomplete until all source records are available.</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Risk exposure" value={loading ? "—" : highExposure} detail="High and medium findings" icon={ShieldAlert} accent="red" />
        <MetricCard label="Equipment monitored" value={loading ? "—" : equipment.data?.length ?? 0} detail="Registered equipment records" icon={Gauge} />
        <MetricCard label="Maintenance records" value={loading ? "—" : maintenance.data?.length ?? 0} detail="Service history signals" icon={Wrench} accent="amber" />
        <MetricCard label="Operational sources" value={`${sourceCount}/5`} detail="Equipment · Maintenance · Stock · Downtime · Production" icon={Database} accent="green" />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <div className="flex flex-col justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Sentinel workspace</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">Operational intelligence</h3>
          </div>

          <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/70 p-1 sm:w-auto">
            <TabsTrigger value="overview" className="gap-2 rounded-lg px-3 py-2 text-xs">
              <Gauge className="hidden h-3.5 w-3.5 sm:block" />Overview
            </TabsTrigger>
            <TabsTrigger value="register" className="gap-2 rounded-lg px-3 py-2 text-xs">
              <ClipboardList className="hidden h-3.5 w-3.5 sm:block" />Risk register
            </TabsTrigger>
            <TabsTrigger value="response" className="gap-2 rounded-lg px-3 py-2 text-xs">
              <Target className="hidden h-3.5 w-3.5 sm:block" />Response centre
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0 space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Operational exposure profile</CardTitle>
                    <CardDescription className="mt-1">Where Sentinel is detecting current risk signals.</CardDescription>
                  </div>
                  <Badge variant="outline">{risks.length} total</Badge>
                </div>
              </CardHeader>
              <CardContent><ExposureBars risks={risks} /></CardContent>
            </Card>

            <Card className="border-border/70">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Risk matrix</CardTitle>
                <CardDescription>Likelihood × impact · Select a populated cell to investigate.</CardDescription>
              </CardHeader>
              <CardContent>
                <RiskMatrix risks={risks} onCellSelect={inspectMatrixCell} />
                <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-500" />Low</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-amber-400" />Medium</span>
                  <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-red-500" />High</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Priority watchlist</CardTitle>
                <CardDescription className="mt-1">Highest-severity findings requiring management attention.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTab("register")} className="shrink-0 gap-1 text-xs">
                Full register <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Analysing operational signals…</p>
              ) : priorityRisks.length ? (
                priorityRisks.map((risk) => <RiskRow key={risk.id} risk={risk} onOpen={setSelectedRisk} />)
              ) : (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500" />
                  <p className="mt-3 font-semibold">No high-priority findings</p>
                  <p className="mt-1 text-xs text-muted-foreground">Sentinel has not identified any high-severity risks in the available records.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="register" className="mt-0 space-y-4">
          <Card className="border-border/70">
            <CardHeader className="gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Risk register</CardTitle>
                <CardDescription className="mt-1">Search, filter, sort and investigate explainable operational findings.</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit tabular-nums">{filteredRisks.length} / {risks.length} findings</Badge>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_170px_170px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, asset, evidence or action…"
                    className="pl-9"
                  />
                </div>

                <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as RiskFilter)}>
                  <SelectTrigger>
                    <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All severities</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All categories</SelectItem>
                    <SelectItem value="Equipment">Equipment</SelectItem>
                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                    <SelectItem value="Inventory">Inventory</SelectItem>
                    <SelectItem value="Downtime">Downtime</SelectItem>
                    <SelectItem value="Production">Production</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={riskSort} onValueChange={(value) => setRiskSort(value as RiskSort)}>
                  <SelectTrigger><SelectValue placeholder="Sort findings" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="score">Highest score</SelectItem>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="title">Title A–Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                <p className="text-xs text-muted-foreground">
                  Showing <span className="font-semibold tabular-nums text-foreground">{filteredRisks.length}</span> of{" "}
                  <span className="font-semibold tabular-nums text-foreground">{risks.length}</span> findings
                </p>

                <div className="flex items-center gap-2">
                  {hasActiveFilters && <Badge variant="secondary">Filters active</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearRegisterFilters}
                    disabled={!hasActiveFilters && riskSort === "score"}
                    className="h-7 px-2 text-xs"
                  >
                    Reset
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Scanning equipment, maintenance, inventory, downtime and production…
                </div>
              ) : filteredRisks.length ? (
                <div className="space-y-3">
                  {filteredRisks.map((risk) => (
                    <RiskRow key={risk.id} risk={risk} onOpen={setSelectedRisk} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <Search className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 font-semibold">No matching findings</p>
                  <p className="mt-1 text-xs text-muted-foreground">No risks match the current search and filter combination.</p>
                  <Button variant="ghost" size="sm" className="mt-3" onClick={clearRegisterFilters}>
                    Reset register
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="response" className="mt-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Immediate review" value={high} detail="High-severity findings" icon={Siren} accent="red" />
            <MetricCard label="Plan intervention" value={medium} detail="Medium-severity findings" icon={ClipboardList} accent="amber" />
            <MetricCard label="Monitor" value={low} detail="Low-severity findings" icon={CircleDot} accent="green" />
          </div>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-base">Recommended response queue</CardTitle>
              <CardDescription>Suggested next steps generated from the evidence attached to each finding. These are not automatically assigned or marked complete.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Preparing response queue…</p>
              ) : risks.length ? (
                [...risks].sort((a, b) => b.score - a.score).map((risk, index) => (
                  <div key={risk.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <RiskPill level={risk.level} />
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{risk.category}</span>
                      </div>
                      <p className="text-sm font-semibold">{risk.asset} · {risk.title}</p>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{risk.recommendedAction}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelectedRisk(risk)} className="shrink-0 gap-1.5">
                      Review <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                  <p className="mt-3 font-semibold">No response actions generated</p>
                  <p className="mt-1 text-xs text-muted-foreground">No risk findings are currently available from the loaded records.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-relaxed text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Operational control principle
            </div>
            Sentinel recommends and explains. Authorised REEF users remain responsible for approving maintenance, purchasing and operational changes through the existing workflows.
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-2 border-t border-border pt-4 text-[10px] leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Scoring model: likelihood (1–5) × impact (1–5) · Low 1–5 · Medium 6–14 · High 15–25</span>
        <span className="inline-flex items-center gap-1.5"><Database className="h-3 w-3" /> {totalRecords.toLocaleString("en-ZA")} source records assessed</span>
      </div>

      <RiskDetail risk={selectedRisk} onClose={() => setSelectedRisk(null)} />
    </div>
  );
}