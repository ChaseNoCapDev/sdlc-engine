/**
 * Core types for the SDLC state machine engine
 */

import type { ISDLCPhase, ISDLCTransition } from '@chasenocap/sdlc-config';

// State machine states
export type MachineState = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

// Phase execution states
export type PhaseState = 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'rolled_back';

// Task execution states
export type TaskState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface IWorkflowInstance {
  id: string;
  workflowId: string;
  name: string;
  state: MachineState;
  currentPhaseId: string | null;
  phaseStates: Map<string, IPhaseInstance>;
  startedAt: Date;
  completedAt?: Date;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface IPhaseInstance {
  phaseId: string;
  state: PhaseState;
  taskStates: Map<string, ITaskInstance>;
  startedAt?: Date;
  completedAt?: Date;
  error?: Error;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

export interface ITaskInstance {
  taskId: string;
  state: TaskState;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: Error;
  retryCount: number;
}

export interface ITransitionContext {
  workflowInstance: IWorkflowInstance;
  fromPhase: ISDLCPhase;
  toPhase: ISDLCPhase;
  transition: ISDLCTransition;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface IPhaseContext {
  workflowInstance: IWorkflowInstance;
  phase: ISDLCPhase;
  phaseInstance: IPhaseInstance;
  metadata?: Record<string, unknown>;
}

export interface ITaskContext {
  phaseContext: IPhaseContext;
  task: { id: string; [key: string]: any };
  taskInstance: ITaskInstance;
  metadata?: Record<string, unknown>;
}

// Event types
export interface IWorkflowEvent {
  type: 'workflow.started' | 'workflow.completed' | 'workflow.failed' | 'workflow.paused' | 'workflow.resumed';
  workflowId: string;
  instanceId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface IPhaseEvent {
  type: 'phase.started' | 'phase.completed' | 'phase.failed' | 'phase.skipped' | 'phase.rolled_back';
  workflowId: string;
  instanceId: string;
  phaseId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface ITransitionEvent {
  type: 'transition.requested' | 'transition.approved' | 'transition.rejected' | 'transition.completed';
  workflowId: string;
  instanceId: string;
  fromPhaseId: string;
  toPhaseId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

// Service interfaces
export interface IStateMachine {
  startWorkflow(workflowId: string, initialData?: Record<string, unknown>): Promise<IWorkflowInstance>;
  pauseWorkflow(instanceId: string): Promise<void>;
  resumeWorkflow(instanceId: string): Promise<void>;
  cancelWorkflow(instanceId: string, reason?: string): Promise<void>;
  getWorkflowInstance(instanceId: string): IWorkflowInstance | undefined;
  transitionToPhase(instanceId: string, targetPhaseId: string, context?: Record<string, unknown>): Promise<void>;
}

export interface IPhaseExecutor {
  executePhase(context: IPhaseContext): Promise<void>;
  validatePhaseCompletion(context: IPhaseContext): Promise<boolean>;
  rollbackPhase(context: IPhaseContext): Promise<void>;
}

export interface ITaskExecutor {
  executeTask(context: ITaskContext): Promise<unknown>;
  validateTaskResult(context: ITaskContext): Promise<boolean>;
}

export interface ITransitionValidator {
  canTransition(context: ITransitionContext): Promise<boolean>;
  validateTransitionConditions(context: ITransitionContext): Promise<string[]>;
  requestApproval(context: ITransitionContext): Promise<boolean>;
}

export interface IWorkflowPersistence {
  saveWorkflowInstance(instance: IWorkflowInstance): Promise<void>;
  loadWorkflowInstance(instanceId: string): Promise<IWorkflowInstance | null>;
  updateWorkflowInstance(instanceId: string, updates: Partial<IWorkflowInstance>): Promise<void>;
  listWorkflowInstances(filter?: { state?: MachineState; workflowId?: string }): Promise<IWorkflowInstance[]>;
}

// Configuration types
export interface IStateMachineConfig {
  enablePersistence?: boolean;
  enableRetries?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  enableRollback?: boolean;
  defaultTimeout?: number;
  enableMetrics?: boolean;
}

// Error types
export class StateMachineError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StateMachineError';
  }
}

export class PhaseExecutionError extends StateMachineError {
  constructor(
    message: string,
    public phaseId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'PHASE_EXECUTION_ERROR', context);
    this.name = 'PhaseExecutionError';
  }
}

export class TransitionError extends StateMachineError {
  constructor(
    message: string,
    public fromPhaseId: string,
    public toPhaseId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'TRANSITION_ERROR', context);
    this.name = 'TransitionError';
  }
}