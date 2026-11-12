
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useList, ZAR, NUM, RPT } from "@/lib/reef-db";
import { useStockOnHand } from "@/hooks/useStock";
import { costPerTon } from "@reef/shared";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  AlertTriangle,
  TrendingUp,
  Boxes,
  Wrench,
  Fuel,
  Activity,
  Clock,
  ClipboardCheck,
  Package,
  ChartNoAxesCombined,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type DataRow = Record<string, any>;

const CHART_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6"];

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDowntimeDate(row: DataRow): Date | null {
  return asDate(
    row.date ??
      row.event_date ??
      row.start_time ??
      row.started_at ??
      row.created_at,
  );
}

function getDowntimeReason(row: DataRow): string {
  return String(
    row.reason ??
      row.downtime_reason ??
      row.category ??
      row.cause ??
      row.description ??
      "Unclassified",
  );
}

function getDowntimeHours(row: DataRow): number | null {
  const hours =
    row.duration_hours ??
    row.downtime_hours ??
    row.hours_lost;

  if (hours !== undefined && hours !== null && Number.isFinite(Number(hours))) {
    return Math.max(0, Number(hours));
  }

  const minutes = row.duration_minutes;
  if (minutes !== undefined && minutes !== null && Number.isFinite(Number(minutes))) {
    return Math.max(0, Number(minutes) / 60);
  }

  const start = asDate(row.start_time ?? row.started_at);
  const end = asDate(row.end_time ?? row.ended_at);

  if (start && end && end >= start) {
    return (end.getTime() - start.getTime()) / 3_600_000;
  }

  return null;
}

function Dashboard() {
  const production = useList<any>("production_logs", "date");
  const maint = useList<any>("maintenance_logs", "date");
  const stock = useStockOnHand();
  const pos = useList<any>("purchase_orders");
  const staticCosts = useList<any>("static_costs", "month");
  const mines = useList<any>("mines");
  const equipment = useList<any>("equipment");
  const downtime = useList<any>("downtime_events");

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthDays = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
    ).getDate();
    const comparablePreviousEnd = new Date(
      previousMonthStart.getFullYear(),
      previousMonthStart.getMonth(),
      Math.min(now.getDate(), previousMonthDays) + 1,
    );

    const productionRows: DataRow[] = production.data ?? [];
    const maintenanceRows: DataRow[] = maint.data ?? [];
    const stockRows: DataRow[] = stock.data ?? [];
    const purchaseOrders: DataRow[] = pos.data ?? [];
    const staticCostRows: DataRow[] = staticCosts.data ?? [];
    const mineRows: DataRow[] = mines.data ?? [];
    const equipmentRows: DataRow[] = equipment.data ?? [];
    const downtimeRows: DataRow[] = downtime.data ?? [];

    const productionMTD = productionRows.filter((row) => {
      const date = asDate(row.date);
      return date && date >= monthStart && date <= now;
    });

    const productionPreviousComparable = productionRows.filter((row) => {
      const date = asDate(row.date);
      return (
        date &&
        date >= previousMonthStart &&
        date < comparablePreviousEnd
      );
    });

    const tonsMTD = productionMTD.reduce(
      (sum, row) => sum + asNumber(row.tons_produced),
      0,
    );

    const tonsPreviousComparable = productionPreviousComparable.reduce(
      (sum, row) => sum + asNumber(row.tons_produced),
      0,
    );

    const productionChange =
      tonsPreviousComparable > 0
        ? ((tonsMTD - tonsPreviousComparable) / tonsPreviousComparable) * 100
        : null;

    const maintenanceMTD = maintenanceRows.filter((row) => {
      const date = asDate(row.date);
      return date && date >= monthStart && date <= now;
    });

    const maintenanceSpend = maintenanceMTD.reduce(
      (sum, row) => sum + asNumber(row.total_cost),
      0,
    );

    const magnetiteSpend = productionMTD.reduce(
      (sum, row) => sum + asNumber(row.magnetite_cost),
      0,
    );

    const overtimeSpend = productionMTD.reduce(
      (sum, row) => sum + asNumber(row.overtime_cost),
      0,
    );

    const staticSpendMTD = staticCostRows
      .filter((row) => {
        const date = asDate(row.month);
        return (
          date &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce((sum, row) => sum + asNumber(row.amount), 0);

    const totalCostMTD =
      maintenanceSpend +
      magnetiteSpend +
      overtimeSpend +
      staticSpendMTD;

    const rpt = costPerTon(totalCostMTD, tonsMTD);

    const inventoryValue = stockRows.reduce(
      (sum, item) =>
        sum + asNumber(item.qty_on_hand) * asNumber(item.unit_cost),
      0,
    );

    const lowStock = stockRows.filter(
      (item) => asNumber(item.qty_on_hand) <= asNumber(item.reorder_point),
    );

    const stockoutItems = stockRows.filter(
      (item) => asNumber(item.qty_on_hand) <= 0,
    );

    const draftPOs = purchaseOrders.filter(
      (order) => String(order.status ?? "").toLowerCase() === "draft",
    );

    const overdueMaintenance = maintenanceRows.filter((row) => {
      const dueDate = asDate(row.next_due_date);
      return dueDate && dueDate < now;
    });

    const nextThirtyDays = new Date(now.getTime() + 30 * 86_400_000);

    const upcomingMaintenance = maintenanceRows.filter((row) => {
      const dueDate = asDate(row.next_due_date);
      return dueDate && dueDate >= now && dueDate <= nextThirtyDays;
    });

    const cutoff30 = new Date(now.getTime() - 30 * 86_400_000);

    const downtimeLast30 = downtimeRows.filter((row) => {
      const date = getDowntimeDate(row);
      return date && date >= cutoff30 && date <= now;
    });

    const downtimeWithDuration = downtimeLast30
      .map((row) => ({
        row,
        hours: getDowntimeHours(row),
      }))
      .filter(
        (item): item is { row: DataRow; hours: number } =>
          item.hours !== null,
      );

    const downtimeHours30 = downtimeWithDuration.reduce(
      (sum, item) => sum + item.hours,
      0,
    );

    const downtimeByReasonMap = new Map<
      string,
      { reason: string; events: number; hours: number }
    >();

    downtimeLast30.forEach((row) => {
      const reason = getDowntimeReason(row);
      const existing = downtimeByReasonMap.get(reason) ?? {
        reason,
        events: 0,
        hours: 0,
      };

      existing.events += 1;

      const hours = getDowntimeHours(row);
      if (hours !== null) existing.hours += hours;

      downtimeByReasonMap.set(reason, existing);
    });

    const downtimeByReason = Array.from(downtimeByReasonMap.values())
      .sort((a, b) => b.events - a.events)
      .slice(0, 6);

    const monthlyProduction: {
      month: string;
      tonnes: number;
      costPerTon: number | null;
    }[] = [];

    const costTrend: { month: string; rpt: number | null }[] = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthProduction = productionRows.filter((row) => {
        const date = asDate(row.date);
        return date && date >= start && date < end;
      });

      const monthMaintenance = maintenanceRows.filter((row) => {
        const date = asDate(row.date);
        return date && date >= start && date < end;
      });

      const monthStaticCosts = staticCostRows.filter((row) => {
        const date = asDate(row.month);
        return (
          date &&
          date.getMonth() === start.getMonth() &&
          date.getFullYear() === start.getFullYear()
        );
      });

      const monthTonnes = monthProduction.reduce(
        (sum, row) => sum + asNumber(row.tons_produced),
        0,
      );

      const monthMagnetite = monthProduction.reduce(
        (sum, row) => sum + asNumber(row.magnetite_cost),
        0,
      );

      const monthOvertime = monthProduction.reduce(
        (sum, row) => sum + asNumber(row.overtime_cost),
        0,
      );

      const monthMaintenanceSpend = monthMaintenance.reduce(
        (sum, row) => sum + asNumber(row.total_cost),
        0,
      );

      const monthStaticSpend = monthStaticCosts.reduce(
        (sum, row) => sum + asNumber(row.amount),
        0,
      );

      const monthTotalCost =
        monthMagnetite +
        monthOvertime +
        monthMaintenanceSpend +
        monthStaticSpend;

      const label = start.toLocaleString("en-ZA", {
        month: "short",
        year: "2-digit",
      });

      monthlyProduction.push({
        month: label,
        tonnes: monthTonnes,
        costPerTon:
          monthTonnes > 0 ? Math.round(monthTotalCost / monthTonnes) : null,
      });

      costTrend.push({
        month: label,
        rpt: monthTonnes > 0 ? Math.round(monthTotalCost / monthTonnes) : null,
      });
    }

    const perMine = mineRows
      .map((mine) => {
        const tonnes = productionRows
          .filter((row) => {
            const date = asDate(row.date);
            return (
              row.mine_id === mine.id &&
              date &&
              date >= cutoff30 &&
              date <= now
            );
          })
          .reduce((sum, row) => sum + asNumber(row.tons_produced), 0);

        return { name: mine.name ?? "Unnamed mine", tonnes };
      })
      .sort((a, b) => b.tonnes - a.tonnes);

    const equipmentWear = equipmentRows
      .map((item) => {
        const expectedLife = asNumber(item.expected_life_tons);
        const usedLife = asNumber(item.tons_since_install);

        if (expectedLife <= 0) return null;

        const consumed = Math.min(
          100,
          Math.max(0, (usedLife / expectedLife) * 100),
        );

        return {
          id: item.id,
          name: item.name ?? "Unnamed equipment",
          consumed,
          remaining: 100 - consumed,
        };
      })
      .filter(
        (
          item,
        ): item is {
          id: string;
          name: string;
          consumed: number;
          remaining: number;
        } => item !== null,
      )
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, 5);

    const costBreakdown = [
      { name: "Static costs", value: staticSpendMTD },
      { name: "Maintenance", value: maintenanceSpend },
      { name: "Magnetite", value: magnetiteSpend },
      { name: "Overtime", value: overtimeSpend },
    ].filter((item) => item.value > 0);

    const managementInsights: string[] = [];

    if (productionChange !== null) {
      managementInsights.push(
        `Production is ${productionChange >= 0 ? "up" : "down"} ${Math.abs(productionChange).toFixed(1)}% compared with the same elapsed period last month.`,
      );
    } else {
      managementInsights.push(
        "There is not enough previous-period production data to calculate a production comparison.",
      );
    }

    if (overdueMaintenance.length > 0) {
      managementInsights.push(
        `${overdueMaintenance.length} maintenance record(s) have passed their recorded next due date.`,
      );
    }

    if (lowStock.length > 0) {
      managementInsights.push(
        `${lowStock.length} stock item(s) are at or below their reorder point.`,
      );
    }

    if (downtimeLast30.length > 0) {
      managementInsights.push(
        `${downtimeLast30.length} downtime event(s) were recorded in the last 30 days.`,
      );
    }

    if (equipmentWear.some((item) => item.remaining < 20)) {
      managementInsights.push(
        "At least one tracked asset has less than 20% of its expected tonnage life remaining.",
      );
    }

    if (managementInsights.length === 0) {
      managementInsights.push(
        "No immediate indicators were identified from the records currently available.",
      );
    }

    return {
      tonsMTD,
      tonsPreviousComparable,
      productionChange,
      totalCostMTD,
      rpt,
      maintenanceSpend,
      maintenanceMTDCount: maintenanceMTD.length,
      inventoryValue,
      lowStock,
      stockoutItems,
      draftPOs,
      overdueMaintenance,
      upcomingMaintenance,
      downtimeLast30,
      downtimeHours30,
      downtimeHasDuration: downtimeWithDuration.length > 0,
      downtimeByReason,
      monthlyProduction,
      costTrend,
      perMine,
      equipmentWear,
      costBreakdown,
      managementInsights,
    };
  }, [
    production.data,
    maint.data,
    stock.data,
    pos.data,
    staticCosts.data,
    mines.data,
    equipment.data,
    downtime.data,
  ]);

  const [drill, setDrill] = useState<
    null | "po" | "stock" | "maint" | "downtime"
  >(null);

  const navigate = useNavigate();

  const COLORS = CHART_COLORS;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Operational performance, risk indicators and management insights across your mines."
      />

      {/* Core management metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          to="/analytics"
          label="Rand / Ton (MTD)"
          value={RPT(stats.rpt)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          to="/production"
          label="Tonnes produced (MTD)"
          value={NUM(stats.tonsMTD)}
          sub={
            stats.productionChange === null
              ? "Previous comparison unavailable"
              : `${stats.productionChange >= 0 ? "+" : ""}${stats.productionChange.toFixed(1)}% vs same period last month`
          }
          icon={<Fuel className="h-4 w-4" />}
        />
        <StatCard
          to="/maintenance"
          label="Maintenance spend (MTD)"
          value={ZAR(stats.maintenanceSpend)}
          sub={`${stats.maintenanceMTDCount} maintenance record(s)`}
          icon={<Wrench className="h-4 w-4" />}
        />
        <StatCard
          to="/inventory"
          label="Inventory value"
          value={ZAR(stats.inventoryValue)}
          sub={`${stats.lowStock.length} item(s) at/below reorder point`}
          icon={<Boxes className="h-4 w-4" />}
        />
      </div>

      {/* Operational alerts */}
      <section>
        <SectionHeading
          title="Operational attention"
          description="Items that may require management or supervisor action."
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AlertCard
            title="Draft purchase orders"
            count={stats.draftPOs.length}
            tone="amber"
            onClick={() => setDrill("po")}
          />
          <AlertCard
            title="Low-stock items"
            count={stats.lowStock.length}
            tone="red"
            onClick={() => setDrill("stock")}
          />
          <AlertCard
            title="Overdue maintenance"
            count={stats.overdueMaintenance.length}
            tone="red"
            onClick={() => setDrill("maint")}
          />
          <AlertCard
            title="Downtime events (30d)"
            count={stats.downtimeLast30.length}
            tone="amber"
            onClick={() => setDrill("downtime")}
          />
        </div>
      </section>

      {/* Management summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartNoAxesCombined className="h-5 w-5 text-primary" />
            Management intelligence
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Automatically generated observations from the available operational records.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats.managementInsights.map((insight, index) => (
              <div key={index} className="flex items-start gap-3">
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-sm leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            These are indicators based on recorded data, not predictions or confirmed causes.
          </p>
        </CardContent>
      </Card>

      {/* Production and cost trends */}
      <section>
        <SectionHeading
          title="Production and cost intelligence"
          description="Six-month operating trends and cost performance."
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Monthly production trend</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {stats.monthlyProduction.some((item) => item.tonnes > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.monthlyProduction}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip
                      formatter={(value: any) => `${NUM(value)} tonnes`}
                    />
                    <Bar
                      dataKey="tonnes"
                      name="Production"
                      fill={COLORS[0]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cost per ton — six-month trend</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {stats.costTrend.some((item) => item.rpt !== null) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.costTrend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip
                      formatter={(value: any) => ZAR(value)}
                    />
                    <Line
                      type="monotone"
                      dataKey="rpt"
                      name="Rand per ton"
                      stroke={COLORS[1]}
                      strokeWidth={2}
                      connectNulls={false}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Mine performance and cost breakdown */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Link
                to="/mines"
                className="transition-colors hover:text-primary"
              >
                Production by mine — last 30 days →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {stats.perMine.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.perMine}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip
                    formatter={(value: any) => `${NUM(value)} tonnes`}
                  />
                  <Bar
                    dataKey="tonnes"
                    name="Production"
                    fill={COLORS[2]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Link
                to="/analytics"
                className="transition-colors hover:text-primary"
              >
                Cost breakdown — month to date →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {stats.costBreakdown.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.costBreakdown}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={95}
                    label
                  >
                    {stats.costBreakdown.map((_, index) => (
                      <Cell
                        key={index}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(value: any) => ZAR(value)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Downtime analysis */}
      <section>
        <SectionHeading
          title="Downtime intelligence"
          description="Recorded downtime events and their reported reasons over the last 30 days."
        />

        <div className="grid gap-4 md:grid-cols-2">
          <MetricPanel
            icon={<Clock className="h-5 w-5" />}
            label="Recorded downtime events"
            value={NUM(stats.downtimeLast30.length)}
            description="Events recorded in the last 30 days"
          />
          <MetricPanel
            icon={<Activity className="h-5 w-5" />}
            label="Known downtime duration"
            value={
              stats.downtimeHasDuration
                ? `${NUM(stats.downtimeHours30)} hours`
                : "Not available"
            }
            description={
              stats.downtimeHasDuration
                ? "Calculated from duration fields or start/end timestamps"
                : "The available records do not expose a recognised duration field"
            }
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Downtime events by reported reason</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {stats.downtimeByReason.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.downtimeByReason}
                  layout="vertical"
                  margin={{ left: 12, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    width={115}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(value: any) => `${NUM(value)} event(s)`}
                  />
                  <Bar
                    dataKey="events"
                    name="Events"
                    fill={COLORS[3]}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Maintenance and equipment */}
      <section>
        <SectionHeading
          title="Maintenance and equipment health"
          description="Maintenance workload and tracked equipment lifecycle indicators."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricPanel
            icon={<AlertTriangle className="h-5 w-5" />}
            label="Overdue maintenance"
            value={NUM(stats.overdueMaintenance.length)}
            description="Records with a next due date in the past"
            warning={stats.overdueMaintenance.length > 0}
          />
          <MetricPanel
            icon={<ClipboardCheck className="h-5 w-5" />}
            label="Upcoming maintenance"
            value={NUM(stats.upcomingMaintenance.length)}
            description="Due within the next 30 days"
          />
          <MetricPanel
            icon={<Wrench className="h-5 w-5" />}
            label="Maintenance records (MTD)"
            value={NUM(stats.maintenanceMTDCount)}
            description={`Recorded spend: ${ZAR(stats.maintenanceSpend)}`}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>
              <Link
                to="/equipment"
                className="transition-colors hover:text-primary"
              >
                Equipment lifecycle — lowest remaining life →
              </Link>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Based on recorded tonnes since installation against expected life in tonnes.
            </p>
          </CardHeader>
          <CardContent>
            {stats.equipmentWear.length === 0 ? (
              <Empty text="No equipment has the expected-life and usage fields needed for this calculation." />
            ) : (
              <ul className="space-y-4">
                {stats.equipmentWear.map((item) => (
                  <li
                    key={item.id}
                    onClick={() => navigate({ to: "/equipment" })}
                    className="flex cursor-pointer items-center gap-3 rounded-md p-1 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {item.name}
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded bg-secondary">
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
                    <Badge
                      variant={
                        item.remaining < 20 ? "destructive" : "secondary"
                      }
                    >
                      {Math.round(item.remaining)}% remaining
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="mt-2 text-xs text-muted-foreground">
          Operating-hour utilisation is not calculated here because the dashboard
          source currently does not establish both operating hours and available
          hours for each asset.
        </p>
      </section>

      {/* Inventory and purchasing */}
      <section>
        <SectionHeading
          title="Inventory and procurement intelligence"
          description="Stock exposure and purchase-order activity."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricPanel
            icon={<Package className="h-5 w-5" />}
            label="Items at/below reorder point"
            value={NUM(stats.lowStock.length)}
            description="Stock items requiring review"
            warning={stats.lowStock.length > 0}
          />
          <MetricPanel
            icon={<Boxes className="h-5 w-5" />}
            label="Stockout items"
            value={NUM(stats.stockoutItems.length)}
            description="Items with zero or negative recorded stock"
            warning={stats.stockoutItems.length > 0}
          />
          <MetricPanel
            icon={<ClipboardCheck className="h-5 w-5" />}
            label="Draft purchase orders"
            value={NUM(stats.draftPOs.length)}
            description="Draft orders awaiting review"
          />
        </div>
      </section>

      {/* Drill-down panel */}
      <Sheet open={drill !== null} onOpenChange={(open) => !open && setDrill(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {drill === "po"
                ? "Draft purchase orders"
                : drill === "stock"
                  ? "Low-stock items"
                  : drill === "maint"
                    ? "Overdue maintenance"
                    : "Recent downtime events"}
            </SheetTitle>
            <SheetDescription>
              {drill === "po"
                ? "Draft orders awaiting review."
                : drill === "stock"
                  ? "Items at or below their recorded reorder point."
                  : drill === "maint"
                    ? "Maintenance records past their next due date."
                    : "Downtime records from the last 30 days."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {drill === "stock" &&
              (stats.lowStock.length === 0 ? (
                <Empty text="Everything is above its reorder point." />
              ) : (
                stats.lowStock.map((item: DataRow) => (
                  <DrillRow
                    key={item.id}
                    title={item.name ?? "Unnamed stock item"}
                    sub={`On hand ${NUM(item.qty_on_hand)} ${item.unit ?? ""} · reorder at ${NUM(item.reorder_point)}`}
                    right={ZAR(
                      asNumber(item.qty_on_hand) * asNumber(item.unit_cost),
                    )}
                  />
                ))
              ))}

            {drill === "maint" &&
              (stats.overdueMaintenance.length === 0 ? (
                <Empty text="No overdue maintenance records." />
              ) : (
                stats.overdueMaintenance.map((row: DataRow) => (
                  <DrillRow
                    key={row.id}
                    title={row.description ?? "Maintenance record"}
                    sub={`Due ${asDate(row.next_due_date)?.toLocaleDateString() ?? "Unknown date"}`}
                    right={ZAR(row.total_cost)}
                  />
                ))
              ))}

            {drill === "po" &&
              (stats.draftPOs.length === 0 ? (
                <Empty text="No draft purchase orders." />
              ) : (
                stats.draftPOs.map((order: DataRow) => (
                  <DrillRow
                    key={order.id}
                    title={
                      order.po_number ??
                      `PO ${String(order.id ?? "").slice(0, 8)}`
                    }
                    sub={`Created ${asDate(order.created_at)?.toLocaleDateString() ?? "Unknown date"}`}
                    right={ZAR(order.total_cost ?? order.total ?? 0)}
                  />
                ))
              ))}

            {drill === "downtime" &&
              (stats.downtimeLast30.length === 0 ? (
                <Empty text="No downtime events recorded in the last 30 days." />
              ) : (
                stats.downtimeLast30.map((row: DataRow, index: number) => {
                  const hours = getDowntimeHours(row);
                  return (
                    <DrillRow
                      key={row.id ?? index}
                      title={getDowntimeReason(row)}
                      sub={
                        getDowntimeDate(row)?.toLocaleString() ??
                        "Date not recorded"
                      }
                      right={
                        hours === null ? "Duration unavailable" : `${NUM(hours)} h`
                      }
                    />
                  );
                })
              ))}
          </div>

          <Button
            className="mt-6 w-full"
            onClick={() => {
              const destination =
                drill === "stock"
                  ? "/inventory"
                  : drill === "maint"
                    ? "/maintenance"
                    : drill === "po"
                      ? "/purchase-orders"
                      : "/analytics";

              setDrill(null);
              navigate({ to: destination });
            }}
          >
            Open full{" "}
            {drill === "stock"
              ? "inventory"
              : drill === "maint"
                ? "maintenance"
                : drill === "po"
                  ? "purchase orders"
                  : "analytics"}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
  to,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  to?: string;
}) {
  const card = (
    <Card
      className={
        to
          ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
          : undefined
      }
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        )}
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}

function AlertCard({
  title,
  count,
  tone,
  onClick,
}: {
  title: string;
  count: number;
  tone: "amber" | "red";
  onClick?: () => void;
}) {
  const color =
    count === 0
      ? "text-muted-foreground"
      : tone === "red"
        ? "text-destructive"
        : "text-accent-foreground";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      className="cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
    >
      <CardContent className="flex items-center gap-3 p-4">
        <AlertTriangle
          className={`h-5 w-5 ${
            count === 0
              ? "text-muted-foreground"
              : tone === "red"
                ? "text-destructive"
                : "text-accent"
          }`}
        />
        <div className="flex-1">
          <div className="text-sm font-medium">{title}</div>
        </div>
        <div className={`text-2xl font-bold ${color}`}>{count}</div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function MetricPanel({
  icon,
  label,
  value,
  description,
  warning = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className={warning ? "text-destructive" : "text-muted-foreground"}>
            {icon}
          </span>
        </div>
        <div className={`mt-2 text-2xl font-bold ${warning ? "text-destructive" : ""}`}>
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function DrillRow({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {sub && (
          <div className="truncate text-xs text-muted-foreground">{sub}</div>
        )}
      </div>
      {right && <div className="shrink-0 text-sm font-semibold">{right}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data available for this period
    </div>
  );
}
