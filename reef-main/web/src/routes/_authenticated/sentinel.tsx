
 


import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";

import { useList } from "@/lib/reef-db";
import { detectReefRisks } from "@/lib/reef-sentinel";
import type { SentinelRisk } from "@/lib/reef-sentinel";
import { PageHeader } from "@/components/PageHeader";
import { SentinelResponseCentre } from "@/components/SentinelResponseCentre";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/sentinel")({
  component: SentinelPage,
  head: () => ({
    meta: [
      { title: "REEF Sentinel — REEF Operations" },
      {
        name: "description",
        content: "Operational risk intelligence and response management.",
      },
    ],
  }),
});

function SentinelPage() {
  const equipment = useList<any>("equipment");
  const maintenance = useList<any>("maintenance_logs");
  const stock = useList<any>("stock_items");
  const downtime = useList<any>("downtime_events");
  const production = useList<any>("production_logs");
  const mines = useList<any>("mines");

  const risks: SentinelRisk[] = useMemo(
    () =>
      detectReefRisks({
        equipment: equipment.data ?? [],
        maintenance: maintenance.data ?? [],
        stock: stock.data ?? [],
        downtime: downtime.data ?? [],
        production: production.data ?? [],
        mines: mines.data ?? [],
      }),
    [
      equipment.data,
      maintenance.data,
      stock.data,
      downtime.data,
      production.data,
      mines.data,
    ],
  );

  const high = risks.filter((risk) => risk.level === "High").length;
  const medium = risks.filter((risk) => risk.level === "Medium").length;
  const low = risks.filter((risk) => risk.level === "Low").length;

  const categories = [
    "Equipment",
    "Maintenance",
    "Inventory",
    "Downtime",
    "Production",
  ] as const;

  return (
    <div className="reef-fade-up space-y-6">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <PageHeader
        title="REEF Sentinel"
        description="Operational risk intelligence, investigation and response management."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total risks" value={risks.length} />
        <StatCard title="High priority" value={high} />
        <StatCard title="Medium priority" value={medium} />
        <StatCard title="Low priority" value={low} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Risk intelligence overview
          </CardTitle>
          <CardDescription>
            Distribution of detected risks across operational categories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {categories.map((category) => {
              const count = risks.filter(
                (risk) => risk.category === category,
              ).length;

              return (
                <div key={category} className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">{category}</p>
                  <p className="mt-2 text-2xl font-semibold">{count}</p>
                  <p className="text-xs text-muted-foreground">
                    {count === 1 ? "identified risk" : "identified risks"}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Priority risk register
          </CardTitle>
          <CardDescription>
            Detected operational risks, ordered by risk score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {risks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No risks currently detected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sentinel will display risks when operational records meet its
                detection rules.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {risks.map((risk) => (
                <div
                  key={risk.id}
                  className="flex flex-col justify-between gap-4 rounded-lg border p-4 md:flex-row md:items-center"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          risk.level === "High"
                            ? "destructive"
                            : risk.level === "Medium"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {risk.level}
                      </Badge>
                      <Badge variant="outline">{risk.category}</Badge>
                    </div>

                    <h3 className="font-semibold">{risk.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {risk.asset}
                    </p>
                    <p className="text-sm">{risk.evidence}</p>
                    <p className="text-xs text-muted-foreground">
                      Risk score: {risk.score}/25
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Recommended action: </span>
                      {risk.recommendedAction}
                    </p>
                  </div>

                  <div className="shrink-0 text-sm text-muted-foreground">
                    {new Date(risk.detectedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <SentinelResponseCentre risks={risks} />
    </div>
  );
}

function StatCard({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Based on current operational records
        </p>
      </CardContent>
    </Card>
  );
}
