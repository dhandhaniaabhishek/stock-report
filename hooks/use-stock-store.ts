import { useSyncExternalStore } from "react";

import { getStockSnapshot, stockActions, subscribeStockStore } from "@/data/stock-store";

export function useStockStore() {
  const state = useSyncExternalStore(subscribeStockStore, getStockSnapshot, getStockSnapshot);
  return { state, actions: stockActions };
}
