# SDLC State Machine Patterns

Guide to implementing workflow automation using state machines in the metaGOTHIC SDLC engine.

## Overview

The SDLC engine uses a hierarchical state machine pattern to manage software development workflows with:
- **Workflow-level states**: Overall execution state
- **Phase-level states**: Individual phase lifecycle
- **Task-level states**: Task execution tracking
- **Event-driven transitions**: State changes trigger events
- **Validation gates**: Ensure valid state transitions

## State Hierarchies

### Workflow States

```
┌────────────────────────────────────────────┐
│              IDLE                          │
│  (Workflow defined, not started)           │
└────┬───────────────────────────────────────┘
     │
     │ startWorkflow()
     ↓
┌────────────────────────────────────────────┐
│             RUNNING                        │
│  (Actively executing phases)               │
├────────────────────────────────────────────┤
│  ┌─────┐    ┌─────┐    ┌─────┐            │
│  │ P1  │ → │ P2  │ → │ P3  │            │
│  └─────┘    └─────┘    └─────┘            │
└────┬──────────────────────┬────────────────┘
     │                      │
     │ pause()              │ complete()
     ↓                      ↓
┌────────────────┐    ┌────────────────┐
│    PAUSED      │    │   COMPLETED    │
│                │    │                │
└────────────────┘    └────────────────┘
     │
     │ resume()
     ↓
   RUNNING
```

**States**:
- **IDLE**: Workflow configured but not started
- **RUNNING**: Actively executing workflow
- **PAUSED**: Temporarily suspended, can be resumed
- **COMPLETED**: Successfully finished all phases
- **FAILED**: Unrecoverable error occurred

### Phase States

```
PENDING → ACTIVE → COMPLETED
             ↓           ↑
         FAILED    (rollback)
             ↓
       ROLLED_BACK

        SKIPPED (if conditions not met)
```

**States**:
- **PENDING**: Awaiting execution
- **ACTIVE**: Currently executing tasks
- **COMPLETED**: All tasks finished successfully
- **FAILED**: Task failure or validation error
- **SKIPPED**: Bypassed due to conditions
- **ROLLED_BACK**: Reverted after failure

### Task States

```
PENDING → RUNNING → COMPLETED
             ↓
          FAILED
             ↓
          SKIPPED (if not required)
```

## Core Patterns

### 1. Sequential Phase Execution

Execute phases in strict order:

```typescript
const workflowConfig = {
  id: 'sequential-workflow',
  initialPhase: 'requirements',
  phases: [
    {
      id: 'requirements',
      nextPhases: ['design'],
      // ...
    },
    {
      id: 'design',
      nextPhases: ['implementation'],
      // ...
    },
    {
      id: 'implementation',
      nextPhases: ['testing'],
      // ...
    }
  ]
};

// Execution:
// requirements → design → implementation → testing
```

### 2. Conditional Branching

Branch to different phases based on conditions:

```typescript
const branchingWorkflow = {
  id: 'conditional-workflow',
  phases: [
    {
      id: 'code-review',
      nextPhases: ['merge', 'rework'],
      // ...
    }
  ],
  transitions: [
    {
      from: 'code-review',
      to: 'merge',
      conditions: ['All approvals obtained', 'No blocking issues'],
      requiresApproval: true
    },
    {
      from: 'code-review',
      to: 'rework',
      conditions: ['Changes requested'],
      requiresApproval: false
    }
  ]
};

// Execute transition based on review outcome
await stateMachine.transitionToPhase(instanceId,
  allApproved ? 'merge' : 'rework'
);
```

### 3. Parallel Execution

Execute independent phases concurrently:

```typescript
const parallelWorkflow = {
  id: 'parallel-workflow',
  phases: [
    {
      id: 'planning',
      nextPhases: ['frontend-dev', 'backend-dev', 'infrastructure'],
      // ...
    },
    {
      id: 'frontend-dev',
      nextPhases: ['integration'],
      tasks: [/* frontend tasks */]
    },
    {
      id: 'backend-dev',
      nextPhases: ['integration'],
      tasks: [/* backend tasks */]
    },
    {
      id: 'infrastructure',
      nextPhases: ['integration'],
      tasks: [/* infra tasks */]
    },
    {
      id: 'integration',
      // Waits for all three phases to complete
      // ...
    }
  ]
};
```

### 4. Loop-Back Pattern

Return to previous phase for iterations:

```typescript
const iterativeWorkflow = {
  id: 'agile-sprint',
  phases: [
    {
      id: 'sprint-planning',
      nextPhases: ['development'],
      // ...
    },
    {
      id: 'development',
      nextPhases: ['testing'],
      // ...
    },
    {
      id: 'testing',
      nextPhases: ['review'],
      // ...
    },
    {
      id: 'review',
      nextPhases: ['development', 'deployment'], // Loop back or proceed
      // ...
    }
  ],
  transitions: [
    {
      from: 'review',
      to: 'development',
      conditions: ['Issues found'],
      // Loop back for fixes
    },
    {
      from: 'review',
      to: 'deployment',
      conditions: ['All checks passed'],
      // Proceed to deployment
    }
  ]
};
```

### 5. Approval Gates

Require human approval before proceeding:

```typescript
const approvalWorkflow = {
  phases: [
    {
      id: 'testing',
      nextPhases: ['production-deploy'],
      requiresApproval: false
    }
  ],
  transitions: [
    {
      from: 'testing',
      to: 'production-deploy',
      requiresApproval: true,
      approvers: ['Release Manager', 'VP Engineering'],
      conditions: ['All tests passed', 'Security scan clean']
    }
  ]
};

// Request approval
await stateMachine.transitionToPhase(instanceId, 'production-deploy', {
  approved: true,
  approvedBy: 'Release Manager',
  approvalNotes: 'All checks passed, approved for deployment'
});
```

## Task Execution Patterns

### 1. Task Dependencies

Ensure tasks execute in correct order:

```typescript
const phase = {
  id: 'build-phase',
  tasks: [
    {
      id: 'install-deps',
      type: 'automated',
      required: true
    },
    {
      id: 'compile',
      type: 'automated',
      required: true,
      dependencies: ['install-deps'] // Must wait
    },
    {
      id: 'run-tests',
      type: 'automated',
      required: true,
      dependencies: ['compile'] // Sequential dependency
    },
    {
      id: 'generate-docs',
      type: 'automated',
      required: false,
      dependencies: ['compile'] // Parallel with tests
    }
  ]
};

// Execution order:
// install-deps → compile → (run-tests || generate-docs)
```

### 2. Task Types

Different execution strategies per type:

```typescript
interface Task {
  id: string;
  type: 'automated' | 'manual' | 'review' | 'approval';
  required: boolean;
  estimatedDuration: string;
}

// Automated: Execute immediately
{
  id: 'deploy',
  type: 'automated',
  required: true,
  estimatedDuration: '5 minutes'
}

// Manual: Wait for human completion
{
  id: 'documentation',
  type: 'manual',
  required: true,
  estimatedDuration: '2 hours'
}

// Review: Peer review required
{
  id: 'code-review',
  type: 'review',
  required: true,
  estimatedDuration: '1 hour'
}

// Approval: Explicit approval needed
{
  id: 'production-approval',
  type: 'approval',
  required: true,
  approvers: ['Tech Lead']
}
```

### 3. Task Retry Pattern

Automatically retry failed tasks:

```typescript
class RetryableTaskExecutor {
  async executeWithRetry(task, maxRetries = 3) {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const result = await this.executeTask(task);
        return result;
      } catch (error) {
        attempt++;

        if (attempt >= maxRetries) {
          throw new Error(`Task ${task.id} failed after ${maxRetries} attempts`);
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await sleep(delay);

        this.logger.warn(`Retrying task ${task.id}, attempt ${attempt + 1}/${maxRetries}`);
      }
    }
  }
}
```

### 4. Optional Task Skipping

Skip non-required tasks on failure:

```typescript
const phase = {
  tasks: [
    {
      id: 'critical-test',
      required: true // Phase fails if this fails
    },
    {
      id: 'performance-test',
      required: false // Phase continues if this fails
    },
    {
      id: 'accessibility-audit',
      required: false // Optional task
    }
  ]
};

// Execution logic
for (const task of phase.tasks) {
  try {
    await executeTask(task);
  } catch (error) {
    if (task.required) {
      throw error; // Fail phase
    } else {
      this.logger.warn(`Optional task ${task.id} failed, continuing...`);
      task.status = 'skipped';
    }
  }
}
```

## Error Recovery Patterns

### 1. Phase Rollback

Undo changes when phase fails:

```typescript
class PhaseExecutor {
  async executePhase(phase) {
    const rollbackActions = [];

    try {
      for (const task of phase.tasks) {
        const result = await this.executeTask(task);

        // Track rollback action
        if (task.rollback) {
          rollbackActions.push(task.rollback);
        }
      }
    } catch (error) {
      // Rollback in reverse order
      for (const rollback of rollbackActions.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          this.logger.error('Rollback failed:', rollbackError);
        }
      }

      phase.status = 'rolled_back';
      throw error;
    }
  }
}
```

### 2. Workflow Pause/Resume

Pause on errors, resume when fixed:

```typescript
// Pause workflow on critical error
await stateMachine.pauseWorkflow(instanceId, {
  reason: 'Production deployment failed',
  canResume: true,
  requiresIntervention: true
});

// Fix the issue, then resume
await stateMachine.resumeWorkflow(instanceId, {
  resumedBy: 'DevOps Engineer',
  notes: 'Issue resolved, deployment script fixed'
});
```

### 3. Checkpointing

Save progress at key milestones:

```typescript
class StateMachine {
  async executeWorkflow(workflow) {
    for (const phase of workflow.phases) {
      // Create checkpoint before phase
      await this.createCheckpoint(workflow.id, phase.id);

      try {
        await this.executePhase(phase);
      } catch (error) {
        // Can restore from checkpoint
        await this.restoreFromCheckpoint(workflow.id, phase.id);
        throw error;
      }
    }
  }
}
```

## Event Patterns

### 1. Event-Driven Workflow

React to events to drive workflow:

```typescript
const eventBus = container.get<IEventBus>('IEventBus');

// Subscribe to workflow events
eventBus.on('workflow.phase.completed', async (event) => {
  const { workflowId, phaseId, instanceId } = event;

  // Trigger notifications
  await notifyStakeholders({
    workflow: workflowId,
    phase: phaseId,
    status: 'completed'
  });

  // Update metrics
  metrics.increment('workflow.phases.completed', {
    workflow: workflowId,
    phase: phaseId
  });
});

// Handle failures
eventBus.on('workflow.phase.failed', async (event) => {
  await alertOncall({
    severity: 'HIGH',
    message: `Phase ${event.phaseId} failed`,
    workflow: event.workflowId
  });
});
```

### 2. Progress Tracking

Monitor workflow progress:

```typescript
eventBus.on('task.completed', (event) => {
  updateProgress(event.workflowId, {
    completedTasks: event.completedCount,
    totalTasks: event.totalCount,
    percentage: (event.completedCount / event.totalCount) * 100
  });
});

// Real-time dashboard updates
eventBus.on('workflow.state.changed', (event) => {
  broadcastToClients({
    type: 'WORKFLOW_UPDATE',
    workflow: event.workflowId,
    oldState: event.oldState,
    newState: event.newState
  });
});
```

## Advanced Patterns

### 1. Workflow Composition

Compose workflows from smaller workflows:

```typescript
const microserviceWorkflow = {
  id: 'deploy-microservice',
  phases: [
    { id: 'build', nextPhases: ['test'] },
    { id: 'test', nextPhases: ['deploy'] },
    { id: 'deploy', nextPhases: [] }
  ]
};

const systemWorkflow = {
  id: 'deploy-system',
  phases: [
    {
      id: 'deploy-all-services',
      subWorkflows: [
        { workflowId: 'deploy-microservice', service: 'auth' },
        { workflowId: 'deploy-microservice', service: 'api' },
        { workflowId: 'deploy-microservice', service: 'web' }
      ]
    }
  ]
};
```

### 2. Dynamic Phase Generation

Generate phases at runtime:

```typescript
const dynamicWorkflow = {
  id: 'multi-environment-deploy',
  phaseFactory: (context) => {
    const environments = context.targetEnvironments || ['dev', 'staging', 'prod'];

    return environments.map((env, index) => ({
      id: `deploy-${env}`,
      name: `Deploy to ${env}`,
      nextPhases: index < environments.length - 1 ? [`deploy-${environments[index + 1]}`] : [],
      tasks: [
        { id: `build-${env}`, type: 'automated' },
        { id: `test-${env}`, type: 'automated' },
        { id: `deploy-${env}`, type: 'automated' }
      ]
    }));
  }
};
```

### 3. Deadline Monitoring

Enforce time limits on phases:

```typescript
const timedPhase = {
  id: 'time-sensitive-deployment',
  deadline: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
  onDeadlineExceeded: async (phase) => {
    await sendAlert({
      severity: 'WARNING',
      message: `Phase ${phase.id} exceeded deadline`,
      action: 'Review and escalate if needed'
    });
  }
};

// Monitor deadlines
setInterval(async () => {
  const activePhases = await getActivePhases();
  for (const phase of activePhases) {
    if (phase.deadline && Date.now() > phase.deadline.getTime()) {
      await phase.onDeadlineExceeded(phase);
    }
  }
}, 60000); // Check every minute
```

## Best Practices

### 1. State Machine Design

**DO**:
- Keep states atomic and well-defined
- Use events for all state changes
- Validate transitions before executing
- Provide clear error messages
- Track all state history

**DON'T**:
- Create circular dependencies
- Allow invalid state transitions
- Forget to handle edge cases
- Skip validation steps
- Lose state history

### 2. Error Handling

- Always provide rollback mechanisms
- Log all state transitions
- Implement retry logic for transient errors
- Provide clear error context
- Allow manual intervention when needed

### 3. Performance

- Use task parallelization when possible
- Implement efficient state persistence
- Monitor execution metrics
- Set appropriate timeouts
- Cache workflow configurations

### 4. Testing

```typescript
describe('Workflow State Machine', () => {
  it('should transition through all phases', async () => {
    const instance = await stateMachine.startWorkflow('test-workflow');
    expect(instance.currentPhase).toBe('phase1');

    await stateMachine.transitionToPhase(instance.id, 'phase2');
    expect(instance.currentPhase).toBe('phase2');
  });

  it('should handle approval gates', async () => {
    const instance = await stateMachine.startWorkflow('approval-workflow');

    await expect(
      stateMachine.transitionToPhase(instance.id, 'production')
    ).rejects.toThrow('Approval required');

    await stateMachine.transitionToPhase(instance.id, 'production', {
      approved: true,
      approvedBy: 'Manager'
    });

    expect(instance.currentPhase).toBe('production');
  });
});
```

---

*Part of the metaGOTHIC Framework - AI-Guided Opinionated TypeScript Framework*
