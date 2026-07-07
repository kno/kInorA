# Delta for 07-v1-plan-wizard

## ADDED Requirements

### Requirement: Optional Plan Name Step

The wizard MUST include an optional name field for the plan. Submitting the field blank
MUST NOT block wizard completion. When blank, the system MUST apply an auto-generated
default name at persistence time.

#### Scenario: Name entered and preserved in PlanSpec output

- GIVEN a user enters "Fuerza Máxima" in the name field
- WHEN the wizard is completed
- THEN the persisted `PlanSpec` / plan record carries `name = "Fuerza Máxima"`

#### Scenario: Name skipped — auto-default applied at persistence

- GIVEN a user leaves the name field blank and completes the wizard
- WHEN the plan is persisted
- THEN `name` is a non-empty auto-generated string (not null, not empty)

#### Scenario: Name field does not block Finish

- GIVEN a user reaches the name field step and leaves it blank
- WHEN they click the advance/Finish action
- THEN the wizard advances without a validation error
