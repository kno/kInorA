/**
 * NextExercisePreview — the dimmed "A continuación" row previewing the next
 * exercise (thumbnail glyph, eyebrow, name, and a detail line).
 *
 * Presentational: the container supplies the pre-resolved `detail` string
 * (which depends on domain logic); this component reads the eyebrow copy.
 */

import React from "react";
import { Text, View } from "react-native";
import { useIntl } from "react-intl";

import { ChevronIcon, PersonIcon } from "./icons";
import { messages as M } from "./messages";
import { styles } from "./NextExercisePreview.styles";

interface NextExercisePreviewProps {
  title: string;
  /** Pre-resolved detail line ("3 sets · 30 kg × 10", or reps-only). */
  detail: string;
}

export function NextExercisePreview({ title, detail }: NextExercisePreviewProps) {
  const intl = useIntl();
  // Used both as the card's a11y label and its visible eyebrow text.
  const nextEyebrow = intl.formatMessage(M.nextEyebrow);

  return (
    <View style={styles.nextPreview} accessibilityLabel={nextEyebrow}>
      <View style={styles.nextThumb}>
        <PersonIcon />
      </View>
      <View style={styles.nextInfo}>
        <Text style={styles.nextEyebrow}>{nextEyebrow}</Text>
        <Text style={styles.nextName} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.nextDetail}>{detail}</Text>
      </View>
      <ChevronIcon />
    </View>
  );
}
