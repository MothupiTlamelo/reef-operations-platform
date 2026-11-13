
 
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { SentinelRisk } from "@/lib/reef-sentinel";

type ResponseStatus = "open" | "in_progress" | "blocked" | "resolved";

type SentinelResponse = {
  id: string;
  risk_key: string;
  risk_type: string;
  entity_type: "equipment" | "stock_item";
  entity_id: string;
  mine_id: string | null;
  plant: string | null;
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
  assigned_to: string;
  target_date: string;
  response_notes: string;
};

const STATUS_LABELS: Record<ResponseStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
};

const STATUS_STYLES: Record<ResponseStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  resolved: "bg-green-100 text-green-800",
};

function getRiskIdentity(risk: SentinelRisk) {
  const separator = risk.id.indexOf(":");
  const riskType = risk.id.slice(0, separator);
  const entityId = risk.id.slice(separator + 1);

  if (!entityId || separator === -1) {
    throw new Error(`Invalid Sentinel risk identity: ${risk.id}`);
  }

  const entityType =
    riskType === "inventory" ? "stock_item" : "equipment";

  return {
    riskKey: risk.id,
    riskType,
    entityType,
    entityId,
  };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </div>
  );
}

function ResponseHistoryPanel({
  responseId,
}: {
  responseId: string;
}) {
  const historyQuery = useQuery({
    queryKey: ["sentinel-response-history", responseId],
    queryFn: async (): Promise<ResponseHistory[]> => {
      const { data, error } = await (supabase as any)
        .from("sentinel_response_history")
        .select("*")
        .eq("response_id", responseId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []) as unknown as ResponseHistory[];
    },
  });

  return (
    <div className="mt-5 border-t pt-4">
      <h4 className="mb-3 text-sm font-semibold">Response history</h4>

      {historyQuery.isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading response history...
        </p>
      )}

      {historyQuery.isError && (
        <ErrorMessage
          message={
            historyQuery.error instanceof Error
              ? historyQuery.error.message
              : "Could not load response history."
          }
        />
      )}

      {!historyQuery.isLoading &&
        !historyQuery.isError &&
        historyQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No history recorded yet.
          </p>
        )}

      <div className="space-y-3">
        {historyQuery.data?.map((event) => (
          <div
            key={event.id}
            className="rounded-lg border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium capitalize">
                {event.event_type.replace(/_/g, " ")}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDate(event.created_at)}
              </span>
            </div>

            {(event.old_status || event.new_status) && (
              <p className="mt-1 text-muted-foreground">
                Status: {event.old_status ?? "—"} →{" "}
                {event.new_status ?? "—"}
              </p>
            )}

            {(event.old_assigned_to || event.new_assigned_to) && (
              <p className="mt-1 break-all text-muted-foreground">
                Assignee: {event.old_assigned_to ?? "Unassigned"} →{" "}
                {event.new_assigned_to ?? "Unassigned"}
              </p>
            )}

            {event.note && (
              <p className="mt-2 whitespace-pre-wrap">{event.note}</p>
            )}

            {event.changed_by && (
              <p className="mt-2 break-all text-xs text-muted-foreground">
                Changed by: {event.changed_by}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResponseEditor({
  risk,
  response,
  onClose,
}: {
  risk: SentinelRisk;
  response?: SentinelResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<ResponseDraft>({
    status: response?.status ?? "open",
    assigned_to: response?.assigned_to ?? "",
    target_date: response?.target_date ?? "",
    response_notes: response?.response_notes ?? "",
  });

  const identity = getRiskIdentity(risk);

  const saveMutation = useMutation({
    mutationFn: async (): Promise<SentinelResponse> => {
      const payload = {
        risk_key: identity.riskKey,
        risk_type: identity.riskType,
        entity_type: identity.entityType,
        entity_id: identity.entityId,
        status: draft.status,
        assigned_to: draft.assigned_to.trim() || null,
        target_date: draft.target_date || null,
        response_notes: draft.response_notes.trim() || null,
      };

      const { data, error } = await (supabase as any)
        .from("sentinel_responses")
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
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not save response.");
    },
  });

  return (
    <div className="space-y-5 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {response ? "Update response" : "Create response"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Record the operational action for this Sentinel risk.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Close
        </button>
      </div>

      <div className="rounded-lg bg-muted/50 p-3">
        <p className="font-medium">{risk.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {risk.asset}
        </p>
        <p className="mt-2 text-sm">{risk.evidence}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">Response status</span>
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value as ResponseStatus,
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Assigned user ID</span>
          <input
            value={draft.assigned_to}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                assigned_to: event.target.value,
              }))
            }
            placeholder="Enter the user's UUID"
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2">
          <span className="font-medium">Target date</span>
          <input
            type="date"
            value={draft.target_date}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                target_date: event.target.value,
              }))
            }
            className="w-full rounded-md border bg-background px-3 py-2"
          />
        </label>

        <label className="space-y-2 text-sm md:col-span-2">
          <span className="font-medium">Response notes</span>
          <textarea
            value={draft.response_notes}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                response_notes: event.target.value,
              }))
            }
            rows={5}
            placeholder="Describe the action taken, next steps, and operational notes..."
            className="w-full resize-y rounded-md border bg-background px-3 py-2"
          />
        </label>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving..." : "Save response"}
        </button>
      </div>

      {response && (
        <ResponseHistoryPanel responseId={response.id} />
      )}
    </div>
  );
}

export function SentinelResponseCentre({
  risks,
}: {
  risks: SentinelRisk[];
}) {
  const [selectedRisk, setSelectedRisk] = useState<SentinelRisk | null>(
    null,
  );

  const responsesQuery = useQuery({
    queryKey: ["sentinel-responses"],
    queryFn: async (): Promise<SentinelResponse[]> => {
      const { data, error } = await (supabase as any)
        .from("sentinel_responses")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return (data ?? []) as unknown as SentinelResponse[];
    },
  });

  const responsesByRisk = useMemo(() => {
    const map = new Map<string, SentinelResponse>();

    for (const response of responsesQuery.data ?? []) {
      map.set(response.risk_key, response);
    }

    return map;
  }, [responsesQuery.data]);

  const counts = useMemo(() => {
    const result: Record<ResponseStatus, number> = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      resolved: 0,
    };

    for (const response of responsesQuery.data ?? []) {
      result[response.status] += 1;
    }

    return result;
  }, [responsesQuery.data]);

  const sortedRisks = useMemo(
    () => [...risks].sort((a, b) => b.score - a.score),
    [risks],
  );

  if (responsesQuery.isLoading) {
    return (
      <div className="rounded-xl border p-6 text-sm text-muted-foreground">
        Loading persistent Sentinel responses...
      </div>
    );
  }

  if (responsesQuery.isError) {
    return (
      <div className="space-y-3 rounded-xl border p-5">
        <h3 className="font-semibold">
          Could not load the Response Centre
        </h3>
        <ErrorMessage
          message={
            responsesQuery.error instanceof Error
              ? responsesQuery.error.message
              : "An unexpected error occurred."
          }
        />
        <button
          type="button"
          onClick={() => void responsesQuery.refetch()}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          Persistent Response Centre
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign, track, and document actions taken against operational
          risks. Responses are stored persistently in REEF.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(Object.keys(STATUS_LABELS) as ResponseStatus[]).map(
          (status) => (
            <div key={status} className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">
                {STATUS_LABELS[status]}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {counts[status]}
              </p>
            </div>
          ),
        )}
      </div>

      {selectedRisk && (
        <ResponseEditor
          key={selectedRisk.id}
          risk={selectedRisk}
          response={responsesByRisk.get(selectedRisk.id)}
          onClose={() => setSelectedRisk(null)}
        />
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Detected risks and responses</h3>
          <span className="text-sm text-muted-foreground">
            {risks.length} detected risks
          </span>
        </div>

        {sortedRisks.length === 0 && (
          <div className="rounded-xl border p-6 text-sm text-muted-foreground">
            No current risks have been detected.
          </div>
        )}

        {sortedRisks.map((risk) => {
          const response = responsesByRisk.get(risk.id);

          return (
            <article
              key={risk.id}
              className="rounded-xl border p-4"
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold">{risk.title}</h4>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      {risk.level} risk
                    </span>
                    {response && (
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[response.status]}`}
                      >
                        {STATUS_LABELS[response.status]}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-muted-foreground">
                    {risk.asset}
                  </p>

                  <p className="mt-2 text-sm">{risk.evidence}</p>

                  <p className="mt-2 text-xs text-muted-foreground">
                    Risk score: {risk.score}/25
                    {response
                      ? ` · Last updated: ${formatDate(response.updated_at)}`
                      : " · No response recorded"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedRisk(risk)}
                  className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {response ? "Manage response" : "Create response"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
