"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
} from "react";
import { getActiveEnv, setActiveEnv, type AtlasEnv } from "@/lib/api";

type Environment = AtlasEnv;

interface EnvironmentContextType {
  environment: Environment;
  setEnvironment: (environment: Environment) => void;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(
  undefined
);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironmentState] = useState<Environment>(getActiveEnv());

  const setEnvironment = (env: Environment) => {
    setEnvironmentState(env);
    setActiveEnv(env);
  };

  return (
    <EnvironmentContext.Provider value={{ environment, setEnvironment }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error("useEnvironment must be used within an EnvironmentProvider");
  }
  return context;
}
