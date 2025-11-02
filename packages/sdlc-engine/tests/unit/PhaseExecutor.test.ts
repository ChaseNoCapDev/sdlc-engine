import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PhaseExecutor } from '../../src/implementations/PhaseExecutor.js';
import type { 
  IPhaseContext,
  ITaskExecutor,
  IWorkflowInstance,
  IPhaseInstance
} from '../../src/types/StateMachineTypes.js';
import type { ILogger } from '@chasenocap/logger';
import type { IEventBus } from '@chasenocap/event-system';
import type { ISDLCPhase } from '@chasenocap/sdlc-config';

// Mock implementations
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => createMockLogger())
} as any);

const createMockEventBus = (): IEventBus => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
} as any);

const createMockPhase = (): ISDLCPhase => ({
  id: 'test-phase',
  name: 'Test Phase',
  objectives: ['Test objective'],
  deliverables: ['Test deliverable'],
  entryConditions: [],
  exitConditions: ['All tasks complete'],
  tasks: [
    {
      id: 'task1',
      name: 'Task 1',
      type: 'manual',
      required: true
    },
    {
      id: 'task2',
      name: 'Task 2',
      type: 'automated',
      required: false,
      dependencies: ['task1']
    },
    {
      id: 'task3',
      name: 'Task 3',
      type: 'review',
      required: true,
      dependencies: ['task2']
    }
  ],
  nextPhases: ['next-phase']
});

describe('PhaseExecutor', () => {
  let phaseExecutor: PhaseExecutor;
  let mockLogger: ILogger;
  let mockEventBus: IEventBus;
  let mockTaskExecutor: ITaskExecutor;
  let mockContext: IPhaseContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    
    mockTaskExecutor = {
      executeTask: vi.fn().mockResolvedValue({ status: 'success' }),
      validateTaskResult: vi.fn().mockResolvedValue(true)
    };

    const phase = createMockPhase();
    const phaseInstance: IPhaseInstance = {
      phaseId: 'test-phase',
      state: 'active',
      taskStates: new Map(),
      retryCount: 0
    };

    const workflowInstance: IWorkflowInstance = {
      id: 'test-instance',
      workflowId: 'test-workflow',
      name: 'Test Workflow',
      state: 'running',
      currentPhaseId: 'test-phase',
      phaseStates: new Map([['test-phase', phaseInstance]]),
      startedAt: new Date()
    };

    mockContext = {
      workflowInstance,
      phase,
      phaseInstance
    };

    phaseExecutor = new PhaseExecutor(mockLogger, mockEventBus, mockTaskExecutor);
  });

  describe('executePhase', () => {
    it('should execute all tasks successfully', async () => {
      await phaseExecutor.executePhase(mockContext);

      // Should execute all 3 tasks
      expect(mockTaskExecutor.executeTask).toHaveBeenCalledTimes(3);
      
      // Should initialize task states
      expect(mockContext.phaseInstance.taskStates.size).toBe(3);
    });

    it('should respect task dependencies', async () => {
      const executionOrder: string[] = [];
      mockTaskExecutor.executeTask = vi.fn().mockImplementation((context) => {
        executionOrder.push(context.task.id);
        return Promise.resolve({ status: 'success' });
      });

      await phaseExecutor.executePhase(mockContext);

      // task1 should execute first (no dependencies)
      expect(executionOrder[0]).toBe('task1');
      // task2 depends on task1
      expect(executionOrder[1]).toBe('task2');
      // task3 depends on task2
      expect(executionOrder[2]).toBe('task3');
    });

    it('should handle optional task failures', async () => {
      mockTaskExecutor.executeTask = vi.fn().mockImplementation((context) => {
        if (context.task.id === 'task2') {
          return Promise.reject(new Error('Optional task failed'));
        }
        return Promise.resolve({ status: 'success' });
      });

      await phaseExecutor.executePhase(mockContext);

      // Should not throw, task2 is optional
      const task2State = mockContext.phaseInstance.taskStates.get('task2');
      expect(task2State?.state).toBe('skipped');
    });

    it('should fail on required task failure', async () => {
      mockTaskExecutor.executeTask = vi.fn().mockImplementation((context) => {
        if (context.task.id === 'task1') {
          return Promise.reject(new Error('Required task failed'));
        }
        return Promise.resolve({ status: 'success' });
      });

      await expect(phaseExecutor.executePhase(mockContext))
        .rejects.toThrow('Phase execution failed due to required task failures');
    });

    it('should detect circular dependencies', async () => {
      // Create phase with circular dependency
      mockContext.phase.tasks = [
        {
          id: 'task1',
          name: 'Task 1',
          type: 'manual',
          required: true,
          dependencies: ['task2']
        },
        {
          id: 'task2',
          name: 'Task 2',
          type: 'manual',
          required: true,
          dependencies: ['task1']
        }
      ];

      await expect(phaseExecutor.executePhase(mockContext))
        .rejects.toThrow('Cannot execute remaining tasks due to unsatisfied dependencies');
    });
  });

  describe('validatePhaseCompletion', () => {
    it('should validate successful phase completion', async () => {
      // Set all tasks as completed
      mockContext.phase.tasks.forEach(task => {
        mockContext.phaseInstance.taskStates.set(task.id, {
          taskId: task.id,
          state: 'completed',
          retryCount: 0
        });
      });

      const isValid = await phaseExecutor.validatePhaseCompletion(mockContext);
      
      expect(isValid).toBe(true);
    });

    it('should fail validation if required task not completed', async () => {
      // Set task1 as failed (required)
      mockContext.phaseInstance.taskStates.set('task1', {
        taskId: 'task1',
        state: 'failed',
        retryCount: 0
      });

      const isValid = await phaseExecutor.validatePhaseCompletion(mockContext);
      
      expect(isValid).toBe(false);
    });

    it('should pass validation if optional task not completed', async () => {
      // Complete required tasks
      mockContext.phaseInstance.taskStates.set('task1', {
        taskId: 'task1',
        state: 'completed',
        retryCount: 0
      });
      mockContext.phaseInstance.taskStates.set('task3', {
        taskId: 'task3',
        state: 'completed',
        retryCount: 0
      });
      // task2 is optional and not completed
      mockContext.phaseInstance.taskStates.set('task2', {
        taskId: 'task2',
        state: 'skipped',
        retryCount: 0
      });

      const isValid = await phaseExecutor.validatePhaseCompletion(mockContext);
      
      expect(isValid).toBe(true);
    });
  });

  describe('rollbackPhase', () => {
    it('should rollback phase state', async () => {
      // Set some tasks as completed
      mockContext.phaseInstance.taskStates.set('task1', {
        taskId: 'task1',
        state: 'completed',
        retryCount: 0,
        result: { data: 'test' }
      });

      await phaseExecutor.rollbackPhase(mockContext);

      expect(mockContext.phaseInstance.state).toBe('rolled_back');
      
      const task1State = mockContext.phaseInstance.taskStates.get('task1');
      expect(task1State?.state).toBe('pending');
      expect(task1State?.result).toBeUndefined();
    });
  });
});