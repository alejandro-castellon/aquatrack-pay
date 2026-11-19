// Corre las pruebas que no necesitan la plataforma: las reglas de dominio
// (monto, referencia, verificador de pagos) y el acceso a Stellar.
// Las demás pruebas del módulo (casos de uso, controladores, repositorios)
// dependen de la plataforma de AquaTrack y están aquí para leerse.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/test/unit/shared/stellar/**/*.spec.ts',
    '<rootDir>/test/unit/water-charge/domain/**/*.spec.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { esModuleInterop: true, allowSyntheticDefaultImports: true } },
    ],
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
};
