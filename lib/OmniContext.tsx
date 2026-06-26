"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { OmniStore, type OmniConfig } from "./store";
import { selectViewModel, type ViewModel } from "./viewModel";
import type { OmniState } from "./types";

const StoreCtx = createContext<OmniStore | null>(null);

export function OmniProvider({
  config,
  children,
}: {
  config?: OmniConfig;
  children: React.ReactNode;
}) {
  const ref = useRef<OmniStore | null>(null);
  if (ref.current === null) ref.current = new OmniStore(config);
  const store = ref.current;

  // Client-only: hydrate the store from the real backend.
  useEffect(() => {
    void store.bootstrap();
  }, [store]);

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): OmniStore {
  const store = useContext(StoreCtx);
  if (!store) throw new Error("useStore must be used within <OmniProvider>");
  return store;
}

export function useOmniState(): OmniState {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/** Subscribe to the store and compute the full view-model for this render. */
export function useViewModel(): ViewModel {
  const store = useStore();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return selectViewModel(store, state);
}
