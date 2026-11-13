import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  Loader2,
  Save,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { SentinelRisk } from "@/lib/reef-sentinel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ResponseStatus = "open" | "in_progress" | "blocked" | "resolved";

type SentinelResponse = {
  id: string;
  risk_key: string;
  risk_type: string;
  entity_type: "equipment" | "stock_item";
  entity_id: string;
  status: ResponseStatus;
  assigned_to: string | null;
  response_notes: string | null;
  target_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ResponseHistory = {
  id: string;
  response_id: string;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  old_assigned_to: string | null;
  new_assigned_to: string | null;
  note: string | null;
  changed_by: string | null;
  created_at: string;
};

type ResponseDraft = {
  status: ResponseStatus;
  assignedTo: string;
  targetDate: string;
  notes: string;
};

const statusLabels: Record<ResponseStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
};

function statusVariant(
  status: ResponseStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "resolved":
      return "default";
    case "blocked":
      return "destructive";
    case "in_progress":
      return "secondary";
    default:
      return "outline";
  }
}

function getRiskIdentity(risk: SentinelRisk): {
  riskType: string;
  entityType: "equipment" | "stock_item";
  entityId: string;
} | null {
  const separator = risk.id.indexOf(":");

  if (separator === -1) return null;

  const riskType = risk.id.slice(0, separator);
  const entityId = risk.id.slice(separator + 1);

  if (!entityId) return null;

  if (
    riskType === "equipment_lifespan" ||
    riskType === "maintenance_overdue"
  ) {
    return {
      riskType,
      entityType: "equipment",
      entityId,
    };
  }

  if (riskType === "inventory") {
    return {
      riskType,
      entityType: "stock_item",
      entityId,
    };
  }

  return null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ResponseHistoryPanel({
  responseId,
}: {
  responseId: string;
}) {
  const history = useQuery({
    queryKey: ["sentinel-response-history", responseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentinel_response_history" as any)
        .select("*")
        .eq("response_id", responseId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []) as unknown as ResponseHistory[];
    },
  });

  if (history.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading response history…
      </div>
    );
  }

  if (history.isError) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
        Could not load response history: {history.error.message}
      </div>
    );
  }

  if (!history.data?.length) {
    return (
      <p className="py-3 text-xs text-muted-foreground">
        No history events have been recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {history.data.map((event) => (
        <div
          key={event.id}
          className="relative border-l border-border pl-4"
        >
          <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">
              {event.event_type.replaceAll("_", " ")}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {formatDate(event.created_at)}
            </span>
          </div>

          {(event.old_status || event.new_status) && (
            <p className="mt-1 text-xs text-muted-foreground">
              Status: {event.old_status ?? "—"} → {event.new_status ?? "—"}
            </p>
          )}

          {(event.old_assigned_to || event.new_assigned_to) && (
            <p className="mt-1 break-all text-xs text-muted-foreground">
              Assignee: {event.old_assigned_to ?? "Unassigned"} →{" "}
              {event.new_assigned_to ?? "Unassigned"}
            </p>
          )}

          {event.note && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {event.note}
            </p>
          )}

          {event.changed_by && (
            <p className="mt-1 break-all text-[10px] text-muted-foreground">
              Changed by: {event.changed_by}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ResponseEditor({
  risk,
  response,
}: {
  risk: SentinelRisk;
  response?: SentinelResponse;
}) {
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<ResponseDraft>({
    status: response?.status ?? "open",
    assignedTo: response?.assigned_to ?? "",
    targetDate: response?.target_date ?? "",
    notes: response?.response_notes ?? "",
  });

  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft({
      status: response?.status ?? "open",
      assignedTo: response?.assigned_to ?? "",
      targetDate: response?.target_date ?? "",
      notes: response?.response_notes ?? "",
    });
  }, [
    response?.id,
    response?.status,
    response?.assigned_to,
    response?.target_date,
    response?.response_notes,
  ]);

  const identity = getRiskIdentity(risk);

  const saveResponse = useMutation({
    mutationFn: async () => {
      if (!identity) {
        throw new Error(
          "This finding does not have a supported response type.",
        );
      }

      const payload = {
        risk_key: risk.id,
        risk_type: identity.riskType,
        entity_type: identity.entityType,
        entity_id: identity.entityId,
        status: draft.status,
        assigned_to: draft.assignedTo.trim() || null,
        target_date: draft.targetDate || null,
        response_notes: draft.notes.trim() || null,
      };

      const { data, error } = await supabase
        .from("sentinel_responses" as any)
        .upsert(payload, { onConflict: "risk_key" })
        .select("*")
        .single();

      if (error) throw error;

      return data as unknown as SentinelResponse;
    },

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sentinel-responses"],
      });

      await queryClient.invalidateQueries({
        queryKey: ["sentinel-response-history"],
      });

      toast.success("Response saved successfully.");
    },

    onError: (error: Error) => {
      toast.error(error.message || "Could not save the response.");
    },
  });

  if (!identity) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500">
        This risk type cannot currently be linked to a response record.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">
            {response ? "Manage response" : "Create response"}
          </span>
        </div>

        {response ? (
          <Badge variant={statusVariant(response.status)}>
            {statusLabels[response.status]}
          </Badge>
        ) : (
          <Badge variant="outline">Not yet recorded</Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
            Response status
          </label>

          <Select
            value={draft.status}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                status: value as ResponseStatus,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            Target date
          </label>

          <Input
            type="date"
            value={draft.targetDate}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                targetDate: event.target.value,
              }))
            }
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium">
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          Assignee user UUID
        </label>

        <Input
          value={draft.assignedTo}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              assignedTo: event.target.value,
            }))
          }
          placeholder="Paste the assigned user's UUID (optional)"
        />

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          The UUID must belong to a valid user who is permitted to be assigned
          to this response. Leave blank to remove the assignment.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">Response notes</label>

        <textarea
          value={draft.notes}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          rows={4}
          placeholder="Record the action taken, investigation findings, blockers or next steps…"
          className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] text-muted-foreground">
          {response
            ? `Last updated ${formatDate(response.updated_at)}`
            : "This response will be stored in the REEF database."}
        </p>

        <Button
          size="sm"
          onClick={() => saveResponse.mutate()}
          disabled={saveResponse.isPending}
          className="gap-2"
        >
          {saveResponse.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saveResponse.isPending ? "Saving…" : "Save response"}
        </Button>
      </div>

      {response && (
        <div className="border-t border-border/70 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory((current) => !current)}
            className="w-full justify-between px-2 text-xs"
          >
            <span className="flex items-center gap-2">
              <Clock3 className="h-3.5 w-3.5" />
              Response history
            </span>

            {showHistory ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>

          {showHistory && (
            <div className="mt-3 rounded-lg border border-border/60 bg-background p-3">
              <ResponseHistoryPanel responseId={response.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SentinelResponseCentre({
  risks,
}: {
  risks: SentinelRisk[];
}) {
  const responses = useQuery({
    queryKey: ["sentinel-responses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentinel_responses" as any)
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return (data ?? []) as unknown as SentinelResponse[];
    },
  });

  const responseByRisk = useMemo(() => {
    const result = new Map<string, SentinelResponse>();

    for (const response of responses.data ?? []) {
      result.set(response.risk_key, response);
    }

    return result;
  }, [responses.data]);

  const orderedRisks = useMemo(
    () => [...risks].sort((a, b) => b.score - a.score),
    [risks],
  );

  const responseCounts = useMemo(() => {
    const counts = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      resolved: 0,
    };

    for (const response of responses.data ?? []) {
      counts[response.status] += 1;
    }

    return counts;
  }, [responses.data]);

  if (responses.isLoading) {
    return (
      <Card className="border-border/70">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved response records…
        </CardContent>
      </Card>
    );
  }

  if (responses.isError) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="flex items-start gap-3 py-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">
              Could not load the Response Centre.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {responses.error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void responses.refetch()}
            >
              Retry loading
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Open
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {responseCounts.open}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              In progress
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {responseCounts.in_progress}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Blocked
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-red-400">
              {responseCounts.blocked}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Resolved
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-500">
              {responseCounts.resolved}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-primary" />
                Persistent response register
              </CardTitle>
              <CardDescription className="mt-1">
                Create and manage operational responses linked to detected
                Sentinel risks.
              </CardDescription>
            </div>

            <Badge variant="outline">
              {responses.data?.length ?? 0} saved responses
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {orderedRisks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-3 font-semibold">No current risk findings</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Response actions will appear here when Sentinel detects risks.
              </p>
            </div>
          ) : (
            orderedRisks.map((risk, index) => {
              const response = responseByRisk.get(risk.id);

              return (
                <div
                  key={risk.id}
                  className="space-y-3 rounded-xl border border-border/70 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            risk.level === "High"
                              ? "destructive"
                              : risk.level === "Medium"
                                ? "secondary"
                                : "default"
                          }
                        >
                          {risk.level} risk
                        </Badge>

                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {risk.category}
                        </span>

                        {response && (
                          <Badge variant={statusVariant(response.status)}>
                            {statusLabels[response.status]}
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm font-semibold">
                        {risk.asset} · {risk.title}
                      </p>

                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {risk.recommendedAction}
                      </p>

                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Risk score: {risk.score}/25
                        {response
                          ? ` · Response updated ${formatDate(response.updated_at)}`
                          : " · No response saved"}
                      </p>
                    </div>
                  </div>

                  <ResponseEditor
                    key={`${risk.id}-${response?.id ?? "new"}`}
                    risk={risk}
                    response={response}
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        Response records are subject to REEF database permissions. A failed
        save may indicate that the current user does not have permission to
        create or update a response for the selected plant.
      </div>
    </div>
  );
}