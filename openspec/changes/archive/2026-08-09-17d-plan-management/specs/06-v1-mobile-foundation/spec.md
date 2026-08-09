# Delta for 06-v1-mobile-foundation

## ADDED Requirements

### Requirement: Mobile Plans Navigation Entry

The mobile app MUST expose a nav entry to a plans-list screen, added to the existing single-stack
navigator. This is the first plans-list concept on mobile — previously the app resolved exactly one
"current plan" from the dashboard summary with no list surface.

#### Scenario: Plans entry reachable from navigation
- GIVEN the mobile app's navigation
- WHEN a user looks for a way to see all their plans
- THEN a Plans nav entry exists and opens the plans-list screen

#### Scenario: Existing single-plan dashboard entry is unaffected
- GIVEN the existing "View your plan" entry into `PlanStatus`
- WHEN the Plans nav entry ships
- THEN the existing entry continues to resolve the current plan exactly as before
