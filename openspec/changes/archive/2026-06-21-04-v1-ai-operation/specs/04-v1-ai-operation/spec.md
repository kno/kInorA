# 04-v1-ai-operation Specification

## Purpose

Establish AI operation standards: `AGENTS.md`, project skills, SDD/TDD guardrails, and behavioral conventions that constrain how AI agents interact with the codebase.

## Requirements

### Requirement: AGENTS.md

The project MUST include an `AGENTS.md` at the root that defines AI behavior rules, persona, skill usage protocol, and the SDD workflow lifecycle.

#### Scenario: AI loads AGENTS.md on first interaction

- GIVEN an AI agent starts a session in the project
- WHEN the agent reads `AGENTS.md`
- THEN it MUST follow the rules, persona, and protocol defined in the file

#### Scenario: SDD workflow referenced

- GIVEN `AGENTS.md` references the SDD pipeline
- WHEN an AI is asked to implement a feature
- THEN it MUST follow the specified phase order (propose → spec → design → tasks → apply → verify → archive)

### Requirement: Project Skills

The project SHOULD maintain a skill registry under `.opencode/skills/` or equivalent, covering domain-specific patterns (testing, architecture, security).

#### Scenario: Skill loaded for task context

- GIVEN a task involving security review
- WHEN the AI searches the skill registry
- THEN a matching security skill MUST be loadable and applied

### Requirement: AI Workflow Guardrails

AI MUST NOT commit code without test coverage, skip SDD phases, or apply changes that violate Clean Architecture layering.

#### Scenario: Uncovered code rejected

- GIVEN an AI generates a new module
- WHEN committing
- THEN the corresponding test file MUST exist and pass
