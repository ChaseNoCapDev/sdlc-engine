import { injectable, inject } from 'inversify';
import type { ILogger } from '@chasenocap/logger';
import type { IEventBus } from '@chasenocap/event-system';
import { setEventBus, Emits } from '@chasenocap/event-system';
import type { IPhaseManager } from '@chasenocap/sdlc-config';
import { randomUUID } from 'crypto';
import type {
  IStateMachine,
  IWorkflowInstance,
  IPhaseInstance,
  ITransitionContext,
  IStateMachineConfig,
  ITransitionValidator,
  IPhaseExecutor,
  IWorkflowPersistence
} from '../types/StateMachineTypes.js';
import { StateMachineError, TransitionError } from '../types/StateMachineTypes.js';

@injectable()
export class StateMachine implements IStateMachine {
  private readonly instances: Map<string, IWorkflowInstance> = new Map();

  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject('IEventBus') eventBus: IEventBus,
    @inject('IPhaseManager') private phaseManager: IPhaseManager,
    @inject('ITransitionValidator') private transitionValidator: ITransitionValidator,
    @inject('IPhaseExecutor') private phaseExecutor: IPhaseExecutor,
    @inject('IWorkflowPersistence') private persistence: IWorkflowPersistence | null,
    @inject('IStateMachineConfig') private config: IStateMachineConfig
  ) {
    setEventBus(this, eventBus);
  }

  @Emits('workflow.started', {
    payloadMapper: (instanceId: string, workflowId: string) => ({ instanceId, workflowId })
  })
  async startWorkflow(workflowId: string, initialData?: Record<string, unknown>): Promise<IWorkflowInstance> {
    const childLogger = this.logger.child({ component: 'StateMachine', workflowId });
    childLogger.info('Starting workflow');

    const workflow = (this.phaseManager as any).getWorkflow(workflowId);
    if (!workflow) {
      throw new StateMachineError('Workflow not found', 'WORKFLOW_NOT_FOUND', { workflowId });
    }

    const instanceId = randomUUID();
    const phaseStates = new Map<string, IPhaseInstance>();

    // Initialize phase states
    workflow.phases.forEach((phase: any) => {
      phaseStates.set(phase.id, {
        phaseId: phase.id,
        state: 'pending',
        taskStates: new Map(),
        retryCount: 0
      });
    });

    const instance: IWorkflowInstance = {
      id: instanceId,
      workflowId,
      name: workflow.name,
      state: 'running',
      currentPhaseId: workflow.initialPhase,
      phaseStates,
      startedAt: new Date(),
      metadata: initialData
    };

    this.instances.set(instanceId, instance);

    // Persist if enabled
    if (this.config.enablePersistence && this.persistence) {
      await this.persistence.saveWorkflowInstance(instance);
    }

    // Start initial phase
    await this.executePhase(instanceId, workflow.initialPhase);

    return instance;
  }

  async pauseWorkflow(instanceId: string): Promise<void> {
    const childLogger = this.logger.child({ component: 'StateMachine', instanceId });
    childLogger.info('Pausing workflow');

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      throw new StateMachineError('Workflow instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    }

    if (instance.state !== 'running') {
      throw new StateMachineError('Cannot pause workflow in current state', 'INVALID_STATE', {
        instanceId,
        currentState: instance.state
      });
    }

    instance.state = 'paused';
    await this.updateInstance(instance);
  }

  async resumeWorkflow(instanceId: string): Promise<void> {
    const childLogger = this.logger.child({ component: 'StateMachine', instanceId });
    childLogger.info('Resuming workflow');

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      throw new StateMachineError('Workflow instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    }

    if (instance.state !== 'paused') {
      throw new StateMachineError('Cannot resume workflow in current state', 'INVALID_STATE', {
        instanceId,
        currentState: instance.state
      });
    }

    instance.state = 'running';
    await this.updateInstance(instance);

    // Continue with current phase
    if (instance.currentPhaseId) {
      await this.executePhase(instanceId, instance.currentPhaseId);
    }
  }

  async cancelWorkflow(instanceId: string, reason?: string): Promise<void> {
    const childLogger = this.logger.child({ component: 'StateMachine', instanceId });
    childLogger.info('Cancelling workflow', { reason });

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      throw new StateMachineError('Workflow instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    }

    instance.state = 'failed';
    instance.completedAt = new Date();
    instance.error = new Error(reason || 'Workflow cancelled');
    
    await this.updateInstance(instance);
  }

  getWorkflowInstance(instanceId: string): IWorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  @Emits('transition.requested', {
    payloadMapper: (instanceId: string, targetPhaseId: string) => ({ instanceId, targetPhaseId })
  })
  async transitionToPhase(
    instanceId: string,
    targetPhaseId: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    const childLogger = this.logger.child({ 
      component: 'StateMachine', 
      instanceId, 
      targetPhaseId 
    });
    childLogger.info('Transitioning to phase');

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      throw new StateMachineError('Workflow instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    }

    if (!instance.currentPhaseId) {
      throw new StateMachineError('No current phase', 'NO_CURRENT_PHASE', { instanceId });
    }

    const workflow = (this.phaseManager as any).getWorkflow(instance.workflowId);
    if (!workflow) {
      throw new StateMachineError('Workflow not found', 'WORKFLOW_NOT_FOUND', {
        workflowId: instance.workflowId
      });
    }

    const fromPhase = this.phaseManager.getPhase(instance.workflowId, instance.currentPhaseId);
    const toPhase = this.phaseManager.getPhase(instance.workflowId, targetPhaseId);

    if (!fromPhase || !toPhase) {
      throw new TransitionError(
        'Invalid phase reference',
        instance.currentPhaseId,
        targetPhaseId
      );
    }

    // Find transition
    const transitions = this.phaseManager.getAvailableTransitions(
      instance.workflowId,
      instance.currentPhaseId
    );
    
    const transition = transitions.find(t => t.to === targetPhaseId);
    if (!transition) {
      throw new TransitionError(
        'No valid transition found',
        instance.currentPhaseId,
        targetPhaseId
      );
    }

    // Validate transition
    const transitionContext: ITransitionContext = {
      workflowInstance: instance,
      fromPhase,
      toPhase,
      transition,
      metadata: context
    };

    const canTransition = await this.transitionValidator.canTransition(transitionContext);
    if (!canTransition) {
      throw new TransitionError(
        'Transition validation failed',
        instance.currentPhaseId,
        targetPhaseId,
        { context }
      );
    }

    // Update current phase
    const currentPhaseInstance = instance.phaseStates.get(instance.currentPhaseId);
    if (currentPhaseInstance) {
      currentPhaseInstance.state = 'completed';
      currentPhaseInstance.completedAt = new Date();
    }

    instance.currentPhaseId = targetPhaseId;
    await this.updateInstance(instance);

    // Execute new phase
    await this.executePhase(instanceId, targetPhaseId);
  }

  @Emits('phase.started', {
    payloadMapper: (instanceId: string, phaseId: string) => ({ instanceId, phaseId })
  })
  private async executePhase(instanceId: string, phaseId: string): Promise<void> {
    const childLogger = this.logger.child({ 
      component: 'StateMachine', 
      instanceId, 
      phaseId 
    });
    childLogger.info('Executing phase');

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      throw new StateMachineError('Workflow instance not found', 'INSTANCE_NOT_FOUND', { instanceId });
    }

    const phase = this.phaseManager.getPhase(instance.workflowId, phaseId);
    if (!phase) {
      throw new StateMachineError('Phase not found', 'PHASE_NOT_FOUND', {
        workflowId: instance.workflowId,
        phaseId
      });
    }

    const phaseInstance = instance.phaseStates.get(phaseId);
    if (!phaseInstance) {
      throw new StateMachineError('Phase instance not found', 'PHASE_INSTANCE_NOT_FOUND', {
        instanceId,
        phaseId
      });
    }

    phaseInstance.state = 'active';
    phaseInstance.startedAt = new Date();
    await this.updateInstance(instance);

    try {
      // Execute phase
      await this.phaseExecutor.executePhase({
        workflowInstance: instance,
        phase,
        phaseInstance,
        metadata: instance.metadata
      });

      phaseInstance.state = 'completed';
      phaseInstance.completedAt = new Date();
      await this.updateInstance(instance);

      // Check for next phases
      if (phase.nextPhases.length > 0) {
        // For simplicity, auto-transition to first next phase
        // In a real implementation, this might require user input or conditions
        const nextPhaseId = phase.nextPhases[0];
        if (nextPhaseId) {
          await this.transitionToPhase(instanceId, nextPhaseId, instance.metadata || {});
        }
      } else {
        // No more phases, complete workflow
        await this.completeWorkflow(instanceId);
      }
    } catch (error) {
      childLogger.error('Phase execution failed', error as Error);
      phaseInstance.state = 'failed';
      phaseInstance.error = error as Error;
      phaseInstance.completedAt = new Date();
      
      if (this.config.enableRetries && phaseInstance.retryCount < (this.config.maxRetries || 3)) {
        phaseInstance.retryCount++;
        childLogger.info('Retrying phase', { retryCount: phaseInstance.retryCount });
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay || 1000));
        await this.executePhase(instanceId, phaseId);
      } else {
        await this.updateInstance(instance);
        await this.failWorkflow(instanceId, error as Error);
      }
    }
  }

  @Emits('workflow.completed', {
    payloadMapper: (instanceId: string) => ({ instanceId })
  })
  private async completeWorkflow(instanceId: string): Promise<void> {
    const childLogger = this.logger.child({ component: 'StateMachine', instanceId });
    childLogger.info('Completing workflow');

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      return;
    }

    instance.state = 'completed';
    instance.completedAt = new Date();
    await this.updateInstance(instance);
  }

  @Emits('workflow.failed', {
    payloadMapper: (instanceId: string, error: Error) => ({ instanceId, error: error.message })
  })
  private async failWorkflow(instanceId: string, error: Error): Promise<void> {
    const childLogger = this.logger.child({ component: 'StateMachine', instanceId });
    childLogger.error('Workflow failed', error);

    const instance = this.getWorkflowInstance(instanceId);
    if (!instance) {
      return;
    }

    instance.state = 'failed';
    instance.completedAt = new Date();
    instance.error = error;
    await this.updateInstance(instance);
  }

  private async updateInstance(instance: IWorkflowInstance): Promise<void> {
    if (this.config.enablePersistence && this.persistence) {
      await this.persistence.updateWorkflowInstance(instance.id, instance);
    }
  }
}