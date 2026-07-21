import React, { createContext, useContext, type ReactNode } from "react";

export type CockpitEnvironment = "dev" | "prod";

export const EnvironmentContext = createContext<CockpitEnvironment>("dev");

export function EnvironmentProvider({ environment, children }: { readonly environment: CockpitEnvironment; readonly children?: ReactNode }) {
  return React.createElement(EnvironmentContext.Provider, { value: environment }, children);
}

export function useCockpitEnvironment(): CockpitEnvironment {
  return useContext(EnvironmentContext);
}
