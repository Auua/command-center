/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // One worker: the suites share an in-memory MongoDB and a bound HTTP app.
  maxWorkers: 1,
  // First run downloads a mongod binary; queries themselves are fast.
  testTimeout: 30_000,
};
