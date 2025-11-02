# CLAUDE.md - @chasenocap/sdlc-engine

This file provides guidance to Claude when working with the sdlc-engine package.

## Package Overview

The sdlc-engine package provides a complete state machine implementation for SDLC workflow orchestration in the metaGOTHIC framework. It manages workflow execution, phase transitions, task dependencies, and error recovery.

## Key Components

### 1. **StateMachine** (`src/implementations/StateMachine.ts`)
- Main orchestrator for workflow execution
- Manages workflow lifecycle (start, pause, resume, cancel)
- Handles phase transitions with validation
- Integrates with persistence layer
- Emits comprehensive events

### 2. **PhaseExecutor** (`src/implementations/PhaseExecutor.ts`)
- Executes phases with task dependency resolution
- Handles parallel task execution where possible
- Manages task retries and failures
- Validates phase completion
- Supports phase rollback

### 3. **TaskExecutor** (`src/implementations/TaskExecutor.ts`)
- Executes different task types (automated, manual, review, approval)
- Simulates task duration for realistic execution
- Handles metadata-based task control
- Validates task results

### 4. **TransitionValidator** (`src/implementations/TransitionValidator.ts`)
- Validates phase transitions
- Checks transition conditions
- Handles approval workflows
- Emits approval request events

### 5. **InMemoryPersistence** (`src/implementations/InMemoryPersistence.ts`)
- Simple in-memory storage for workflow state
- Deep cloning to prevent reference issues
- Supports filtering and querying

## Architecture Patterns

### State Management
- Workflow states: `idle`, `running`, `paused`, `completed`, `failed`
- Phase states: `pending`, `active`, `completed`, `failed`, `skipped`, `rolled_back`
- Task states: `pending`, `running`, `completed`, `failed`, `skipped`

### Event-Driven Design
All major operations emit events:
- Workflow: started, completed, failed, paused, resumed
- Phase: started, executing, completed, failed, rolled_back
- Task: started, executing
- Transition: requested, approved, rejected, completed

### Dependency Injection
All services use constructor injection:
```typescript
@injectable()
export class StateMachine implements IStateMachine {
  constructor(
    @inject('ILogger') private logger: ILogger,
    @inject('IEventBus') eventBus: IEventBus,
    // ... other dependencies
  ) {
    setEventBus(this, eventBus);
  }
}
```

## Usage Patterns

### Starting a Workflow
```typescript
const instance = await stateMachine.startWorkflow('workflow-id', {
  project: 'My Project',
  autoApprove: true,
  completedTasks: ['task1', 'task2']
});
```

### Phase Transitions
```typescript
// Manual transition with approval
await stateMachine.transitionToPhase(instanceId, 'next-phase', {
  approved: true,
  approvedBy: 'Technical Lead'
});
```

### Task Execution Control
Tasks can be controlled via metadata:
- `completedTasks`: Array of task IDs to mark as pre-completed
- `approvedReviews`: Array of review task IDs to auto-approve
- `autoApprove`: Boolean to auto-approve all approvals
- `approvalDecisions`: Object mapping task IDs to approval decisions

## Testing Approach

### Unit Tests
- Mock all dependencies
- Test each component in isolation
- Cover error scenarios and edge cases
- Verify event emissions

### Integration Tests
- Use real DI container setup
- Test complete workflow execution
- Verify phase transitions
- Test persistence integration

## Common Issues

### 1. **Circular Dependencies**
- PhaseExecutor detects and reports circular task dependencies
- Ensure task dependencies form a DAG

### 2. **Transition Validation**
- Transitions require approval if configured
- Use metadata to provide approval context
- Check transition conditions are met

### 3. **Task Failures**
- Required tasks failing will fail the phase
- Optional tasks failing will be marked as skipped
- Configure retries for transient failures

## Error Handling

### Retry Mechanism
- Configurable max retries and delay
- Exponential backoff can be implemented
- Failed phases track retry count

### Rollback Support
- PhaseExecutor supports phase rollback
- Resets task states to pending
- Clears task results and errors

### Error Context
All errors include context:
```typescript
throw new PhaseExecutionError(
  'Phase execution failed',
  phaseId,
  { failedTasks, pendingTasks }
);
```

## Performance Considerations

### Task Execution
- Tasks execute in parallel where dependencies allow
- Simulated durations are capped for testing
- Real implementations should use queues

### Event Handling
- Events are emitted synchronously
- Consider async event handling for production
- Use event batching for high-volume workflows

### Persistence
- In-memory persistence is for development/testing
- Production should use proper database
- Consider workflow state snapshots

## Integration Points

### With @chasenocap/sdlc-config
- Loads workflow definitions
- Uses PhaseManager for navigation
- Validates against configuration

### With @chasenocap/event-system
- All components emit events
- Uses @Emits decorator
- Integrates with EventBus

### With @chasenocap/logger
- Structured logging with child loggers
- Contextual information in logs
- Error logging with full context

## Development Guidelines

### Adding New Features
1. Define interfaces in StateMachineTypes.ts
2. Implement with dependency injection
3. Add comprehensive tests
4. Emit relevant events
5. Update documentation

### Extending Task Types
1. Add new case in TaskExecutor
2. Define execution logic
3. Add validation rules
4. Test with metadata control

### Custom Persistence
1. Implement IWorkflowPersistence interface
2. Handle Maps and Dates properly
3. Support filtering and queries
4. Test with concurrent access

## Debugging Tips

### Workflow Not Progressing
- Check task completion status
- Verify transition conditions
- Look for approval requirements
- Check event emissions

### Task Dependencies
- Log dependency graph
- Check for circular dependencies
- Verify task IDs match
- Test with simple workflows first

### Event Tracking
- Subscribe to all events during debugging
- Log event payloads
- Track event ordering
- Use event history for replay