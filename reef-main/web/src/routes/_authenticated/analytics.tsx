import { createFileRoute, Link } from "@tanstack/react-router";
import { useList, ZAR, NUM, RPT, type Row } from "@/lib/reef-db";
import { useStockOnHand } from "@/hooks/useStock";
import { byCostPerTonDesc, costPerTon } from "@reef/shared";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { useMemo } from "react";
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  Boxes,
  Clock,
  ClipboardCheck,
  Package,
  TrendingUp,
  Wrench,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Operational Analytics — REEF Operations" },
      {
        name: "description",
        content:
          "Management reporting for production, costs, downtime, maintenance, equipment, inventory and procurement.",
      },
      { property: "og:title", content: "Operational Analytics — REEF Operations" },
      {
        property: "og:description",
        content: "Operational intelligence across REEF mine contracts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});

const COLORS = {
  statics: "#64748b",
  maint: "#3b82f6",
  mag: "#c9a227",
  ot: "#ef4444",
  production: "#10b981",
  downtime: "#8b5cf6",
};

type DataRow = Record<string, unknown>;

type MonthRow = {
  key: string;
  month: string;
  tons: number;
  magnetite: number;
  overtime: number;
  maintenance: number;
  statics: number;
  total: number;
  rpt: number | null;
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function downtimeDate(row: DataRow): Date | null {
  return dateValue(
    row.date ?? row.event_date ?? row.start_time ?? row.started_at ?? row.created_at,
  );
}

function downtimeReason(row: DataRow): string {
  return String(
    row.reason ??
      row.downtime_reason ??
      row.category ??
      row.cause ??
      row.description ??
      "Unclassified",
  );
}

function downtimeDurationHours(row: DataRow): number | null {
  const hours = row.duration_hours ?? row.downtime_hours ?? row.hours_lost;

  if (hours !== undefined && hours !== null && Number.isFinite(Number(hours))) {
    return Math.max(0, Number(hours));
  }

  const minutes = row.duration_minutes;

  if (minutes !== undefined && minutes !== null && Number.isFinite(Number(minutes))) {
    return Math.max(0, Number(minutes) / 60);
  }

  const start = dateValue(row.start_time ?? row.started_at);
  const end = dateValue(row.end_time ?? row.ended_at);

  if (start && end && end >= start) {
    return (end.getTime() - start.getTime()) / 3_600_000;
  }

  return null;
}

function Page() {
  const production = useList<Row<"production_logs">>("production_logs", "date");
  const maint = useList<Row<"maintenance_logs">>("maintenance_logs", "date");
  const staticCosts = useList<Row<"static_costs">>("static_costs", "month");
  const mines = useList<Row<"mines">>("mines");
  const equipment = useList<Row<"equipment">>("equipment");
  const downtime = useList<Row<"downtime_events">>("downtime_events");
  const purchaseOrders = useList<Row<"purchase_orders">>("purchase_orders");
  const stock = useStockOnHand();

  const model = useMemo(() => {
    const now = new Date();
    const productionRows = production.data ?? [];
    const maintenanceRows = maint.data ?? [];
    const staticCostRows = staticCosts.data ?? [];
    const mineRows = mines.data ?? [];
    const equipmentRows = equipment.data ?? [];
    const downtimeRows = downtime.data ?? [];
    const stockRows = stock.data ?? [];
    const purchaseOrderRows = purchaseOrders.data ?? [];

    // Twelve-month financial and production ledger.
    const months: MonthRow[] = [];

    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthProduction = productionRows.filter((row) => {
        const date = dateValue(row.date);
        return date && date >= start && date < next;
      });

      const monthMaintenance = maintenanceRows.filter((row) => {
        const date = dateValue(row.date);
        return date && date >= start && date < next;
      });

      const monthStaticCosts = staticCostRows.filter((row) => {
        const date = dateValue(row.month);
        return (
          date && date.getMonth() === start.getMonth() && date.getFullYear() === start.getFullYear()
        );
      });

      const tons = monthProduction.reduce((sum, row) => sum + numberValue(row.tons_produced), 0);

      const magnetite = monthProduction.reduce(
        (sum, row) => sum + numberValue(row.magnetite_cost),
        0,
      );

      const overtime = monthProduction.reduce(
        (sum, row) => sum + numberValue(row.overtime_cost),
        0,
      );

      const maintenance = monthMaintenance.reduce(
        (sum, row) => sum + numberValue(row.total_cost),
        0,
      );

      const statics = monthStaticCosts.reduce((sum, row) => sum + numberValue(row.amount), 0);

      const total = magnetite + overtime + maintenance + statics;

      months.push({
        key: `${start.getFullYear()}-${start.getMonth()}`,
        month: start.toLocaleString("en-ZA", {
          month: "short",
          year: "2-digit",
        }),
        tons,
        magnetite,
        overtime,
        maintenance,
        statics,
        total,
        rpt: costPerTon(total, tons),
      });
    }

    const activeMonths = months.filter((month) => month.total > 0 || month.tons > 0);

    const totals = activeMonths.reduce(
      (sum, month) => ({
        tons: sum.tons + month.tons,
        magnetite: sum.magnetite + month.magnetite,
        overtime: sum.overtime + month.overtime,
        maintenance: sum.maintenance + month.maintenance,
        statics: sum.statics + month.statics,
        total: sum.total + month.total,
      }),
      {
        tons: 0,
        magnetite: 0,
        overtime: 0,
        maintenance: 0,
        statics: 0,
        total: 0,
      },
    );

    // Mine-level direct costs. Static costs are not allocated to mines here.
    const perMine = mineRows
      .map((mine) => {
        const mineProduction = productionRows.filter((row) => row.mine_id === mine.id);

        const tons = mineProduction.reduce((sum, row) => sum + numberValue(row.tons_produced), 0);

        const variable = mineProduction.reduce(
          (sum, row) => sum + numberValue(row.magnetite_cost) + numberValue(row.overtime_cost),
          0,
        );

        const mineEquipmentIds = equipmentRows
          .filter((item) => item.mine_id === mine.id)
          .map((item) => item.id);

        const maintenance = maintenanceRows
          .filter((row) => mineEquipmentIds.includes(row.equipment_id))
          .reduce((sum, row) => sum + numberValue(row.total_cost), 0);

        const directCost = variable + maintenance;

        return {
          id: mine.id,
          name: mine.name ?? "Unnamed mine",
          tons,
          variable,
          maintenance,
          directCost,
          rpt: costPerTon(directCost, tons),
        };
      })
      .sort((a, b) => byCostPerTonDesc(a.rpt, b.rpt));

    // Downtime analysis: recent 30 days.
    const cutoff30 = new Date(now.getTime() - 30 * 86_400_000);

    const downtimeLast30 = downtimeRows.filter((row) => {
      const date = downtimeDate(row);
      return date && date >= cutoff30 && date <= now;
    });

    const downtimeDurations = downtimeLast30
      .map((row) => ({
        row,
        hours: downtimeDurationHours(row),
      }))
      .filter((item): item is typeof item & { hours: number } => item.hours !== null);

    const downtimeHours = downtimeDurations.reduce((sum, item) => sum + item.hours, 0);

    const downtimeReasonMap = new Map<string, { reason: string; events: number; hours: number }>();

    downtimeLast30.forEach((row) => {
      const reason = downtimeReason(row);
      const existing = downtimeReasonMap.get(reason) ?? {
        reason,
        events: 0,
        hours: 0,
      };

      existing.events += 1;

      const hours = downtimeDurationHours(row);
      if (hours !== null) existing.hours += hours;

      downtimeReasonMap.set(reason, existing);
    });

    const downtimeByReason = Array.from(downtimeReasonMap.values())
      .sort((a, b) => b.events - a.events)
      .slice(0, 8);

    // Maintenance exposure.
    const overdueMaintenance = maintenanceRows.filter((row) => {
      const dueDate = dateValue(row.next_due_date);
      return dueDate && dueDate < now;
    });

    const next30 = new Date(now.getTime() + 30 * 86_400_000);

    const upcomingMaintenance = maintenanceRows.filter((row) => {
      const dueDate = dateValue(row.next_due_date);
      return dueDate && dueDate >= now && dueDate <= next30;
    });

    const maintenanceThisMonth = maintenanceRows.filter((row) => {
      const date = dateValue(row.date);
      return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });

    const maintenanceSpendMTD = maintenanceThisMonth.reduce(
      (sum, row) => sum + numberValue(row.total_cost),
      0,
    );

    // Equipment lifecycle based on recorded expected-life tonnage.
    const equipmentWear = equipmentRows
      .map((item) => {
        const expectedLife = numberValue(item.expected_life_tons);

        if (expectedLife <= 0) return null;

        const usedLife = numberValue(item.tons_since_install);
        const consumed = Math.min(100, Math.max(0, (usedLife / expectedLife) * 100));

        return {
          id: item.id,
          name: item.name ?? "Unnamed equipment",
          mineId: item.mine_id,
          consumed,
          remaining: 100 - consumed,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.remaining - b.remaining);

    const equipmentNearEndOfLife = equipmentWear.filter((item) => item.remaining < 20);

    // Inventory and procurement indicators.
    const lowStock = stockRows.filter(
      (item) => numberValue(item.qty_on_hand) <= numberValue(item.reorder_point),
    );

    const stockouts = stockRows.filter((item) => numberValue(item.qty_on_hand) <= 0);

    const inventoryValue = stockRows.reduce(
      (sum, item) => sum + numberValue(item.qty_on_hand) * numberValue(item.unit_cost),
      0,
    );

    const draftPurchaseOrders = purchaseOrderRows.filter(
      (row) => String(row.status ?? "").toLowerCase() === "draft",
    );

    const pendingPurchaseOrders = purchaseOrderRows.filter((row) =>
      ["pending", "submitted", "awaiting_approval"].includes(
        String(row.status ?? "").toLowerCase(),
      ),
    );

    const productionLatestMonth = activeMonths.at(-1);
    const productionPreviousMonth = activeMonths.length >= 2 ? activeMonths.at(-2) : undefined;

    const productionChange =
      productionPreviousMonth && productionPreviousMonth.tons > 0
        ? ((productionLatestMonth!.tons - productionPreviousMonth.tons) /
            productionPreviousMonth.tons) *
          100
        : null;

    const variableSpend = totals.magnetite + totals.overtime + totals.maintenance;

    const variableShare = totals.total > 0 ? (variableSpend / totals.total) * 100 : 0;

    const managementInsights: string[] = [];

    if (productionChange !== null) {
      managementInsights.push(
        `Latest recorded month production is ${productionChange >= 0 ? "up" : "down"} ${Math.abs(productionChange).toFixed(1)}% compared with the preceding recorded month.`,
      );
    } else {
      managementInsights.push(
        "There is insufficient production history to calculate a month-on-month comparison.",
      );
    }

    if (overdueMaintenance.length > 0) {
      managementInsights.push(
        `${overdueMaintenance.length} maintenance record(s) have a next due date in the past.`,
      );
    }

    if (downtimeLast30.length > 0) {
      managementInsights.push(
        `${downtimeLast30.length} downtime event(s) were recorded in the last 30 days.`,
      );
    }

    if (lowStock.length > 0) {
      managementInsights.push(
        `${lowStock.length} inventory item(s) are at or below their reorder point.`,
      );
    }

    if (equipmentNearEndOfLife.length > 0) {
      managementInsights.push(
        `${equipmentNearEndOfLife.length} tracked asset(s) have less than 20% of expected tonnage life remaining.`,
      );
    }

    if (managementInsights.length === 0) {
      managementInsights.push(
        "No immediate indicators were identified from the records currently available.",
      );
    }

    return {
      months: activeMonths,
      allMonths: months,
      perMine,
      totals,
      rpt: costPerTon(totals.total, totals.tons),
      variableShare,
      productionChange,
      downtimeLast30,
      downtimeHours,
      downtimeHasDuration: downtimeDurations.length > 0,
      downtimeByReason,
      overdueMaintenance,
      upcomingMaintenance,
      maintenanceSpendMTD,
      maintenanceThisMonth,
      equipmentWear: equipmentWear.slice(0, 8),
      equipmentNearEndOfLife,
      lowStock,
      stockouts,
      inventoryValue,
      draftPurchaseOrders,
      pendingPurchaseOrders,
      managementInsights,
    };
  }, [
    production.data,
    maint.data,
    staticCosts.data,
    mines.data,
    equipment.data,
    downtime.data,
    stock.data,
    purchaseOrders.data,
  ]);

  return (
    <div className="reef-fade-up space-y-6">
      <Link
        to="/dashboard"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <PageHeader
        title="Operational Analytics"
        description="Management intelligence across production, costs, maintenance, downtime, equipment and inventory."
      />

      {/* Financial overview */}
      <section>
        <SectionHeading
          title="Financial performance"
          description="Consolidated financial and production totals for the available 12-month reporting window."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Blended Rand / Ton"
            value={RPT(model.rpt)}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <Stat
            label="Total tonnes"
            value={NUM(model.totals.tons)}
            icon={<Activity className="h-4 w-4" />}
          />
          <Stat
            label="Total recorded spend"
            value={ZAR(model.totals.total)}
            icon={<ClipboardCheck className="h-4 w-4" />}
          />
          <Stat
            label="Variable cost share"
            value={`${model.variableShare.toFixed(1)}%`}
            sub={`Static costs: ${ZAR(model.totals.statics)}`}
            icon={<TrendingUp className="h-4 w-4" />}
          />
        </div>
      </section>

      {/* Management summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Management intelligence
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Observations generated from recorded operational data.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {model.managementInsights.map((insight, index) => (
            <div key={index} className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm leading-relaxed">{insight}</p>
            </div>
          ))}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Indicators describe recorded data and do not establish the cause of an operational event
            or predict future performance.
          </p>
        </CardContent>
      </Card>

      {/* Cost charts */}
      <section>
        <SectionHeading
          title="Cost and production trends"
          description="Monthly cost composition and rand-per-ton performance."
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cost composition by month</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {model.months.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={model.allMonths}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(value) => ZAR(Number(value))} />
                    <Legend />
                    <Bar dataKey="statics" stackId="a" name="Static" fill={COLORS.statics} />
                    <Bar dataKey="maintenance" stackId="a" name="Maintenance" fill={COLORS.maint} />
                    <Bar dataKey="magnetite" stackId="a" name="Magnetite" fill={COLORS.mag} />
                    <Bar dataKey="overtime" stackId="a" name="Overtime" fill={COLORS.ot} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rand per ton trend</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {model.months.length === 0 ? (
                <Empty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={model.allMonths}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(value) => ZAR(Number(value))} />
                    <Line
                      type="monotone"
                      dataKey="rpt"
                      name="R / ton"
                      stroke={COLORS.mag}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Production by month */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly production volume</CardTitle>
          <p className="text-sm text-muted-foreground">
            Total recorded tonnes for each month in the reporting window.
          </p>
        </CardHeader>
        <CardContent className="h-[300px]">
          {model.allMonths.some((month) => month.tons > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.allMonths}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(value) => `${NUM(Number(value))} tonnes`} />
                <Bar
                  dataKey="tons"
                  name="Production"
                  fill={COLORS.production}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </CardContent>
      </Card>

      {/* Cost per mine */}
      <Card>
        <CardHeader>
          <CardTitle>Direct cost per ton by mine</CardTitle>
          <p className="text-sm text-muted-foreground">
            Mine-level comparison uses production-linked variable costs and maintenance costs linked
            through equipment. Static costs are excluded because this calculation does not allocate
            them to individual mines.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {model.perMine.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mines yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mine</TableHead>
                  <TableHead className="text-right">Tonnes</TableHead>
                  <TableHead className="text-right">Variable</TableHead>
                  <TableHead className="text-right">Maintenance</TableHead>
                  <TableHead className="text-right">Direct total</TableHead>
                  <TableHead className="text-right">R / ton</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.perMine.map((mine) => (
                  <TableRow key={mine.id}>
                    <TableCell className="font-medium">{mine.name}</TableCell>
                    <TableCell className="text-right">{NUM(mine.tons)}</TableCell>
                    <TableCell className="text-right">{ZAR(mine.variable)}</TableCell>
                    <TableCell className="text-right">{ZAR(mine.maintenance)}</TableCell>
                    <TableCell className="text-right">{ZAR(mine.directCost)}</TableCell>
                    <TableCell className="text-right font-semibold">{RPT(mine.rpt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Monthly ledger */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly financial ledger</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recorded production and cost components for each month.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {model.months.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cost data yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Tonnes</TableHead>
                  <TableHead className="text-right">Static</TableHead>
                  <TableHead className="text-right">Maintenance</TableHead>
                  <TableHead className="text-right">Magnetite</TableHead>
                  <TableHead className="text-right">Overtime</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">R / ton</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.months.map((month) => (
                  <TableRow key={month.key}>
                    <TableCell className="font-medium">{month.month}</TableCell>
                    <TableCell className="text-right">{NUM(month.tons)}</TableCell>
                    <TableCell className="text-right">{ZAR(month.statics)}</TableCell>
                    <TableCell className="text-right">{ZAR(month.maintenance)}</TableCell>
                    <TableCell className="text-right">{ZAR(month.magnetite)}</TableCell>
                    <TableCell className="text-right">{ZAR(month.overtime)}</TableCell>
                    <TableCell className="text-right">{ZAR(month.total)}</TableCell>
                    <TableCell className="text-right font-semibold">{RPT(month.rpt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Downtime */}
      <section>
        <SectionHeading
          title="Downtime analysis"
          description="Recent event frequency and reported downtime reasons."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Stat
            label="Downtime events (30d)"
            value={NUM(model.downtimeLast30.length)}
            icon={<Clock className="h-4 w-4" />}
          />
          <Stat
            label="Known downtime duration (30d)"
            value={model.downtimeHasDuration ? `${NUM(model.downtimeHours)} hours` : "Unavailable"}
            sub={
              model.downtimeHasDuration
                ? "From recorded duration or start/end fields"
                : "Duration is not present in recognised source fields"
            }
            icon={<Activity className="h-4 w-4" />}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Downtime events by reason</CardTitle>
            <p className="text-sm text-muted-foreground">
              Event counts grouped by the reason recorded in the source data.
            </p>
          </CardHeader>
          <CardContent className="h-[320px]">
            {model.downtimeByReason.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={model.downtimeByReason}
                  layout="vertical"
                  margin={{ left: 12, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="reason" width={130} fontSize={11} />
                  <Tooltip formatter={(value) => `${NUM(Number(value))} events`} />
                  <Bar
                    dataKey="events"
                    name="Events"
                    fill={COLORS.downtime}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <p className="mt-2 text-xs text-muted-foreground">
          Downtime duration is only reported when a recognised duration field or valid start/end
          timestamp pair exists. Event counts are not a substitute for confirmed hours lost.
        </p>
      </section>

      {/* Maintenance */}
      <section>
        <SectionHeading
          title="Maintenance performance"
          description="Maintenance workload, spend and upcoming service exposure."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Stat
            label="Overdue records"
            value={NUM(model.overdueMaintenance.length)}
            icon={<AlertTriangle className="h-4 w-4" />}
            warning={model.overdueMaintenance.length > 0}
          />
          <Stat
            label="Due in next 30 days"
            value={NUM(model.upcomingMaintenance.length)}
            icon={<ClipboardCheck className="h-4 w-4" />}
          />
          <Stat
            label="Maintenance spend (MTD)"
            value={ZAR(model.maintenanceSpendMTD)}
            icon={<Wrench className="h-4 w-4" />}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Maintenance status summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              label="Overdue maintenance records"
              count={model.overdueMaintenance.length}
              warning
            />
            <StatusRow
              label="Upcoming maintenance records"
              count={model.upcomingMaintenance.length}
            />
            <StatusRow
              label="Maintenance records this month"
              count={model.maintenanceThisMonth.length}
            />
          </CardContent>
        </Card>
      </section>

      {/* Equipment */}
      <section>
        <SectionHeading
          title="Equipment lifecycle"
          description="Expected-life consumption using recorded tonnes since installation."
        />

        <Card>
          <CardHeader>
            <CardTitle>Equipment with lowest remaining expected life</CardTitle>
          </CardHeader>
          <CardContent>
            {model.equipmentWear.length === 0 ? (
              <Empty />
            ) : (
              <div className="space-y-4">
                {model.equipmentWear.map((item) => (
                  <div key={item.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="mt-1 h-2 overflow-hidden rounded bg-secondary">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${item.consumed}%`,
                            background:
                              item.remaining < 20
                                ? "#ef4444"
                                : item.remaining < 50
                                  ? "#f59e0b"
                                  : "#10b981",
                          }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {Math.round(item.consumed)}% of expected life consumed
                      </div>
                    </div>
                    <Badge variant={item.remaining < 20 ? "destructive" : "secondary"}>
                      {Math.round(item.remaining)}% remaining
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-2 text-xs text-muted-foreground">
          This is a tonnage-life indicator, not a utilisation rate. Operating utilisation requires
          recorded operating hours and available hours.
        </p>
      </section>

      {/* Inventory and procurement */}
      <section>
        <SectionHeading
          title="Inventory and procurement"
          description="Stock availability and purchase-order workflow indicators."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Inventory value"
            value={ZAR(model.inventoryValue)}
            icon={<Boxes className="h-4 w-4" />}
          />
          <Stat
            label="Low-stock items"
            value={NUM(model.lowStock.length)}
            icon={<Package className="h-4 w-4" />}
            warning={model.lowStock.length > 0}
          />
          <Stat
            label="Stockout items"
            value={NUM(model.stockouts.length)}
            icon={<AlertTriangle className="h-4 w-4" />}
            warning={model.stockouts.length > 0}
          />
          <Stat
            label="Draft purchase orders"
            value={NUM(model.draftPurchaseOrders.length)}
            icon={<ClipboardCheck className="h-4 w-4" />}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Stock requiring attention</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {model.lowStock.length === 0 ? (
              <Empty />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reorder point</TableHead>
                    <TableHead className="text-right">Stock value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.lowStock.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name ?? "Unnamed item"}</TableCell>
                      <TableCell className="text-right">
                        {NUM(item.qty_on_hand)} {item.unit ?? ""}
                      </TableCell>
                      <TableCell className="text-right">{NUM(item.reorder_point)}</TableCell>
                      <TableCell className="text-right">
                        {ZAR(numberValue(item.qty_on_hand) * numberValue(item.unit_cost))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={numberValue(item.qty_on_hand) <= 0 ? "destructive" : "secondary"}
                        >
                          {numberValue(item.qty_on_hand) <= 0 ? "Stockout" : "Reorder"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Purchase-order workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow label="Draft orders" count={model.draftPurchaseOrders.length} />
            <StatusRow
              label="Pending/submitted orders"
              count={model.pendingPurchaseOrders.length}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  warning = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <span className={warning ? "text-destructive" : "text-muted-foreground"}>{icon}</span>
        </div>
        <div className={`text-2xl font-bold ${warning ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusRow({
  label,
  count,
  warning = false,
}: {
  label: string;
  count: number;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Badge variant={warning && count > 0 ? "destructive" : "secondary"}>{count}</Badge>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">
      No data available for this reporting period.
    </div>
  );
}
