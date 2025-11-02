import { injectable, inject } from 'inversify';
import type { ILogger } from '@chasenocap/logger';
import type {
  IWorkflowPersistence,
  IWorkflowInstance,
  MachineState
} from '../types/StateMachineTypes.js';

@injectable()
export class InMemoryPersistence implements IWorkflowPersistence {
  private readonly storage: Map<string, IWorkflowInstance> = new Map();

  constructor(@inject('ILogger') private logger: ILogger) {}

  async saveWorkflowInstance(instance: IWorkflowInstance): Promise<void> {
    const childLogger = this.logger.child({
      component: 'InMemoryPersistence',
      instanceId: instance.id
    });

    childLogger.debug('Saving workflow instance');
    
    // Deep clone to avoid reference issues
    const clone = this.cloneInstance(instance);
    this.storage.set(instance.id, clone);
    
    childLogger.debug('Workflow instance saved', {
      totalInstances: this.storage.size
    });
  }

  async loadWorkflowInstance(instanceId: string): Promise<IWorkflowInstance | null> {
    const childLogger = this.logger.child({
      component: 'InMemoryPersistence',
      instanceId
    });

    childLogger.debug('Loading workflow instance');
    
    const instance = this.storage.get(instanceId);
    if (!instance) {
      childLogger.warn('Instance not found');
      return null;
    }

    // Return a clone to avoid external mutations
    return this.cloneInstance(instance);
  }

  async updateWorkflowInstance(
    instanceId: string,
    updates: Partial<IWorkflowInstance>
  ): Promise<void> {
    const childLogger = this.logger.child({
      component: 'InMemoryPersistence',
      instanceId
    });

    childLogger.debug('Updating workflow instance');
    
    const existing = this.storage.get(instanceId);
    if (!existing) {
      childLogger.error('Cannot update non-existent instance');
      throw new Error(`Workflow instance not found: ${instanceId}`);
    }

    // Merge updates
    const updated = {
      ...existing,
      ...updates,
      // Ensure maps are properly merged
      phaseStates: updates.phaseStates || existing.phaseStates
    };

    this.storage.set(instanceId, this.cloneInstance(updated));
    
    childLogger.debug('Workflow instance updated');
  }

  async listWorkflowInstances(
    filter?: { state?: MachineState; workflowId?: string }
  ): Promise<IWorkflowInstance[]> {
    const childLogger = this.logger.child({
      component: 'InMemoryPersistence',
      filter
    });

    childLogger.debug('Listing workflow instances');
    
    let instances = Array.from(this.storage.values());

    if (filter) {
      if (filter.state) {
        instances = instances.filter(i => i.state === filter.state);
      }
      if (filter.workflowId) {
        instances = instances.filter(i => i.workflowId === filter.workflowId);
      }
    }

    childLogger.debug('Found instances', { count: instances.length });
    
    // Return clones
    return instances.map(i => this.cloneInstance(i));
  }

  // Helper to deep clone instances
  private cloneInstance(instance: IWorkflowInstance): IWorkflowInstance {
    // Convert Maps to arrays for JSON serialization
    const phaseStatesArray = Array.from(instance.phaseStates.entries()).map(([key, value]) => ({
      key,
      value: {
        ...value,
        taskStates: Array.from(value.taskStates.entries()).map(([k, v]) => ({ key: k, value: v }))
      }
    }));

    // Serialize and deserialize for deep clone
    const json = JSON.stringify({
      ...instance,
      phaseStates: phaseStatesArray,
      startedAt: instance.startedAt.toISOString(),
      completedAt: instance.completedAt?.toISOString()
    });

    const parsed = JSON.parse(json);

    // Reconstruct Maps and Dates
    const phaseStates = new Map();
    parsed.phaseStates.forEach((entry: any) => {
      const taskStates = new Map();
      entry.value.taskStates.forEach((taskEntry: any) => {
        taskStates.set(taskEntry.key, {
          ...taskEntry.value,
          startedAt: taskEntry.value.startedAt ? new Date(taskEntry.value.startedAt) : undefined,
          completedAt: taskEntry.value.completedAt ? new Date(taskEntry.value.completedAt) : undefined
        });
      });
      
      phaseStates.set(entry.key, {
        ...entry.value,
        taskStates,
        startedAt: entry.value.startedAt ? new Date(entry.value.startedAt) : undefined,
        completedAt: entry.value.completedAt ? new Date(entry.value.completedAt) : undefined
      });
    });

    return {
      ...parsed,
      phaseStates,
      startedAt: new Date(parsed.startedAt),
      completedAt: parsed.completedAt ? new Date(parsed.completedAt) : undefined
    };
  }
}