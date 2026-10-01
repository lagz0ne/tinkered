import { inject } from "vite-plus/test";

/** Stryker's public context carries the selected fault into real child processes. */
declare module "vite-plus/test" {
  interface ProvidedContext {
    activeMutant?: string;
  }
}

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, __STRYKER_ACTIVE_MUTANT__: inject("activeMutant") };
}
