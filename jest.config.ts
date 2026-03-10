import type { Config } from "jest";

const config: Config = {
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      transform: {
        "^.+\\.tsx?$": ["ts-jest", {}],
      },
      testEnvironment: "node",
    },
    {
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      transform: {
        "^.+\\.tsx?$": ["ts-jest", {}],
      },
      testEnvironment: "node",
    },
  ],
};

export default config;
