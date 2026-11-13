import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  type BeforeInstallPromptEvent,
  isIosSafari,
  isStandalone,
  rememberDismissed,
  wasRecentlyDismissed,
} from "@/lib/pwa";

type Mode = "hidden" | "android" | "ios";

/**
 * A small banner at the bottom of the screen inviting the user to install Reef Ops.
 * - Android / Chrome / Edge: shows an "Install" button that opens the browser's install dialog.
 * - iPhone / iPad Safari: shows the Share → "Add to Home Screen" steps (Apple has no install API).
 * Hidden when already installed, or for 14 days after the user closes it.
 */
export function InstallAppPrompt() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    if (isIosSafari()) {
      setMode("ios");
      return;
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("android");
    };
    const onInstalled = () => {
      setDeferred(null);
      setMode("hidden");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  const close = () => {
    rememberDismissed();
    setMode("hidden");
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "dismissed") rememberDismissed();
    setMode("hidden");
  };

  return (
    <div
      role="region"
      aria-label="Install Reef Ops"
      className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div
        className="mx-auto flex max-w-lg items-start gap-3 rounded-lg p-3 text-white shadow-lg"
        style={{ backgroundColor: "#0d1b2a" }}
      >
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Install Reef Ops</p>
          {mode === "android" ? (
            <p className="text-white/80">Add the app to your home screen for quick access.</p>
          ) : (
            <p className="text-white/80">
              Tap <Share className="inline h-4 w-4 align-text-bottom" aria-label="Share" /> then{" "}
              <span className="font-medium text-white">Add to Home Screen</span>.
            </p>
          )}
        </div>
        {mode === "android" && (
          <Button
            size="sm"
            onClick={install}
            className="shrink-0 bg-[#f7d046] text-[#0d1b2a] hover:bg-[#f7d046]/90"
          >
            <Download className="mr-1 h-4 w-4" />
            Install
          </Button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close install message"
          className="shrink-0 rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
