# Delta for 12-v1.1-interactive-text-chat

## MODIFIED Requirements

### Requirement: Chat History in Memory

Conversation turns MUST NOT be embedded as raw vector memory by default. Future chat MAY request user-confirmed durable facts from `10b-v1-user-memory-vector`, but broad chat memory remains deferred until a later SDD change specifies consent, controls, retrieval behavior, and tests.
(Previously: Conversation turns had to be stored in both structured message logs and vector memory for continuity.)

#### Scenario: Resume previous conversation
- GIVEN a user returns after a week
- WHEN they open chat
- THEN chat MAY use approved structured history or confirmed durable facts only within approved slice boundaries

#### Scenario: No raw transcript embedding
- GIVEN chat contains ordinary turns, secrets, full plans, or sensitive health details
- WHEN the session ends
- THEN those turns MUST NOT be embedded as vector memory by default

#### Scenario: 10b bounded retrieval is not broad chat
- GIVEN 10b injects approved memory into one bounded plan-related AI flow
- WHEN interactive chat is planned
- THEN that proof MUST NOT be treated as full chat memory integration

#### Scenario: Chat fallback remains safe
- GIVEN future chat requests vector memory and retrieval is empty, disabled, offline, or unavailable
- WHEN chat generates a response
- THEN it MUST continue safely without vector memory
