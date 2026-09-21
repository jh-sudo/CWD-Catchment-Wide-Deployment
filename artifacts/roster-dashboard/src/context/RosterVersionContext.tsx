import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface Ctx { version: number; bumpVersion: () => void; }
const RosterVersionContext = createContext<Ctx>({ version: 0, bumpVersion: () => {} });

export function RosterVersionProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const queryClient = useQueryClient();
  const serverRevision = useRef<string | null>(null);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    const onFocus = () => bumpVersion();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [bumpVersion]);

  // Poll a cheap "has anything changed" signal so a change made in another
  // browser/session invalidates local data within ~10s, instead of only on
  // window focus. .scratch/replit-resync-2026-09-21/issues/28.
  useEffect(() => {
    let active = true;

    const checkCentralRoster = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/roster-plan/version", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) return;
        const data = await response.json() as { revision?: string };
        if (!active || !data.revision) return;

        if (serverRevision.current === null) {
          serverRevision.current = data.revision;
          return;
        }
        if (serverRevision.current === data.revision) return;

        serverRevision.current = data.revision;
        await queryClient.invalidateQueries({
          predicate: query => JSON.stringify(query.queryKey).includes("roster"),
        });
        if (active) bumpVersion();
      } catch {
        // Keep the current view during a temporary connection failure.
      }
    };

    void checkCentralRoster();
    const timer = window.setInterval(() => void checkCentralRoster(), 10_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkCentralRoster();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bumpVersion, queryClient]);

  return (
    <RosterVersionContext.Provider value={{ version, bumpVersion }}>
      {children}
    </RosterVersionContext.Provider>
  );
}

export const useRosterVersion = () => useContext(RosterVersionContext);
