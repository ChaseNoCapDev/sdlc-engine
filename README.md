# @chasenocap/sdlc-engine

SDLC state machine engine for the metaGOTHIC framework. Provides workflow orchestration, phase execution, and task management with event-driven architecture.

## Features

- **State Machine**: Complete workflow orchestration with states (idle, running, paused, completed, failed)
- **Phase Management**: Execute SDLC phases with dependency management
- **Task Execution**: Support for automated, manual, review, and approval tasks
- **Event-Driven**: Comprehensive event emission for workflow visibility
- **Error Recovery**: Automatic retries and rollback mechanisms
- **Persistence**: Pluggable persistence layer for workflow state
- **Validation**: Transition validation with approval workflows

## Installation

```bash
npm install @chasenocap/sdlc-engine
```

## Quick Start

```typescript
import { createContainer } from '@chasenocap/di-framework';
import { WinstonLogger } from '@chasenocap/logger';
import { EventBus } from '@chasenocap/event-system';
import { PhaseManager } from '@chasenocap/sdlc-config';
import { 
  StateMachine, 
  TransitionValidator,
  PhaseExecutor,
  TaskExecutor,
  InMemoryPersistence,
  DEFAULT_STATE_MACHINE_CONFIG
} from '@chasenocap/sdlc-engine';

// Set up dependencies
const container = createContainer();
container.bind('ILogger').to(WinstonLogger);
container.bind('IEventBus').to(EventBus);
container.bind('IPhaseManager').to(PhaseManager);
// ... bind other services

// Create state machine
const stateMachine = container.get<StateMachine>('IStateMachine');

// Start a workflow
const instance = await stateMachine.startWorkflow('my-workflow', {
  project: 'My Project',
  autoApprove: true
});

// Transition between phases
await stateMachine.transitionToPhase(instance.id, 'next-phase');

// Pause/Resume
await stateMachine.pauseWorkflow(instance.id);
await stateMachine.resumeWorkflow(instance.id);
```

## Core Components

### StateMachine

The main orchestrator that manages workflow execution:

```typescript
interface IStateMachine {
  startWorkflow(workflowId: string, initialData?: Record<string, unknown>): Promise<IWorkflowInstance>;
  pauseWorkflow(instanceId: string): Promise<void>;
  resumeWorkflow(instanceId: string): Promise<void>;
  cancelWorkflow(instanceId: string, reason?: string): Promise<void>;
  transitionToPhase(instanceId: string, targetPhaseId: string, context?: Record<string, unknown>): Promise<void>;
}
```

### PhaseExecutor

Executes phases and manages task dependencies:

```typescript
interface IPhaseExecutor {
  executePhase(context: IPhaseContext): Promise<void>;
  validatePhaseCompletion(context: IPhaseContext): Promise<boolean>;
  rollbackPhase(context: IPhaseContext): Promise<void>;
}
```

### TaskExecutor

Handles different task types:

```typescript
interface ITaskExecutor {
  executeTask(context: ITaskContext): Promise<unknown>;
  validateTaskResult(context: ITaskContext): Promise<boolean>;
}
```

## Task Types

- **automated**: Executes programmatically (scripts, API calls)
- **manual**: Requires human intervention
- **review**: Review and feedback tasks
- **approval**: Approval decision tasks

## Event System

The engine emits events throughout the workflow lifecycle:

```typescript
// Workflow events
eventBus.on('workflow.started', (data) => console.log('Workflow started', data));
eventBus.on('workflow.completed', (data) => console.log('Workflow completed', data));
eventBus.on('workflow.failed', (data) => console.log('Workflow failed', data));

// Phase events
eventBus.on('phase.started', (data) => console.log('Phase started', data));
eventBus.on('phase.completed', (data) => console.log('Phase completed', data));

// Task events
eventBus.on('task.started', (data) => console.log('Task started', data));
eventBus.on('task.executing', (data) => console.log('Task executing', data));

// Transition events
eventBus.on('transition.requested', (data) => console.log('Transition requested', data));
eventBus.on('transition.approved', (data) => console.log('Transition approved', data));
```

## Configuration

```typescript
const config: IStateMachineConfig = {
  enablePersistence: true,    // Enable workflow state persistence
  enableRetries: true,        // Enable automatic retries on failure
  maxRetries: 3,             // Maximum retry attempts
  retryDelay: 1000,          // Delay between retries (ms)
  enableRollback: true,      // Enable phase rollback on failure
  defaultTimeout: 300000,    // Default task timeout (5 minutes)
  enableMetrics: true        // Enable performance metrics
};
```

## Metadata Control

Control workflow behavior through metadata:

```typescript
// Auto-approve transitions
const instance = await stateMachine.startWorkflow('workflow-id', {
  autoApprove: true
});

// Pre-complete tasks
const instance = await stateMachine.startWorkflow('workflow-id', {
  completedTasks: ['task1', 'task2']
});

// Pre-approve reviews
const instance = await stateMachine.startWorkflow('workflow-id', {
  approvedReviews: ['review1']
});

// Approval decisions
const instance = await stateMachine.startWorkflow('workflow-id', {
  approvalDecisions: {
    'approval1': true,
    'approval2': false
  }
});
```

## Persistence

The engine supports pluggable persistence:

```typescript
// In-memory persistence (default)
container.bind('IWorkflowPersistence').to(InMemoryPersistence);

// Custom persistence
class MongoDBPersistence implements IWorkflowPersistence {
  async saveWorkflowInstance(instance: IWorkflowInstance): Promise<void> {
    // Save to MongoDB
  }
  // ... other methods
}
```

## Error Handling

The engine provides comprehensive error handling:

- Automatic retries with configurable delays
- Phase rollback on critical failures
- Detailed error context in events
- Graceful degradation for optional tasks

## Integration with metaGOTHIC

This package integrates seamlessly with:

- **@chasenocap/sdlc-config**: Provides workflow and phase definitions
- **@chasenocap/prompt-toolkit**: Generate AI prompts for task guidance
- **@chasenocap/claude-client**: AI assistance for task execution

## License

MIT