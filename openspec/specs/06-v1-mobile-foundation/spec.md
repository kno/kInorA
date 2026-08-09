# 06-v1-mobile-foundation Specification

## Purpose

Ensure mobile readiness from v1 via a PWA/mobile-first responsive baseline and a Capacitor shell that can be deployed to iOS and Android app stores.

## Requirements

### Requirement: PWA Baseline

The web app MUST be a Progressive Web App: installable via manifest, service-worker-cached for offline capability, and responsive down to 320px viewport width.

#### Scenario: PWA install prompt

- GIVEN a user visits the web app on a mobile browser
- WHEN the page loads
- THEN the browser's install prompt or a custom "Add to Home Screen" UI appears

#### Scenario: Offline fallback page

- GIVEN a user with no network opens the PWA
- WHEN the service worker cannot fetch the page
- THEN a cached fallback page is displayed instead of a blank error

### Requirement: Responsive UI

All user-facing views MUST render correctly on viewport widths from 320px to 1920px without horizontal scroll or overlapping elements.

#### Scenario: Mobile viewport renders correctly

- GIVEN a viewport of 375x812px (iPhone X)
- WHEN any page is rendered
- THEN no elements overflow the viewport, tap targets are ≥44px, and content is readable without zoom

### Requirement: Capacitor Shell

The project MUST include a Capacitor project shell that wraps the PWA build for native deployment.

#### Scenario: Capacitor builds for iOS

- GIVEN the PWA is built
- WHEN `npx cap sync ios` runs
- THEN an Xcode project is generated with the correct bundle identifier and app name

#### Scenario: Capacitor builds for Android

- GIVEN the PWA is built
- WHEN `npx cap sync android` runs
- THEN an Android Studio project is generated with the correct package name

### Requirement: Mobile Plans Navigation Entry

The mobile app MUST expose a nav entry to a plans-list screen, added to the existing single-stack navigator. This is the first plans-list concept on mobile — previously the app resolved exactly one "current plan" from the dashboard summary with no list surface.

#### Scenario: Plans entry reachable from navigation

- GIVEN the mobile app's navigation
- WHEN a user looks for a way to see all their plans
- THEN a Plans nav entry exists and opens the plans-list screen

#### Scenario: Existing single-plan dashboard entry is unaffected

- GIVEN the existing "View your plan" entry into `PlanStatus`
- WHEN the Plans nav entry ships
- THEN the existing entry continues to resolve the current plan exactly as before
