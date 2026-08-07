## ADDED Requirements

### Requirement: Generation Prompt Carries Body Metrics When Present

The prompt-building step for both the wizard-triggered generation flow and the chat create-plan
extraction flow MUST render the user's present `sexOrGender`, `heightCm`, and current resolved
bodyweight into the generation prompt as text. When any of these values is absent (null, or
`prefer_not_to_say` for `sexOrGender`, or no weight entries), the rendered prompt MUST be
byte-identical to the prompt that would have rendered before this capability existed for the
corresponding absent field — no invented default MUST ever be substituted. Every present body value
MUST be redacted from the string handed to `invoke()` as trace input by the redaction capability
defined in `profile-body-metrics`, before either flow calls the model.

#### Scenario: Present body metrics are rendered into the prompt

- GIVEN a user with `sexOrGender`, `heightCm`, and at least one weight entry present
- WHEN a plan is generated through the wizard-triggered flow
- THEN the rendered prompt text includes content derived from those values

#### Scenario: Absent body metrics leave the prompt unchanged

- GIVEN a user with `sexOrGender = null`, `heightCm = null`, and zero weight entries
- WHEN a plan is generated through either the wizard-triggered flow or the chat create-plan
  extraction flow
- THEN the rendered prompt is byte-identical to the prompt rendered before this capability existed

#### Scenario: Chat create-plan extraction flow renders the same way

- GIVEN a user with body metrics present
- WHEN a plan is generated through the chat create-plan extraction flow
- THEN the rendered prompt includes body-metric-derived content following the same rules as the
  wizard-triggered flow
