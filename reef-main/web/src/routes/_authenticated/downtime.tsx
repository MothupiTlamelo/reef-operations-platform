import { createFileRoute } from "@tanstack/react-router";
import { useList, type Row } from "@/lib/reef-db";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/downtime")({ component: Page });

const REASON_LABEL: Record<string, string> = {
  breakdown: "Breakdown",
  no_stock: "No stock",
  waiting_on_part: "Waiting on part",
  planned_maintenance: "Planned maintenance",
  other: "Other",
};

function Page() {
  const list = useList<Row<"downtime_events">>("downtime_events", "start_time");
  const mines = useList<Row<"mines">>("mines");
  const equipment = useList<Row<"equipment">>("equipment");

  const byReason = useMemo(() => {
    const map: Record<string, number> = {};
    (list.data ?? []).forEach((d) => {
      map[d.reason] = (map[d.reason] ?? 0) + Number(d.duration_hours);
    });
    return Object.entries(map).map(([reason, hours]) => ({
      reason: REASON_LABEL[reason] ?? reason,
      hours,
    }));
  }, [list.data]);

  const totalHours = (list.data ?? []).reduce((s, d) => s + Number(d.duration_hours), 0);

  return (
    <div>
      <PageHeader title="Downtime" description="Hours lost by cause, per site." />
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <Card>
          <CardHeader>
            <CardTitle>Total downtime</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalHours.toFixed(1)} h</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Hours by cause</CardTitle>
          </CardHeader>
          <CardContent style={{ height: 200 }}>
            {byReason.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No downtime logged
              </div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={byReason}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="reason" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v) => `${v} h`} />
                  <Bar dataKey="hours" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
      <DataTable
        rows={list.data ?? []}
        columns={[
          {
            key: "start_time",
            label: "When",
            render: (r) => new Date(r.start_time).toLocaleString(),
          },
          {
            key: "mine",
            label: "Mine",
            render: (r) => mines.data?.find((m) => m.id === r.mine_id)?.name ?? "—",
          },
          {
            key: "reason",
            label: "Reason",
            render: (r) => (
              <Badge
                variant={
                  r.reason === "breakdown" || r.reason === "no_stock" ? "destructive" : "secondary"
                }
              >
                {REASON_LABEL[r.reason] ?? r.reason}
              </Badge>
            ),
          },
          {
            key: "equipment",
            label: "Equipment",
            render: (r) => equipment.data?.find((e) => e.id === r.equipment_id)?.name ?? "—",
          },
          {
            key: "duration_hours",
            label: "Hours",
            render: (r) => `${Number(r.duration_hours).toFixed(1)} h`,
          },
          { key: "notes", label: "Notes" },
        ]}
        empty="No downtime events logged yet."
      />
    </div>
  );
}
