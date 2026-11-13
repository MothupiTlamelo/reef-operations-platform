import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Shows a thin bar at the top of the screen while the device has no connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-sm font-medium text-[#0d1b2a]"
    >
      <WifiOff className="h-4 w-4" />
      You're offline. Changes can't be saved until the connection is back.
    </div>
  );
}
