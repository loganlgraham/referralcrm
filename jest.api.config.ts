import type { Config } from 'jest';

const config: Config = {
  watchman: false,
  testEnvironment: 'node',
  testMatch: ['**/tests/api/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  }
};

export default config;
