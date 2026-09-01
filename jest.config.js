const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // node_modules is a symlink to node_modules.nosync (keeps iCloud Drive from
  // syncing/corrupting it — this Desktop is iCloud-synced). Restrict the haste
  // crawl to real source dirs so jest never indexes the package tree.
  roots: [
    "<rootDir>/lib",
    "<rootDir>/app",
    "<rootDir>/components",
    "<rootDir>/__tests__",
    "<rootDir>/i18n",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
    "<rootDir>/node_modules.nosync/",
  ],
  collectCoverageFrom: [
    "lib/**/*.{js,jsx,ts,tsx}",
    "app/api/**/*.{js,jsx,ts,tsx}",
    "!**/*.d.ts",
    "!lib/db/migrations/**",
  ],
};

module.exports = createJestConfig(customJestConfig);
