# 11b-v1-billing-stripe-integration Specification

## Purpose

Integrate Stripe in test mode for checkout, subscription lifecycle updates, and coupon handling.

## Dependencies

- `11a-v1-billing-plans-tiers`

## Requirements

### Requirement: Stripe Test Checkout

The system MUST create Stripe checkout sessions in test mode for Pro upgrades.

#### Scenario: Pro upgrade

- GIVEN a free-tier user clicks upgrade
- WHEN they complete Stripe checkout in test mode
- THEN their account tier changes to Pro

### Requirement: Webhook Subscription Updates

Stripe webhook events MUST update subscription state idempotently.

#### Scenario: Duplicate webhook ignored safely

- GIVEN Stripe sends the same subscription event twice
- WHEN both events are processed
- THEN the billing state is updated once without duplicate side effects

### Requirement: Coupon Support

The system MUST support applying coupon codes during checkout.

#### Scenario: Invalid coupon rejected

- GIVEN a user enters an expired or invalid coupon
- WHEN Stripe validates checkout
- THEN the coupon is rejected and the user sees an invalid-code error
