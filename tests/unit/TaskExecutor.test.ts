import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskExecutor } from '../../src/implementations/TaskExecutor.js';
import type { ITaskContext } from '../../src/types/StateMachineTypes.js';
import type { ILogger } from '@chasenocap/logger';
import type { IEventBus } from '@chasenocap/event-system';

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

describe('TaskExecutor', () => {
  let taskExecutor: TaskExecutor;
  let mockLogger: ILogger;
  let mockEventBus: IEventBus;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    taskExecutor = new TaskExecutor(mockLogger, mockEventBus);
  });

  describe('executeTask', () => {
    it('should execute automated task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'auto-task',
          type: 'automated',
          estimatedDuration: '1 second',
          tools: ['tool1', 'tool2'],
          outputs: ['output1']
        },
        taskInstance: {
          taskId: 'auto-task',
          state: 'running',
          retryCount: 0
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'success',
        outputs: ['output1'],
        metadata: {
          tools: ['tool1', 'tool2'],
          automated: true
        }
      });
    });

    it('should execute manual task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'manual-task',
          type: 'manual',
          assignee: 'user123',
          outputs: ['doc1']
        },
        taskInstance: {
          taskId: 'manual-task',
          state: 'running',
          retryCount: 0
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'success',
        completedBy: 'user123',
        outputs: ['doc1']
      });
    });

    it('should handle pre-completed manual task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'manual-task',
          type: 'manual'
        },
        taskInstance: {
          taskId: 'manual-task',
          state: 'running',
          retryCount: 0
        },
        metadata: {
          completedTasks: ['manual-task']
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'success',
        completedBy: 'system'
      });
    });

    it('should execute review task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'review-task',
          type: 'review',
          assignee: 'reviewer1'
        },
        taskInstance: {
          taskId: 'review-task',
          state: 'running',
          retryCount: 0
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'approved',
        reviewedBy: 'reviewer1',
        feedback: 'Review passed'
      });
    });

    it('should handle pre-approved review', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'review-task',
          type: 'review'
        },
        taskInstance: {
          taskId: 'review-task',
          state: 'running',
          retryCount: 0
        },
        metadata: {
          approvedReviews: ['review-task']
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'approved',
        reviewedBy: 'system',
        feedback: 'Pre-approved via metadata'
      });
    });

    it('should execute approval task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'approval-task',
          type: 'approval',
          assignee: 'approver1'
        },
        taskInstance: {
          taskId: 'approval-task',
          state: 'running',
          retryCount: 0
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'approved',
        approvedBy: 'approver1'
      });
    });

    it('should handle auto-approval', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'approval-task',
          type: 'approval'
        },
        taskInstance: {
          taskId: 'approval-task',
          state: 'running',
          retryCount: 0
        },
        metadata: {
          autoApprove: true
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'approved',
        approvedBy: 'system',
        autoApproved: true
      });
    });

    it('should handle approval rejection', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'approval-task',
          type: 'approval'
        },
        taskInstance: {
          taskId: 'approval-task',
          state: 'running',
          retryCount: 0
        },
        metadata: {
          approvalDecisions: {
            'approval-task': false
          }
        }
      };

      const result = await taskExecutor.executeTask(context);

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'Requirements not satisfied'
      });
    });

    it('should handle unknown task type', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'unknown-task',
          type: 'unknown'
        },
        taskInstance: {
          taskId: 'unknown-task',
          state: 'running',
          retryCount: 0
        }
      };

      const result = await taskExecutor.executeTask(context);

      // Should treat as manual task
      expect(result).toMatchObject({
        status: 'success',
        notes: 'Simulated manual completion'
      });
    });
  });

  describe('validateTaskResult', () => {
    it('should validate automated task result', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'automated'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'success' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(true);
    });

    it('should validate manual task result', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'manual'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'success', completedBy: 'user1' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(true);
    });

    it('should fail validation for missing completedBy in manual task', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'manual'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'success' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(false);
    });

    it('should validate review task result', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'review'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'approved' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(true);
    });

    it('should validate approval task result', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'approval'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'approved' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(true);
    });

    it('should fail validation for rejected approval', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'approval'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0,
          result: { status: 'rejected' }
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(false);
    });

    it('should return false for missing result', async () => {
      const context: ITaskContext = {
        phaseContext: {} as any,
        task: {
          id: 'task1',
          type: 'automated'
        },
        taskInstance: {
          taskId: 'task1',
          state: 'completed',
          retryCount: 0
        }
      };

      const isValid = await taskExecutor.validateTaskResult(context);
      expect(isValid).toBe(false);
    });
  });
});