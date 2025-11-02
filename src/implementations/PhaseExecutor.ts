import { injectable, inject } from 'inversify';
import type { ILogger } from '@chasenocap/logger';
import { Emits } from '@chasenocap/event-system';
import type { IEventBus } from '@chasenocap/event-system';
import { setEventBus } from '@chasenocap/event-system';
import type {
  IPhaseExecutor,
  IPhaseContext,
  ITaskExecutor
} from '../types/StateMachineTypes.js';
import { PhaseExecutionError } from '../types/StateMachineTypes.js';

@injectable()
export class PhaseExecutor implements IPhaseExecutor {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject('IEventBus') eventBus: IEventBus,
    @inject('ITaskExecutor') private taskExecutor: ITaskExecutor
  ) {
    setEventBus(this, eventBus);
  }

  @Emits('phase.executing', {
    payloadMapper: (context: IPhaseContext) => ({
      phaseId: context.phase.id,
      instanceId: context.workflowInstance.id
    })
  })
  async executePhase(context: IPhaseContext): Promise<void> {
    const childLogger = this.logger.child({
      component: 'PhaseExecutor',
      phaseId: context.phase.id,
      instanceId: context.workflowInstance.id
    });

    childLogger.info('Executing phase', {
      taskCount: context.phase.tasks.length
    });

    // Initialize task states
    context.phase.tasks.forEach(task => {
      if (!context.phaseInstance.taskStates.has(task.id)) {
        context.phaseInstance.taskStates.set(task.id, {
          taskId: task.id,
          state: 'pending',
          retryCount: 0
        });
      }
    });

    // Execute tasks in order, respecting dependencies
    const executedTasks = new Set<string>();
    const failedTasks = new Set<string>();

    while (executedTasks.size + failedTasks.size < context.phase.tasks.length) {
      const tasksToExecute = context.phase.tasks.filter(task => {
        // Skip if already executed or failed
        if (executedTasks.has(task.id) || failedTasks.has(task.id)) {
          return false;
        }

        // Check if all dependencies are satisfied
        const dependencies = task.dependencies || [];
        return dependencies.every(depId => executedTasks.has(depId));
      });

      if (tasksToExecute.length === 0) {
        // No tasks can be executed - check for circular dependencies or failed required tasks
        const pendingTasks = context.phase.tasks.filter(
          task => !executedTasks.has(task.id) && !failedTasks.has(task.id)
        );

        if (pendingTasks.length > 0) {
          throw new PhaseExecutionError(
            'Cannot execute remaining tasks due to unsatisfied dependencies',
            context.phase.id,
            {
              pendingTasks: pendingTasks.map(t => t.id),
              failedTasks: Array.from(failedTasks)
            }
          );
        }
        break;
      }

      // Execute tasks in parallel
      const executions = tasksToExecute.map(task => this.executeTask(context, task));
      const results = await Promise.allSettled(executions);

      results.forEach((result, index) => {
        const task = tasksToExecute[index];
        if (!task) return;
        
        if (result.status === 'fulfilled') {
          executedTasks.add(task.id);
        } else {
          if (task.required) {
            failedTasks.add(task.id);
            childLogger.error(
              'Required task failed',
              result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
              { taskId: task.id }
            );
          } else {
            // Non-required task failed, mark as skipped
            const taskInstance = context.phaseInstance.taskStates.get(task.id);
            if (taskInstance) {
              taskInstance.state = 'skipped';
            }
            executedTasks.add(task.id);
            childLogger.warn('Optional task failed, skipping', {
              taskId: task.id,
              error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
          }
        }
      });
    }

    // Check if any required tasks failed
    if (failedTasks.size > 0) {
      throw new PhaseExecutionError(
        'Phase execution failed due to required task failures',
        context.phase.id,
        {
          failedTasks: Array.from(failedTasks)
        }
      );
    }

    // Validate phase completion
    const isComplete = await this.validatePhaseCompletion(context);
    if (!isComplete) {
      throw new PhaseExecutionError(
        'Phase completion validation failed',
        context.phase.id
      );
    }

    childLogger.info('Phase execution completed successfully');
  }

  @Emits('task.started', {
    payloadMapper: (context: IPhaseContext, taskId: string) => ({
      phaseId: context.phase.id,
      taskId,
      instanceId: context.workflowInstance.id
    })
  })
  private async executeTask(context: IPhaseContext, task: any): Promise<void> {
    const childLogger = this.logger.child({
      component: 'PhaseExecutor',
      phaseId: context.phase.id,
      taskId: task.id
    });

    childLogger.info('Executing task', {
      type: task.type,
      required: task.required
    });

    const taskInstance = context.phaseInstance.taskStates.get(task.id);
    if (!taskInstance) {
      throw new Error(`Task instance not found: ${task.id}`);
    }

    taskInstance.state = 'running';
    taskInstance.startedAt = new Date();

    try {
      const result = await this.taskExecutor.executeTask({
        phaseContext: context,
        task,
        taskInstance,
        metadata: context.metadata
      });

      taskInstance.state = 'completed';
      taskInstance.completedAt = new Date();
      taskInstance.result = result;

      childLogger.info('Task completed successfully');
    } catch (error) {
      taskInstance.state = 'failed';
      taskInstance.completedAt = new Date();
      taskInstance.error = error as Error;
      throw error;
    }
  }

  async validatePhaseCompletion(context: IPhaseContext): Promise<boolean> {
    const childLogger = this.logger.child({
      component: 'PhaseExecutor',
      phaseId: context.phase.id
    });

    childLogger.info('Validating phase completion');

    // Check all required tasks are completed
    const requiredTasks = context.phase.tasks.filter(t => t.required);
    for (const task of requiredTasks) {
      const taskInstance = context.phaseInstance.taskStates.get(task.id);
      if (!taskInstance || taskInstance.state !== 'completed') {
        childLogger.warn('Required task not completed', { taskId: task.id });
        return false;
      }
    }

    // Check exit conditions
    if (context.phase.exitConditions.length > 0) {
      childLogger.debug('Checking exit conditions', {
        conditions: context.phase.exitConditions
      });
      // In a real implementation, this would evaluate complex conditions
      // For now, we assume they're met if all required tasks are complete
    }

    // Check deliverables
    if (context.phase.deliverables.length > 0) {
      childLogger.debug('Checking deliverables', {
        deliverables: context.phase.deliverables
      });
      // In a real implementation, this would verify deliverables exist
    }

    childLogger.info('Phase completion validated');
    return true;
  }

  async rollbackPhase(context: IPhaseContext): Promise<void> {
    const childLogger = this.logger.child({
      component: 'PhaseExecutor',
      phaseId: context.phase.id
    });

    childLogger.info('Rolling back phase');

    // Mark phase as rolled back
    context.phaseInstance.state = 'rolled_back';

    // In a real implementation, this would:
    // 1. Undo any changes made by the phase
    // 2. Clean up any resources
    // 3. Restore previous state

    // Reset task states
    context.phaseInstance.taskStates.forEach(taskInstance => {
      if (taskInstance.state === 'completed') {
        taskInstance.state = 'pending';
        taskInstance.result = undefined;
        taskInstance.error = undefined;
      }
    });

    childLogger.info('Phase rollback completed');
  }
}