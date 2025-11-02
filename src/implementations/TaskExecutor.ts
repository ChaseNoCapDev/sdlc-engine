import { injectable, inject } from 'inversify';
import type { ILogger } from '@chasenocap/logger';
import { Emits } from '@chasenocap/event-system';
import type { IEventBus } from '@chasenocap/event-system';
import { setEventBus } from '@chasenocap/event-system';
import type {
  ITaskExecutor,
  ITaskContext
} from '../types/StateMachineTypes.js';

@injectable()
export class TaskExecutor implements ITaskExecutor {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject('IEventBus') eventBus: IEventBus
  ) {
    setEventBus(this, eventBus);
  }

  @Emits('task.executing', {
    payloadMapper: (context: ITaskContext) => ({
      taskId: context.task.id,
      taskType: context.task.type,
      phaseId: context.phaseContext.phase.id
    })
  })
  async executeTask(context: ITaskContext): Promise<unknown> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id,
      taskType: context.task.type
    });

    childLogger.info('Executing task', {
      estimatedDuration: context.task.estimatedDuration,
      tools: context.task.tools
    });

    // Simulate different task types
    switch (context.task.type) {
      case 'automated':
        return await this.executeAutomatedTask(context);
      
      case 'manual':
        return await this.executeManualTask(context);
      
      case 'review':
        return await this.executeReviewTask(context);
      
      case 'approval':
        return await this.executeApprovalTask(context);
      
      default:
        childLogger.warn('Unknown task type, treating as manual');
        return await this.executeManualTask(context);
    }
  }

  private async executeAutomatedTask(context: ITaskContext): Promise<unknown> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id,
      taskType: 'automated'
    });

    childLogger.info('Executing automated task');

    // In a real implementation, this would:
    // 1. Execute automated scripts or tools
    // 2. Call external APIs
    // 3. Run build/test/deploy commands
    
    // Simulate task execution
    await this.simulateTaskDuration(context.task.estimatedDuration);

    // Return simulated results
    const result = {
      status: 'success',
      outputs: context.task.outputs || [],
      executedAt: new Date(),
      metadata: {
        tools: context.task.tools || [],
        automated: true
      }
    };

    childLogger.info('Automated task completed', { result });
    return result;
  }

  private async executeManualTask(context: ITaskContext): Promise<unknown> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id,
      taskType: 'manual'
    });

    childLogger.info('Executing manual task', {
      assignee: context.task.assignee
    });

    // In a real implementation, this would:
    // 1. Create work item for assignee
    // 2. Send notifications
    // 3. Wait for completion confirmation
    // 4. Collect outputs/artifacts
    
    // Check if task is pre-completed via metadata
    const completedTasks = context.metadata?.completedTasks as string[] | undefined;
    if (completedTasks?.includes(context.task.id)) {
      childLogger.info('Task pre-completed via metadata');
      return {
        status: 'success',
        completedBy: context.task.assignee || 'system',
        completedAt: new Date(),
        outputs: context.task.outputs || []
      };
    }

    // Simulate manual task
    await this.simulateTaskDuration(context.task.estimatedDuration);

    return {
      status: 'success',
      completedBy: context.task.assignee || 'unknown',
      completedAt: new Date(),
      outputs: context.task.outputs || [],
      notes: 'Simulated manual completion'
    };
  }

  private async executeReviewTask(context: ITaskContext): Promise<unknown> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id,
      taskType: 'review'
    });

    childLogger.info('Executing review task');

    // In a real implementation, this would:
    // 1. Gather items to review
    // 2. Assign to reviewers
    // 3. Collect feedback
    // 4. Determine review outcome
    
    // Check for pre-approved reviews
    const approvedReviews = context.metadata?.approvedReviews as string[] | undefined;
    if (approvedReviews?.includes(context.task.id)) {
      return {
        status: 'approved',
        reviewedBy: context.task.assignee || 'system',
        reviewedAt: new Date(),
        feedback: 'Pre-approved via metadata'
      };
    }

    await this.simulateTaskDuration(context.task.estimatedDuration);

    return {
      status: 'approved',
      reviewedBy: context.task.assignee || 'reviewer',
      reviewedAt: new Date(),
      feedback: 'Review passed',
      findings: []
    };
  }

  private async executeApprovalTask(context: ITaskContext): Promise<unknown> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id,
      taskType: 'approval'
    });

    childLogger.info('Executing approval task');

    // Check for pre-approval
    const approvedTasks = context.metadata?.approvedTasks as string[] | undefined;
    if (context.metadata?.autoApprove === true || 
        approvedTasks?.includes(context.task.id)) {
      childLogger.info('Task auto-approved');
      return {
        status: 'approved',
        approvedBy: 'system',
        approvedAt: new Date(),
        autoApproved: true
      };
    }

    // In a real implementation, this would request approval
    await this.simulateTaskDuration('1 second');

    // Simulate approval based on metadata
    const approvalDecisions = context.metadata?.approvalDecisions as Record<string, boolean> | undefined;
    const approved = approvalDecisions?.[context.task.id] !== false;

    return {
      status: approved ? 'approved' : 'rejected',
      approvedBy: context.task.assignee || 'approver',
      approvedAt: new Date(),
      reason: approved ? 'Criteria met' : 'Requirements not satisfied'
    };
  }

  async validateTaskResult(context: ITaskContext): Promise<boolean> {
    const childLogger = this.logger.child({
      component: 'TaskExecutor',
      taskId: context.task.id
    });

    childLogger.info('Validating task result');

    if (!context.taskInstance.result) {
      childLogger.warn('No task result to validate');
      return false;
    }

    // Basic validation based on task type
    const result = context.taskInstance.result as any;
    
    switch (context.task.type) {
      case 'automated':
        return result.status === 'success';
      
      case 'manual':
        return result.status === 'success' && result.completedBy;
      
      case 'review':
        return result.status === 'approved' || result.status === 'passed';
      
      case 'approval':
        return result.status === 'approved';
      
      default:
        return result.status === 'success' || result.status === 'completed';
    }
  }

  private async simulateTaskDuration(duration?: string): Promise<void> {
    if (!duration) {
      return;
    }

    // Parse duration string (e.g., "2 days", "4 hours", "30 seconds")
    const match = duration.match(/(\d+)\s*(day|hour|minute|second)/i);
    if (!match) {
      return;
    }

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    // Convert to milliseconds (but cap at 5 seconds for simulation)
    let ms = 0;
    switch (unit) {
      case 'day':
      case 'days':
        ms = Math.min(value * 100, 5000); // 100ms per day, max 5s
        break;
      case 'hour':
      case 'hours':
        ms = Math.min(value * 50, 3000); // 50ms per hour, max 3s
        break;
      case 'minute':
      case 'minutes':
        ms = Math.min(value * 10, 1000); // 10ms per minute, max 1s
        break;
      case 'second':
      case 'seconds':
        ms = Math.min(value * 100, 500); // 100ms per second, max 0.5s
        break;
    }

    if (ms > 0) {
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  }
}