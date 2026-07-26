import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

/**
 * Styles for the mobile "Asistente de voz" screen (item-13 D1). Dark-only theme
 * from the shared design tokens; translates the OD `mobile-voice.html` layout to
 * a single-column RN stack: a top bar (back / title / status badge), a central
 * voice orb with a static waveform, the transcript, and pinned bottom controls
 * (keyboard fallback / push-to-talk mic / end session).
 *
 * Motion (follow-up #230) is driven imperatively by `orb-animation.ts` through
 * `Animated.Value`s; these styles carry only the static layout + rest pose (the
 * orb + waveform still change color/opacity by status), while the pulsing rings
 * and rippling waveform are layered on via animated transform/opacity.
 */
export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // --- top bar ---
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  iconBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  topBarTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.fg,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing[2],
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusBadgeActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  statusDotActive: {
    backgroundColor: colors.accent,
  },
  statusText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.muted,
  },
  statusTextActive: {
    color: colors.accent,
  },
  // --- orb ---
  orbArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[3],
    gap: spacing[4],
  },
  // Fixed-size stage that centers the pulsing rings behind the orb core, so the
  // rings can scale up (via Animated transform) without shifting the layout.
  orbContainer: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  // One concentric ring; opacity + scale are driven by the animation values.
  orbRing: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  orbCore: {
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  orbCoreActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 52,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    opacity: 0.25,
    // Scale the bars from the baseline so the waveform grows upward, matching
    // the OD `transform-origin: bottom center`.
    transformOrigin: "bottom",
  },
  waveBarActive: {
    opacity: 0.95,
  },
  // --- transcript ---
  transcript: {
    width: "100%",
    maxWidth: 350,
    gap: spacing[2],
  },
  transcriptLine: {
    gap: 4,
  },
  transcriptRole: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    color: colors.muted,
    textTransform: "uppercase",
  },
  transcriptRoleCoach: {
    color: colors.accent,
  },
  transcriptBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
  },
  transcriptBubbleUser: {
    backgroundColor: colors.surface2,
  },
  transcriptBubbleCoach: {
    borderColor: colors.accent,
  },
  transcriptText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.fg,
  },
  // --- notice (denied / offline / unclear / error) ---
  notice: {
    width: "100%",
    maxWidth: 350,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[2],
  },
  noticeText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
  },
  // --- inline text fallback composer ---
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
  },
  composerInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    minHeight: 44,
  },
  // --- bottom controls ---
  bottomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
  },
  sideBtn: {
    width: 52,
    height: 52,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  endBtn: {
    borderColor: colors.dangerBorder,
  },
  sideBtnText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
  endBtnText: {
    color: colors.danger,
  },
  micColumn: {
    alignItems: "center",
    gap: spacing[1],
  },
  micLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
    textTransform: "uppercase",
  },
  micLabelActive: {
    color: colors.accent,
  },
  micBtn: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtnActive: {
    borderWidth: 6,
    borderColor: colors.accentDim,
  },
  micBtnDisabled: {
    opacity: 0.4,
  },
  micBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    color: colors.accentFg,
  },
});
