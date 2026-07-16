# 09b-v1-workout-offline-history Specification

## Purpose

Add offline-first workout persistence, reconnect sync, and historical progress views.

## Dependencies

- `09a-v1-workout-tracking-core`
- `06-v1-mobile-foundation`

## Requirements

### Requirement: Offline Workout Capture

The tracker MUST store workout changes locally when network connectivity is unavailable, on **both web and mobile** clients.

#### Scenario: Track workout offline on web

- GIVEN the web tracker has no network connectivity
- WHEN a user logs sets, RPE, and notes
- THEN all data is stored locally (IndexedDB queue) and remains visible in the UI

#### Scenario: Track workout offline on mobile

- GIVEN the mobile tracker has no network connectivity
- WHEN a user logs sets, RPE, and notes
- THEN all data is stored locally on-device and remains visible in the UI

#### Scenario: Offline data survives reload

- GIVEN a user has logged sets while offline
- WHEN the app is reloaded (web) or restarted (mobile) while still offline
- THEN the previously logged sets, RPE, and notes are still visible in the UI

### Requirement: Reconnect Sync

Offline workout data MUST sync to the server when connectivity resumes, exactly once, with **no loss and no duplication**. Concurrent edits to the same set MUST resolve **last-write-wins keyed by `setId`**. Retrying the session-complete mutation after a prior successful completion MUST return success, not an error.

#### Scenario: Sync on reconnect

- GIVEN unsynced local workout mutations exist in the queue
- WHEN network connectivity is restored
- THEN each queued mutation is sent to the server exactly once
- AND the local queue is cleared only after server acknowledgment

#### Scenario: No duplication on repeated flush attempts

- GIVEN a mutation was already synced successfully
- WHEN the sync flush is triggered again (e.g. app restart mid-flush)
- THEN the already-synced mutation is not resent, or resending it produces no duplicate record

#### Scenario: Last-write-wins per setId

- GIVEN two queued mutations target the same `setId` with different values
- WHEN the queue flushes on reconnect
- THEN the server state reflects the mutation with the highest client-assigned monotonic order (`clientSeq`) for that `setId`
- AND no partial/merged value from the older mutation is persisted

#### Scenario: Idempotent retry of complete after success

- GIVEN a workout session was already completed successfully on the server
- WHEN the client retries `POST /workout-sessions/:id/complete` (e.g. due to a dropped response)
- THEN the server returns a success response
- AND the server does NOT return 404 or re-run completion side effects

### Requirement: Session History

The system SHOULD display past workouts with exercise breakdown, volume totals, and trend indicators. History rendering MUST work independently of the offline sync layer.

#### Scenario: Past session view

- GIVEN a user has completed workouts
- WHEN they open history
- THEN each session shows date, duration, exercises, total volume, and average RPE
- AND a trend indicator (e.g. volume or RPE trend vs. prior sessions) is shown

#### Scenario: History available without pending sync activity

- GIVEN the offline mutation queue is empty or the sync layer is unavailable
- WHEN a user opens history
- THEN previously synced session data still renders correctly with all required fields
