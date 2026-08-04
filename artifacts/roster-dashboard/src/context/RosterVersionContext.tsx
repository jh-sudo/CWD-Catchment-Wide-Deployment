import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

interface Ctx { version: number; bumpVersion: () => void; }
const RosterVersionContext = createContext<Ctx>({ version: 0, bumpVersion: () => {} });

export function RosterVersionProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    const onFocus = () => bumpVersion();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [bumpVersion]);

  return (
    <RosterVersionContext.Provider value={{ version, bumpVersion }}>
      {children}
    </RosterVersionContext.Provider>
  );
}

export const useRosterVersion = () => useContext(RosterVersionContext);
