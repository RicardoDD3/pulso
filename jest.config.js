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
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
  collectCoverageFrom: [
    "lib/**/*.{js,jsx,ts,tsx}",
    "app/api/**/*.{js,jsx,ts,tsx}",
    "!**/*.d.ts",
    "!lib/db/migrations/**",
  ],
};

module.exports = createJestConfig(customJestConfig);
