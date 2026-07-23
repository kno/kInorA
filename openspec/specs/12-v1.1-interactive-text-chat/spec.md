# 12-v1.1-interactive-text-chat Specification

## Purpose

Provide conversational create-plan screens via text chat, allowing users to describe goals, constraints, and preferences in natural language to co-create workout plans.

This spec maps to the conversational assistant and extracted-data panel from Open Design. It is v1.1 scope and does not replace the v1 card-mode create-plan flow.

## Requirements

### Requirement: Conversational Plan Definition

The system MUST accept natural language text input describing fitness goals and constraints, and produce a structured `PlanSpec` that feeds into plan generation.

#### Scenario: Full conversation produces PlanSpec

- GIVEN a user types "I want to build muscle 4 days a week with just dumbbells"
- WHEN the chat processes the message
- THEN the system extracts goal="hypertrophy", frequency=4, equipment="dumbbells" and presents a summary for confirmation

#### Scenario: Ambiguous input clarification

- GIVEN a user types "I want to get fit"
- WHEN the chat parses the input
- THEN the system asks clarifying follow-ups: "How many days per week? What equipment do you have available?"

### Requirement: PlanSpec Edit Before Generation

Before generating a plan, the system MUST present the extracted `PlanSpec` for user review and allow edits.

#### Scenario: Spec confirmation and edit

- GIVEN the extracted PlanSpec is displayed
- WHEN the user modifies frequency from 4 to 3
- THEN the updated PlanSpec is persisted and used for plan generation

### Requirement: Chat History in Memory

Conversation turns MUST NOT be embedded as raw vector memory by default. Future chat MAY request user-confirmed durable facts from `10b-v1-user-memory-vector`, but broad chat memory remains deferred until a later SDD change specifies consent, controls, retrieval behavior, and tests.

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
