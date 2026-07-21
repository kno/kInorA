# Delta for 09b-v1-workout-offline-history

## ADDED Requirements

### Requirement: Storage I/O Failure Resilience

The web flush pass MUST NOT surface an unhandled promise rejection when store I/O throws during entries read, mutation delete, snapshot write, or cleanup. No mutation SHALL be removed from the queue before successful server acknowledgement. If a store I/O failure occurs before removal completes (entries read or delete fails), the mutation remains queued and MAY be retried by a later valid trigger (connectivity change or next enqueue). If removal completes and a subsequent snapshot write or cleanup call fails, the acknowledged mutation is already absent from the queue — the error is swallowed, no retry is available for that mutation, and snapshot/pointer may be stale; no new recovery mechanism is in scope. Mobile storage I/O behavior is excluded from this requirement and is already satisfied by the existing mobile `flush()` try/catch and regression test.

#### Scenario: Entries() read throws

- GIVEN queued mutations are pending flush on the web client
- WHEN `getQueuedMutations` throws a store I/O error during entries read
- THEN the flush wrapper catches the error, produces no unhandled rejection
- AND the mutation remains queued and MAY be retried by a later trigger

#### Scenario: RemoveMutation delete throws

- GIVEN a mutation was successfully acknowledged by the server and delete has begun
- WHEN `removeMutation` throws a store I/O error before all deletes complete
- THEN the flush wrapper catches the error, produces no unhandled rejection
- AND the not-successfully-removed mutation remains queued and MAY be retried by a later trigger

#### Scenario: WriteSnapshot throws after removal completes

- GIVEN all acknowledged mutations were removed from the queue
- WHEN `writeSnapshot` throws a store I/O error
- THEN the flush wrapper catches the error, produces no unhandled rejection
- AND the acknowledged mutations are already absent from the queue and are NOT available for retry
- AND the snapshot MAY be stale; no new recovery mechanism is in scope

#### Scenario: Cleanup throws after removal and snapshot write

- GIVEN acknowledged mutations were removed and snapshot was written
- WHEN `clearSnapshot` or `clearActiveSessionPointer` throws a store I/O error
- THEN the flush wrapper catches the error, produces no unhandled rejection
- AND the cleanup pointer MAY be stale; no new recovery mechanism is in scope

#### Scenario: Retry on next valid trigger

- GIVEN a flush pass failed due to a transient storage I/O error before removal completed
- WHEN network connectivity changes or a new mutation is enqueued
- THEN the flush pass re-invokes and retries the queued mutations that were not successfully removed

#### Scenario: Throwing-store regression test

- GIVEN a test double of the store that throws `entries()` mid-flush
- WHEN the flush pass executes in the test
- THEN the test observes zero unhandled promise rejections within its scope
- AND the queued mutations count is unchanged after the failed pass
