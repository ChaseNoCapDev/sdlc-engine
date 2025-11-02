import { injectable, inject } from 'inversify';
import type { ILogger } from '@chasenocap/logger';
import { Emits } from '@chasenocap/event-system';
import type { IEventBus } from '@chasenocap/event-system';
import { setEventBus } from '@chasenocap/event-system';
import type {
  ITransitionValidator,
  ITransitionContext
} from '../types/StateMachineTypes.js';

@injectable()
export class TransitionValidator implements ITransitionValidator {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject('IEventBus') eventBus: IEventBus
  ) {
    setEventBus(this, eventBus);
  }

  async canTransition(context: ITransitionContext): Promise<boolean> {
    const childLogger = this.logger.child({
      component: 'TransitionValidator',
      from: context.fromPhase.id,
      to: context.toPhase.id
    });

    childLogger.info('Validating transition');

    // Check if current phase is completed
    const currentPhaseInstance = context.workflowInstance.phaseStates.get(context.fromPhase.id);
    if (!currentPhaseInstance) {
      childLogger.warn('Current phase instance not found');
      return false;
    }

    // Allow transition from active or completed phases
    if (currentPhaseInstance.state !== 'active' && currentPhaseInstance.state !== 'completed') {
      childLogger.warn('Current phase not in valid state for transition', {
        currentState: currentPhaseInstance.state
      });
      return false;
    }

    // Validate transition conditions
    const failedConditions = await this.validateTransitionConditions(context);
    if (failedConditions.length > 0) {
      childLogger.warn('Transition conditions not met', { failedConditions });
      return false;
    }

    // Check if approval is required
    if (context.transition.requiresApproval) {
      const approved = await this.requestApproval(context);
      if (!approved) {
        childLogger.warn('Transition approval denied');
        return false;
      }
    }

    childLogger.info('Transition validated successfully');
    return true;
  }

  async validateTransitionConditions(context: ITransitionContext): Promise<string[]> {
    const childLogger = this.logger.child({
      component: 'TransitionValidator',
      transition: `${context.fromPhase.id} -> ${context.toPhase.id}`
    });

    const failedConditions: string[] = [];
    const conditions = context.transition.conditions || [];

    for (const condition of conditions) {
      // In a real implementation, this would evaluate complex conditions
      // For now, we'll do simple checks based on phase completion
      childLogger.debug('Evaluating condition', { condition });

      // Check if condition references task completion
      if (condition.includes('completed')) {
        const phaseInstance = context.workflowInstance.phaseStates.get(context.fromPhase.id);
        if (!phaseInstance || phaseInstance.state !== 'completed') {
          failedConditions.push(condition);
        }
      }

      // Check if condition references specific metadata
      if (condition.includes('approved') && context.metadata) {
        if (!context.metadata.approved) {
          failedConditions.push(condition);
        }
      }

      // Add more condition evaluations as needed
    }

    return failedConditions;
  }

  @Emits('transition.approval_requested', {
    payloadMapper: (context: ITransitionContext) => ({
      from: context.fromPhase.id,
      to: context.toPhase.id,
      approvers: context.transition.approvers
    })
  })
  async requestApproval(context: ITransitionContext): Promise<boolean> {
    const childLogger = this.logger.child({
      component: 'TransitionValidator',
      transition: `${context.fromPhase.id} -> ${context.toPhase.id}`
    });

    childLogger.info('Requesting transition approval', {
      approvers: context.transition.approvers
    });

    // In a real implementation, this would:
    // 1. Send approval requests to approvers
    // 2. Wait for responses
    // 3. Apply approval rules (unanimous, majority, etc.)
    
    // For now, check if approval is provided in metadata
    if (context.metadata?.approved === true) {
      childLogger.info('Transition approved via metadata');
      return true;
    }

    // Simulate approval process
    if (context.metadata?.autoApprove === true) {
      childLogger.info('Auto-approving transition');
      return true;
    }

    childLogger.warn('No approval mechanism available, denying by default');
    return false;
  }
}