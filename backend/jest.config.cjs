/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.test.mjs',
    '<rootDir>/src/**/__tests__/**/*.test.mjs',
  ],
  transform: {},
};
