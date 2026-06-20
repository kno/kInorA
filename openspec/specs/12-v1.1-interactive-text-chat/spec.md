# 12-v1.1-interactive-text-chat Specification

## Purpose

Provide conversational plan definition via text chat, allowing users to describe goals, constraints, and preferences in natural language to co-create workout plans.

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

Conversation turns MUST be stored in both structured (message log) and vector (embeddings) memory for continuity across sessions.

#### Scenario: Resume previous conversation

- GIVEN a user returns after a week
- WHEN they open the chat
- THEN the system retrieves the last conversation context and offers to continue or start fresh
