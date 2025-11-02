import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../../src/implementations/StateMachine.js';
import type { 
  IWorkflowInstance, 
  IStateMachineConfig,
  IPhaseManager,
  ITransitionValidator,
  IPhaseExecutor,
  IWorkflowPersistence
} from '../../src/types/StateMachineTypes.js';
import type { ILogger } from '@chasenocap/logger';
import type { IEventBus } from '@chasenocap/event-system';
import type { ISDLCWorkflow, ISDLCPhase, ISDLCTransition } from '@chasenocap/sdlc-config';

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

const createMockWorkflow = (): ISDLCWorkflow => ({
  id: 'test-workflow',
  name: 'Test Workflow',
  version: '1.0.0',
  initialPhase: 'phase1',
  phases: [
    {
      id: 'phase1',
      name: 'Phase 1',
      objectives: ['Objective 1'],
      deliverables: ['Deliverable 1'],
      entryConditions: [],
      exitConditions: [],
      tasks: [],
      nextPhases: ['phase2']
    },
    {
      id: 'phase2',
      name: 'Phase 2',
      objectives: ['Objective 2'],
      deliverables: ['Deliverable 2'],
      entryConditions: [],
      exitConditions: [],
      tasks: [],
      nextPhases: []
    }
  ],
  transitions: [{
    from: 'phase1',
    to: 'phase2',
    conditions: []
  }]
});

describe('StateMachine', () => {
  let stateMachine: StateMachine;
  let mockLogger: ILogger;
  let mockEventBus: IEventBus;
  let mockPhaseManager: IPhaseManager;
  let mockTransitionValidator: ITransitionValidator;
  let mockPhaseExecutor: IPhaseExecutor;
  let mockPersistence: IWorkflowPersistence;
  let config: IStateMachineConfig;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    
    const mockWorkflow = createMockWorkflow();
    
    mockPhaseManager = {
      getWorkflow: vi.fn().mockReturnValue(mockWorkflow),
      getPhase: vi.fn().mockImplementation((_, phaseId) => 
        mockWorkflow.phases.find(p => p.id === phaseId)
      ),
      getAvailableTransitions: vi.fn().mockReturnValue(mockWorkflow.transitions),
      setConfig: vi.fn()
    } as any;

    mockTransitionValidator = {
      canTransition: vi.fn().mockResolvedValue(true),
      validateTransitionConditions: vi.fn().mockResolvedValue([]),
      requestApproval: vi.fn().mockResolvedValue(true)
    };

    mockPhaseExecutor = {
      executePhase: vi.fn().mockResolvedValue(undefined),
      validatePhaseCompletion: vi.fn().mockResolvedValue(true),
      rollbackPhase: vi.fn().mockResolvedValue(undefined)
    };

    mockPersistence = {
      saveWorkflowInstance: vi.fn().mockResolvedValue(undefined),
      loadWorkflowInstance: vi.fn().mockResolvedValue(null),
      updateWorkflowInstance: vi.fn().mockResolvedValue(undefined),
      listWorkflowInstances: vi.fn().mockResolvedValue([])
    };

    config = {
      enablePersistence: true,
      enableRetries: true,
      maxRetries: 3,
      retryDelay: 10
    };

    stateMachine = new StateMachine(
      mockLogger,
      mockEventBus,
      mockPhaseManager,
      mockTransitionValidator,
      mockPhaseExecutor,
      mockPersistence,
      config
    );
  });

  describe('startWorkflow', () => {
    it('should start a workflow successfully', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow', { foo: 'bar' });

      expect(instance.workflowId).toBe('test-workflow');
      expect(instance.state).toBe('running');
      expect(instance.currentPhaseId).toBe('phase1');
      expect(instance.metadata).toEqual({ foo: 'bar' });
      expect(instance.phaseStates.size).toBe(2);
      expect(mockPersistence.saveWorkflowInstance).toHaveBeenCalledWith(instance);
    });

    it('should throw error if workflow not found', async () => {
      mockPhaseManager.getWorkflow = vi.fn().mockReturnValue(undefined);

      await expect(stateMachine.startWorkflow('unknown')).rejects.toThrow('Workflow not found');
    });

    it('should execute initial phase', async () => {
      await stateMachine.startWorkflow('test-workflow');

      expect(mockPhaseExecutor.executePhase).toHaveBeenCalled();
    });
  });

  describe('pauseWorkflow', () => {
    it('should pause a running workflow', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await stateMachine.pauseWorkflow(instance.id);
      
      const updated = stateMachine.getWorkflowInstance(instance.id);
      expect(updated?.state).toBe('paused');
    });

    it('should throw error for non-existent instance', async () => {
      await expect(stateMachine.pauseWorkflow('unknown')).rejects.toThrow('Workflow instance not found');
    });

    it('should throw error if not in running state', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      await stateMachine.pauseWorkflow(instance.id);

      await expect(stateMachine.pauseWorkflow(instance.id)).rejects.toThrow('Cannot pause workflow in current state');
    });
  });

  describe('resumeWorkflow', () => {
    it('should resume a paused workflow', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      await stateMachine.pauseWorkflow(instance.id);
      
      await stateMachine.resumeWorkflow(instance.id);
      
      const updated = stateMachine.getWorkflowInstance(instance.id);
      expect(updated?.state).toBe('running');
    });

    it('should continue with current phase on resume', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      await stateMachine.pauseWorkflow(instance.id);
      
      // Reset mock to check it's called again
      mockPhaseExecutor.executePhase = vi.fn().mockResolvedValue(undefined);
      
      await stateMachine.resumeWorkflow(instance.id);
      
      expect(mockPhaseExecutor.executePhase).toHaveBeenCalled();
    });
  });

  describe('cancelWorkflow', () => {
    it('should cancel a workflow with reason', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await stateMachine.cancelWorkflow(instance.id, 'User cancelled');
      
      const updated = stateMachine.getWorkflowInstance(instance.id);
      expect(updated?.state).toBe('failed');
      expect(updated?.error?.message).toBe('User cancelled');
      expect(updated?.completedAt).toBeDefined();
    });
  });

  describe('transitionToPhase', () => {
    it('should transition to next phase', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await stateMachine.transitionToPhase(instance.id, 'phase2');
      
      const updated = stateMachine.getWorkflowInstance(instance.id);
      expect(updated?.currentPhaseId).toBe('phase2');
    });

    it('should validate transition', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await stateMachine.transitionToPhase(instance.id, 'phase2');
      
      expect(mockTransitionValidator.canTransition).toHaveBeenCalled();
    });

    it('should throw error if transition not allowed', async () => {
      mockTransitionValidator.canTransition = vi.fn().mockResolvedValue(false);
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await expect(stateMachine.transitionToPhase(instance.id, 'phase2'))
        .rejects.toThrow('Transition validation failed');
    });

    it('should throw error if no valid transition found', async () => {
      mockPhaseManager.getAvailableTransitions = vi.fn().mockReturnValue([]);
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      await expect(stateMachine.transitionToPhase(instance.id, 'phase2'))
        .rejects.toThrow('No valid transition found');
    });
  });

  describe('getWorkflowInstance', () => {
    it('should return workflow instance', async () => {
      const instance = await stateMachine.startWorkflow('test-workflow');
      
      const retrieved = stateMachine.getWorkflowInstance(instance.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(instance.id);
    });

    it('should return undefined for non-existent instance', () => {
      const retrieved = stateMachine.getWorkflowInstance('unknown');
      
      expect(retrieved).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle phase execution errors with retry', async () => {
      let callCount = 0;
      mockPhaseExecutor.executePhase = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve();
      });

      const instance = await stateMachine.startWorkflow('test-workflow');
      
      // Should succeed after retries
      expect(callCount).toBe(3);
      expect(instance.state).toBe('running');
    });

    it('should fail workflow after max retries', async () => {
      mockPhaseExecutor.executePhase = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      const instance = await stateMachine.startWorkflow('test-workflow');
      
      // Wait for retries to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const updated = stateMachine.getWorkflowInstance(instance.id);
      expect(updated?.state).toBe('failed');
      expect(updated?.error?.message).toBe('Persistent failure');
    });
  });
});