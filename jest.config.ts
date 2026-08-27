import type { Config } from 'jest';

const config: Config = {
  watchman: false,
  testEnvironment: 'jsdom',
  // Force the node export conditions so `bson` resolves to its CommonJS build
  // instead of the browser ESM build (which Jest can't parse out of the box).
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons']
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }]
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/', '/tests/e2e/', '/tests/unit/google-geocoding.test.ts', '/tests/unit/inbound-email-signature.test.ts', '/tests/api/']
};

export default config;
