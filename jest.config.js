/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // 테스트 파일 경로
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js',
  ],

  // 전체 시작/종료 시 1회 실행
  globalSetup:    './tests/setup/globalSetup.js',
  globalTeardown: './tests/setup/globalTeardown.js',


  // 타임아웃
  testTimeout: 30000,

  // 테스트 종료 후 강제 종료 (Sequelize 커넥션 풀이 남아있어도 종료)
  forceExit: true,

  // mock 초기화
  clearMocks:   true,
  resetMocks:   false,
  restoreMocks: true,

  // 커버리지
  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    'utils/refundCalculator.js',
    'utils/businessDayHelper.js',
    'utils/contractHelper.js',
    '!**/*.test.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};
