/**
 * RestCard — the rest-timer card: heading + top skip shortcut, the countdown
 * RestRing, and the add-time / skip actions.
 *
 * Presentational: the container owns the rest countdown and the wall-clock
 * bookkeeping; this component composes `RestRing`, formats the countdown, and
 * reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { formatCountdown } from "./tracker-logic";
import { RestRing } from "./RestRing";
import { messages as M } from "./messages";
import { styles } from "./RestCard.styles";

interface RestCardProps {
  restRemaining: number;
  restDuration: number;
  /** Ring/time color — amber normally, lime in the final seconds. */
  restColor: string;
  onAddTime: () => void;
  onSkip: () => void;
}

export function RestCard({
  restRemaining,
  restDuration,
  restColor,
  onAddTime,
  onSkip,
}: RestCardProps) {
  const intl = useIntl();
  // Same skip label backs 3 spots in this card (top-right shortcut + the
  // bottom button's a11y label and its visible text) — one call.
  const skipRestLabel = intl.formatMessage(M.skipRest);

  return (
    <View
      style={styles.restCard}
      accessibilityLabel={intl.formatMessage(M.restA11y)}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.restHeaderRow}>
        <View style={styles.restHeading}>
          <View style={styles.restHeadingDot} />
          <Text style={styles.restHeadingText}>
            <FormattedMessage {...M.restActive} />
          </Text>
        </View>
        <Pressable
          style={styles.restSkipBtnTop}
          onPress={onSkip}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={skipRestLabel}
        >
          <Text style={styles.restSkipBtnTopText}>
            <FormattedMessage {...M.skip} />
          </Text>
        </Pressable>
      </View>

      <View style={styles.ringWrap}>
        <RestRing remaining={restRemaining} duration={restDuration} strokeColor={restColor} />
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={[styles.ringTime, { color: restColor }]}>
            {formatCountdown(restRemaining)}
          </Text>
          <Text style={styles.ringLabelSm}>
            <FormattedMessage {...M.restLabelSm} />
          </Text>
        </View>
      </View>

      <View style={styles.restActions}>
        <Pressable
          style={({ pressed }) => [styles.btnAddTime, pressed && styles.btnAddTimePressed]}
          onPress={onAddTime}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage(M.addTimeA11y)}
        >
          <Text style={styles.btnAddTimeText}>
            <FormattedMessage {...M.addTime} />
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btnSkip, pressed && styles.btnSkipPressed]}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={skipRestLabel}
        >
          <Text style={styles.btnSkipText}>{skipRestLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
