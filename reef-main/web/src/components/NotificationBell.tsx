import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck, Wrench } from "lucide-react";
import type { Notification } from "@reef/shared";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PushToggle } from "@/components/PushToggle";
import { PUSH_STATE_KEY, getPushState } from "@/lib/push";
import {
  NOTIFICATIONS_KEY,
  NOTIFICATIONS_POLL_MS,
  fetchNotifications,
  markNotificationRead,
  timeAgo,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/**
 * The bell in the top bar for owners and managers. It shows the service reminders the daily
 * sweep raises (GET /api/v1/notifications), a red count of unread ones, and lets the person
 * mark them read (PATCH /api/v1/notifications/:id/read). It checks again every minute while
 * the tab is open, and whenever the person comes back to the tab.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => fetchNotifications(),
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // Check this device's alerts once per sign-in. If the browser is already subscribed, this
  // files it under the person now signed in, so a shared phone keeps working after a sign-out.
  useEffect(() => {
    void qc.prefetchQuery({ queryKey: PUSH_STATE_KEY, queryFn: getPushState, retry: false });
  }, [qc]);

  // A push that arrives while the app is open refreshes the bell straight away.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "reef-push") {
        void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [qc]);

  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at);
  const unreadCount = unread.length;

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => markNotificationRead(id)));
    },
    onMutate: async (ids) => {
      // Update the screen straight away; the next fetch confirms it.
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = qc.getQueryData<Notification[]>(NOTIFICATIONS_KEY);
      const now = new Date().toISOString();
      qc.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (rows) =>
        (rows ?? []).map((n) => (ids.includes(n.id) ? { ...n, read_at: now } : n)),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) qc.setQueryData(NOTIFICATIONS_KEY, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const label = unreadCount === 0 ? "Notifications" : `Notifications, ${unreadCount} unread`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(unread.map((n) => n.id))}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Couldn't load notifications. Check your connection and try again.
            </p>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium">You're all caught up</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Service reminders for your machines will show here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn("flex gap-3 px-4 py-3", !n.read_at && "bg-amber-50/70")}
                >
                  <div className="mt-0.5 shrink-0 rounded-full bg-amber-100 p-1.5 text-amber-800">
                    <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <time dateTime={n.created_at} className="text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </time>
                      {n.equipment_id && (
                        <Link
                          to="/equipment"
                          onClick={() => setOpen(false)}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          View equipment
                        </Link>
                      )}
                      {!n.read_at && (
                        <button
                          type="button"
                          onClick={() => markRead.mutate([n.id])}
                          disabled={markRead.isPending}
                          className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                          aria-label={`Mark "${n.subject}" as read`}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                  {!n.read_at && (
                    <>
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600"
                      />
                      <span className="sr-only">Unread</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <PushToggle />
      </PopoverContent>
    </Popover>
  );
}
