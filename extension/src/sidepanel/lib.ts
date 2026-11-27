import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, K, type PanelToBg, type Reply, type Settings } from "../shared/types";

/** Promise wrapper around chrome.runtime.sendMessage → throws on {ok:false}. */
export function call<T = unknown>(msg: PanelToBg): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r: Reply<T> | undefined) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!r) return reject(new Error("No response from background"));
      if (!r.ok) return reject(new Error(r.error ?? "Request failed"));
      resolve(r.data as T);
    });
  });
}

/** Live view of one chrome.storage key (local or session). */
export function useStorage<T>(area: "local" | "session", key: string | null): T | undefined {
  const [val, setVal] = useState<T | undefined>(undefined);
  useEffect(() => {
    setVal(undefined);
    if (!key) return;
    let alive = true;
    chrome.storage[area].get(key).then((o) => alive && setVal(o[key] as T | undefined));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, a: string) => {
      if (a === area && key in changes) setVal(changes[key].newValue as T | undefined);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [area, key]);
  return val;
}

/** The active tab in the current window, kept in sync (the side panel is shared across tabs). */
export function useActiveTab(): { tabId: number | null; onResdex: boolean } {
  const [state, setState] = useState<{ tabId: number | null; onResdex: boolean }>({ tabId: null, onResdex: false });
  const refresh = useCallback(async () => {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    setState({ tabId: t?.id ?? null, onResdex: !!t?.url?.startsWith("https://resdex.naukri.com/") });
  }, []);
  useEffect(() => {
    void refresh();
    const onUpd = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === "complete" || info.url) void refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpd);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpd);
    };
  }, [refresh]);
  return state;
}

export function scoreColor(score: number) {
  if (score >= 80) return "bg-emerald-600";
  if (score >= 60) return "bg-amber-500";
  return "bg-rose-600";
}

/** Panel preferences (Analyzed-only, auto-sync) persisted in chrome.storage.local; the content script reacts to changes live. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const stored = useStorage<Partial<Settings>>("local", K.settings);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  const update = useCallback(
    (patch: Partial<Settings>) => {
      void chrome.storage.local.set({ [K.settings]: { ...settings, ...patch } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.analyzedOnly, settings.autoSync, settings.scoring, settings.autoSend],
  );
  return [settings, update];
}
