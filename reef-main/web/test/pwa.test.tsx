import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallAppPrompt } from "../src/components/InstallAppPrompt";
import { OfflineBanner } from "../src/components/OfflineBanner";

const publicDir = `${resolve(__dirname, "../public")}/`;

type ManifestIcon = { src: string; sizes: string; purpose?: string };

describe("web app manifest", () => {
  const manifest = JSON.parse(readFileSync(`${publicDir}manifest.webmanifest`, "utf8")) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: ManifestIcon[];
    shortcuts: { url: string }[];
  };

  it("has the fields browsers need to offer install", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url.startsWith("/")).toBe(true);
    expect(manifest.display).toBe("standalone");
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("points only at icon files that exist", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`${publicDir}${icon.src.replace(/^\//, "")}`), icon.src).toBe(true);
    }
    expect(existsSync(`${publicDir}icons/apple-touch-icon.png`)).toBe(true);
  });

  it("shortcuts open worker screens", () => {
    for (const s of manifest.shortcuts) expect(s.url.startsWith("/worker/")).toBe(true);
  });

  it("service worker never caches API or Supabase traffic", () => {
    const sw = readFileSync(`${publicDir}sw.js`, "utf8");
    expect(sw).toContain('url.pathname.startsWith("/api/")');
    expect(sw).toContain("url.origin !== self.location.origin");
    expect(existsSync(`${publicDir}offline.html`)).toBe(true);
  });
});

describe("InstallAppPrompt", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("stays hidden until the browser says the app can be installed", () => {
    render(<InstallAppPrompt />);
    expect(screen.queryByText("Install Reef Ops")).toBeNull();
  });

  it("shows an Install button and opens the browser dialog", async () => {
    render(<InstallAppPrompt />);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      platforms: ["web"],
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByText("Install Reef Ops")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText("Install Reef Ops")).toBeNull();
  });

  it("remembers when the user closes it", () => {
    render(<InstallAppPrompt />);
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("beforeinstallprompt"), {
          platforms: ["web"],
          prompt: vi.fn(),
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
        }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /close install message/i }));
    expect(screen.queryByText("Install Reef Ops")).toBeNull();
    expect(window.localStorage.getItem("reef-install-dismissed-at")).toBeTruthy();
  });
});

describe("OfflineBanner", () => {
  it("appears when the connection drops and goes away when it returns", () => {
    const onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();

    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status").textContent).toMatch(/offline/i);

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
