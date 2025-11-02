import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from 'inversify';
import { WinstonLogger } from '@chasenocap/logger';
import { EventBus } from '@chasenocap/event-system';
import { ConfigLoader, PhaseManager } from '@chasenocap/sdlc-config';
import { 
  StateMachine,
  TransitionValidator,
  PhaseExecutor,
  TaskExecutor,
  InMemoryPersistence,
  DEFAULT_STATE_MACHINE_CONFIG
} from '../../src/index.js';
import type { IStateMachineConfig } from '../../src/types/StateMachineTypes.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Workflow Execution Integration', () => {
  let container: Container;
  let stateMachine: StateMachine;
  let phaseManager: PhaseManager;

  beforeEach(async () => {
    // Set up DI container
    container = new Container();
    
    // Bind core services
    container.bind('ILogger').to(WinstonLogger).inSingletonScope();
    container.bind('IEventBus').to(EventBus).inSingletonScope();
    
    // Bind SDLC config services
    container.bind('IConfigLoader').to(ConfigLoader);
    container.bind('IPhaseManager').to(PhaseManager).inSingletonScope();
    
    // Bind state machine services
    container.bind('IStateMachine').to(StateMachine);
    container.bind('ITransitionValidator').to(TransitionValidator);
    container.bind('IPhaseExecutor').to(PhaseExecutor);
    container.bind('ITaskExecutor').to(TaskExecutor);
    container.bind('IWorkflowPersistence').to(InMemoryPersistence).inSingletonScope();
    
    // Configure state machine
    const config: IStateMachineConfig = {
      ...DEFAULT_STATE_MACHINE_CONFIG,
      retryDelay: 10 // Fast retries for testing
    };
    container.bind('IStateMachineConfig').toConstantValue(config);
    
    // Load test configuration
    const configLoader = container.get<ConfigLoader>('IConfigLoader');
    const testConfigYaml = `
version: 1.0.0
workflows:
  - id: test-workflow
    name: Test Workflow
    version: 1.0.0
    initialPhase: design
    phases:
      - id: design
        name: Design Phase
        objectives:
          - Create design documents
        deliverables:
          - Design specification
        entryConditions:
          - Requirements approved
        exitConditions:
          - Design reviewed and approved
        tasks:
          - id: create-design
            name: Create Design Document
            type: manual
            required: true
            estimatedDuration: 2 days
          - id: review-design
            name: Review Design
            type: review
            required: true
            dependencies:
              - create-design
        nextPhases:
          - implementation
        requiresApproval: true

      - id: implementation
        name: Implementation Phase
        objectives:
          - Implement the solution
        deliverables:
          - Working software
        entryConditions:
          - Design approved
        exitConditions:
          - All tests passing
        tasks:
          - id: write-code
            name: Write Code
            type: manual
            required: true
            estimatedDuration: 5 days
          - id: write-tests
            name: Write Tests
            type: manual
            required: true
            dependencies:
              - write-code
          - id: run-tests
            name: Run Tests
            type: automated
            required: true
            dependencies:
              - write-tests
        nextPhases:
          - deployment

      - id: deployment
        name: Deployment Phase
        objectives:
          - Deploy to production
        deliverables:
          - Deployed application
        entryConditions:
          - Tests passing
        exitConditions:
          - Application live
        tasks:
          - id: deploy-app
            name: Deploy Application
            type: automated
            required: true
            estimatedDuration: 1 hour
        nextPhases: []

    transitions:
      - from: design
        to: implementation
        conditions:
          - Design approved
        requiresApproval: true
        approvers:
          - Technical Lead
      - from: implementation
        to: deployment
        conditions:
          - All tests passing
`;

    const sdlcConfig = await configLoader.loadFromString(testConfigYaml);
    
    phaseManager = container.get<PhaseManager>('IPhaseManager');
    phaseManager.setConfig(sdlcConfig);
    
    stateMachine = container.get<StateMachine>('IStateMachine');
  });

  it('should execute a complete workflow', async () => {
    // Start workflow
    const instance = await stateMachine.startWorkflow('test-workflow', {
      project: 'Test Project',
      autoApprove: true,
      completedTasks: ['create-design', 'review-design', 'write-code', 'write-tests']
    });

    expect(instance).toBeDefined();
    expect(instance.state).toBe('running');
    expect(instance.currentPhaseId).toBe('design');

    // Wait for auto-progression
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should auto-transition through phases
    const finalInstance = stateMachine.getWorkflowInstance(instance.id);
    expect(finalInstance?.state).toBe('completed');
    expect(finalInstance?.currentPhaseId).toBe('deployment');
  });

  it('should handle phase transitions with approval', async () => {
    const instance = await stateMachine.startWorkflow('test-workflow', {
      completedTasks: ['create-design', 'review-design']
    });

    // Manually transition to implementation (requires approval)
    await stateMachine.transitionToPhase(instance.id, 'implementation', {
      approved: true,
      approvedBy: 'Technical Lead'
    });

    const updated = stateMachine.getWorkflowInstance(instance.id);
    expect(updated?.currentPhaseId).toBe('implementation');
  });

  it('should reject transition without approval', async () => {
    const instance = await stateMachine.startWorkflow('test-workflow', {
      completedTasks: ['create-design', 'review-design']
    });

    // Try to transition without approval
    await expect(
      stateMachine.transitionToPhase(instance.id, 'implementation')
    ).rejects.toThrow('Transition validation failed');
  });

  it('should pause and resume workflow', async () => {
    const instance = await stateMachine.startWorkflow('test-workflow');

    // Pause workflow
    await stateMachine.pauseWorkflow(instance.id);
    
    let paused = stateMachine.getWorkflowInstance(instance.id);
    expect(paused?.state).toBe('paused');

    // Resume workflow
    await stateMachine.resumeWorkflow(instance.id);
    
    let resumed = stateMachine.getWorkflowInstance(instance.id);
    expect(resumed?.state).toBe('running');
  });

  it('should persist workflow state', async () => {
    const persistence = container.get<InMemoryPersistence>('IWorkflowPersistence');
    
    const instance = await stateMachine.startWorkflow('test-workflow');
    
    // Load from persistence
    const loaded = await persistence.loadWorkflowInstance(instance.id);
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(instance.id);
    
    // List all instances
    const instances = await persistence.listWorkflowInstances();
    expect(instances).toHaveLength(1);
  });

  it('should emit events during workflow execution', async () => {
    const eventBus = container.get<EventBus>('IEventBus');
    const events: any[] = [];
    
    // Subscribe to all events
    eventBus.on('workflow.started', (data) => events.push({ type: 'workflow.started', data }));
    eventBus.on('phase.started', (data) => events.push({ type: 'phase.started', data }));
    eventBus.on('task.started', (data) => events.push({ type: 'task.started', data }));
    
    await stateMachine.startWorkflow('test-workflow', {
      completedTasks: ['create-design']
    });
    
    // Wait for events
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(events.some(e => e.type === 'workflow.started')).toBe(true);
    expect(events.some(e => e.type === 'phase.started')).toBe(true);
    expect(events.some(e => e.type === 'task.started')).toBe(true);
  });

  it('should handle task failures with retry', async () => {
    const instance = await stateMachine.startWorkflow('test-workflow', {
      // Don't mark any tasks as completed, forcing execution
    });

    // Wait for retries
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should eventually fail after retries
    const final = stateMachine.getWorkflowInstance(instance.id);
    expect(final?.state).toBe('failed');
  });
});