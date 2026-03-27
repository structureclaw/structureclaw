/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.mjs'],
  transform: {},
  testTimeout: 60000,
  forceExit: true,
  globalTeardown: '<rootDir>/tests/teardown.cjs',
};
