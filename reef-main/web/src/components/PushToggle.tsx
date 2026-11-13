import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  PUSH_STATE_KEY,
  disablePush,
  enablePush,
  getPushState,
  sendTestPush,
  type PushState,
} from "@/lib/push";

const MESSAGE: Record<PushState, string> = {
  unsupported: "This browser can't show phone alerts. Try Chrome on Android, or the installed app.",
  "ios-install":
    "On iPhone, first add Reef Ops to your Home Screen (Share, then Add to Home Screen). Open it from there to turn on alerts.",
  "server-off": "Phone alerts aren't set up on the server yet.",
  blocked:
    "Alerts are blocked for this site. Allow notifications in your browser or phone settings, then reload.",
  off: "Get service reminders on this device, even when the app is closed.",
  on: "Alerts are on for this device.",
};

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}

/** The "Phone alerts" part of the notification panel. */
export function PushToggle() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: PUSH_STATE_KEY,
    queryFn: getPushState,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const setState = (state: PushState) =>
    qc.setQueryData(PUSH_STATE_KEY, { state, config: data?.config ?? null });

  const turnOn = useMutation({
    mutationFn: () => enablePush(data?.config?.public_key ?? ""),
    onSuccess: (state) => {
      setState(state);
      if (state === "on") toast.success("Alerts turned on for this device");
      if (state === "blocked") toast.error("Alerts were blocked. You can allow them in settings.");
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const turnOff = useMutation({
    mutationFn: () => disablePush(),
    onSuccess: (state) => {
      setState(state);
      toast.success("Alerts turned off for this device");
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const test = useMutation({
    mutationFn: sendTestPush,
    onSuccess: (r) => {
      if (r.sent > 0) toast.success("Test sent. It should appear in a few seconds.");
      else toast.error("The test couldn't be delivered. Turn alerts off and on again.");
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const busy = turnOn.isPending || turnOff.isPending || test.isPending;
  const state: PushState | null = data?.state ?? null;

  return (
    <section aria-labelledby="push-heading" className="border-t px-4 py-3">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="push-heading" className="text-sm font-semibold">
          Phone alerts
        </h3>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {isLoading
          ? "Checking this device…"
          : isError || !state
            ? "Couldn't check alerts. Check your connection and try again."
            : MESSAGE[state]}
      </p>

      {state === "off" && (
        <Button size="sm" className="mt-2" onClick={() => turnOn.mutate()} disabled={busy}>
          <BellRing className="mr-1 h-4 w-4" />
          {turnOn.isPending ? "Turning on…" : "Turn on alerts"}
        </Button>
      )}

      {state === "on" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={busy}>
            <Send className="mr-1 h-4 w-4" />
            {test.isPending ? "Sending…" : "Send test"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => turnOff.mutate()} disabled={busy}>
            <BellOff className="mr-1 h-4 w-4" />
            Turn off
          </Button>
        </div>
      )}
    </section>
  );
}
