// The one place that decides which database the app uses. To move to a hosted
// database, write a Store for it (see types.ts) and return it here.
import { sqliteStore } from "./sqlite";
import type { Store } from "./types";

export type { Store, DbStats, CompanyRow, ContractRow, Contradiction, RunResult } from "./types";

export function getStore(): Store {
  return sqliteStore;
}
