import 'reflect-metadata';

// Export types
export * from './types/StateMachineTypes.js';

// Export implementations
export { StateMachine } from './implementations/StateMachine.js';
export { TransitionValidator } from './implementations/TransitionValidator.js';
export { PhaseExecutor } from './implementations/PhaseExecutor.js';
export { TaskExecutor } from './implementations/TaskExecutor.js';
export { InMemoryPersistence } from './implementations/InMemoryPersistence.js';

// Export default configuration
export const DEFAULT_STATE_MACHINE_CONFIG: IStateMachineConfig = {
  enablePersistence: true,
  enableRetries: true,
  maxRetries: 3,
  retryDelay: 1000,
  enableRollback: true,
  defaultTimeout: 300000, // 5 minutes
  enableMetrics: true
};

import type { IStateMachineConfig } from './types/StateMachineTypes.js';