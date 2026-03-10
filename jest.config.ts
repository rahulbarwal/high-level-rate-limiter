import type { Config } from "jest";

const ESM_PACKAGES = ['uuid'].join('|');

const config: Config = {
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      transform: {
        "^.+\\.tsx?$": ["ts-jest", {}],
        "^.+\\.js$": ["ts-jest", { allowJs: true }],
      },
      transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES})/)`],
      testEnvironment: "node",
    },
    {
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      transform: {
        "^.+\\.tsx?$": ["ts-jest", {}],
        "^.+\\.js$": ["ts-jest", { allowJs: true }],
      },
      transformIgnorePatterns: [`/node_modules/(?!(${ESM_PACKAGES})/)`],
      testEnvironment: "node",
    },
  ],
};

export default config;
