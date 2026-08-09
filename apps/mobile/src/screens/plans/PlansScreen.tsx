/**
 * PlansScreen — the mobile plans list (17d PR C).
 *
 * The RN counterpart of the web `/plans` surface: every plan the user owns,
 * with the same progress projection (`GET /workout-plans?progress=1`), the
 * same "currently following" distinction, the same age-banded "last trained"
 * line, and the same archive/unarchive semantics. It consumes web's
 * projection rather than inventing a parallel one, and reuses the `plans.*`
 * copy web already authored (see `messages.ts`).
 *
 * Three states are kept strictly apart — loading, load-failed, loaded — and a
 * failed read NEVER degrades into an empty list with a create-your-first-plan
 * CTA. A user with a shelf full of plans and a flaky connection must not be
 * told they have none; that defect (#378/#396) was fixed on seven other
 * surfaces and is not being reintroduced here.
 *
 * Archive is a filing decision, not a delete: `workout_sessions.workoutPlanId`
 * cascades on delete, so removing a plan would erase every logged workout and
 * the statistics, PRs and streaks derived from them. Archiving hides the plan
 * and refuses NEW sessions on it; the history stays. The confirm step says so
 * in full, in the catalog's own words — that reassurance is the reason the
 * feature is an archive and not a delete, so it is never trimmed or dropped.
 *
 * One read, not two: the list is always fetched WITH archived rows and split
 * client-side. The show-archived control is therefore pure local state — it
 * costs no round trip, and it can state how many archived plans are waiting
 * behind it, which a filtered read could not.
 *
 * Architecture — thin glue over the tested `plan-status-client.ts`, mirroring
 * `ClientListScreen`/`PlanStatusScreen`: all network and result-mapping logic
 * lives in the injected client, a `mountedRef` guards every post-await
 * `setState`, and a `sessionExpired` result clears the token and returns to
 * Login exactly once.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import {
  archivePlan as defaultArchivePlan,
  fetchPlanList as defaultFetchPlanList,
  unarchivePlan as defaultUnarchivePlan,
  type ClientOptions,
  type FetchPlanListResult,
  type PlanArchiveResult,
  type PlanListItem,
  type PlanListOptions,
} from "../../api/plan-status-client";
import { deleteSessionToken } from "../../auth/session-storage";
import { messages as M } from "./messages";
import { styles } from "./PlansScreen.styles";

interface PlansClientApi {
  fetchPlanList: (options?: PlanListOptions) => Promise<FetchPlanListResult>;
  archivePlan: (planId: string, options?: ClientOptions) => Promise<PlanArchiveResult>;
  unarchivePlan: (planId: string, options?: ClientOptions) => Promise<PlanArchiveResult>;
}

export interface PlansScreenProps {
  navigation: NativeStackNavigationProp<any>;
  /** Plans client — defaults to the real `plan-status-client` module; injected in tests. */
  client?: Partial<PlansClientApi>;
  /** Clear the stored session on expiry — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
  /** Injectable "now" for deterministic age-banding in tests. */
  now?: Date;
}

type Phase = "loading" | "error" | "ready";

/** The same three-band scale the web list uses for the "last trained" line. */
const RECENT_DAYS = 7;
const AGING_DAYS = 30;

type AgeBand = "recent" | "aging" | "stale" | undefined;

function ageBand(lastTrainedAt: string | undefined, now: Date): AgeBand {
  if (!lastTrainedAt) return undefined;
  const ageDays = (now.getTime() - new Date(lastTrainedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= RECENT_DAYS) return "recent";
  if (ageDays <= AGING_DAYS) return "aging";
  return "stale";
}

function ageStyle(band: AgeBand) {
  switch (band) {
    case "recent":
      return styles.lastTrainedRecent;
    case "aging":
      return styles.lastTrainedAging;
    case "stale":
      return styles.lastTrainedStale;
    default:
      return undefined;
  }
}

const isArchived = (plan: PlanListItem): boolean => Boolean(plan.archivedAt);

export default function PlansScreen({
  navigation,
  client,
  clearSession,
  apiBaseUrl,
  getToken,
  now,
}: PlansScreenProps) {
  const intl = useIntl();
  const [phase, setPhase] = useState<Phase>("loading");
  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  /** The row whose archive confirm is currently armed, if any. */
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);

  const clientRef = useRef<PlansClientApi>({
    fetchPlanList: client?.fetchPlanList ?? defaultFetchPlanList,
    archivePlan: client?.archivePlan ?? defaultArchivePlan,
    unarchivePlan: client?.unarchivePlan ?? defaultUnarchivePlan,
  });
  clientRef.current = {
    fetchPlanList: client?.fetchPlanList ?? defaultFetchPlanList,
    archivePlan: client?.archivePlan ?? defaultArchivePlan,
    unarchivePlan: client?.unarchivePlan ?? defaultUnarchivePlan,
  };

  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  clearSessionRef.current = clearSession ?? deleteSessionToken;

  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A 401 (or a missing token) means there is no usable session: clear it and
  // return to Login exactly once, mirroring `PlanStatusScreen`.
  const loggedOutRef = useRef(false);
  const handleSessionExpired = useCallback(async () => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    await clearSessionRef.current();
    navigationRef.current.replace("Login");
  }, []);

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setPhase("loading");
    setActionFailed(false);

    // Always ask for archived rows too — they are split out client-side, so
    // toggling the archived section never costs a second request.
    const result = await clientRef.current.fetchPlanList({
      ...clientOptions,
      includeArchived: true,
    });
    if (!mountedRef.current) return;

    if (result.kind === "error") {
      if (result.sessionExpired) {
        await handleSessionExpired();
        return;
      }
      // A read we could not complete is an ERROR, never an empty list.
      setPhase("error");
      return;
    }

    setPlans(result.plans);
    setPhase("ready");
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Archive or unarchive one row. The list is updated in place from the
   * server's own response — no full reload, so the rest of the screen (and
   * the show-archived choice) survives the action.
   */
  const applyArchive = useCallback(
    async (planId: string, archived: boolean) => {
      if (busyPlanId) return;
      setConfirmingPlanId(null);
      setBusyPlanId(planId);
      setActionFailed(false);

      const call = archived
        ? clientRef.current.archivePlan
        : clientRef.current.unarchivePlan;
      const result = await call(planId, clientOptions);
      if (!mountedRef.current) return;

      if (result.kind === "error") {
        if (result.sessionExpired) {
          await handleSessionExpired();
          return;
        }
        // The row stays exactly as it was; the failure is stated, not swallowed.
        setActionFailed(true);
        setBusyPlanId(null);
        return;
      }

      // The row is re-filed, never dropped: an archived plan moves into the
      // archived section (hidden or not), an unarchived one moves back.
      setPlans((current) =>
        current.map((plan) =>
          plan.id === result.id ? { ...plan, archivedAt: result.archivedAt } : plan,
        ),
      );
      setBusyPlanId(null);
      // clientOptions is derived from stable props; intentionally omitted from deps.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [busyPlanId, handleSessionExpired],
  );

  const activePlans = plans.filter((plan) => !isArchived(plan));
  const archivedPlans = plans.filter(isArchived);
  // The plan being followed: the first ready ACTIVE plan in the newest-first
  // list — the same notion the web list derives client-side.
  const currentPlanId = activePlans.find((plan) => plan.status === "ready")?.id;

  const renderPlan = (plan: PlanListItem) => {
    const archived = isArchived(plan);
    const isCurrent = plan.id === currentPlanId;
    const band = ageBand(plan.lastTrainedAt, now ?? new Date());

    return (
      <View
        key={plan.id}
        testID={`plan-card-${plan.id}`}
        style={[styles.card, isCurrent && styles.currentCard]}
      >
        {isCurrent && (
          <Text testID={`plan-current-badge-${plan.id}`} style={styles.badge}>
            <FormattedMessage {...M.currentlyFollowing} />
          </Text>
        )}
        {archived && (
          <Text testID={`plan-archived-badge-${plan.id}`} style={styles.archivedBadge}>
            <FormattedMessage {...M.archivedBadge} />
          </Text>
        )}

        <Text style={styles.planName}>{plan.name}</Text>

        {plan.daysPerWeek !== undefined && (
          <Text style={styles.detail}>
            <FormattedMessage {...M.daysPerWeek} values={{ days: plan.daysPerWeek }} />
          </Text>
        )}
        <Text style={styles.detail}>
          <FormattedMessage
            {...M.completedSessions}
            values={{ count: plan.completedSessions ?? 0 }}
          />
        </Text>
        <Text testID={`plan-last-trained-${plan.id}`} style={[styles.detail, ageStyle(band)]}>
          {plan.lastTrainedAt ? (
            <FormattedMessage
              {...M.lastTrained}
              values={{
                date: intl.formatDate(new Date(plan.lastTrainedAt), {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }),
              }}
            />
          ) : (
            <FormattedMessage {...M.neverTrained} />
          )}
        </Text>

        <View style={styles.actionRow}>
          <Pressable
            testID={`plan-open-${plan.id}`}
            style={[styles.btn, plan.status !== "ready" && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage(M.open)}
            accessibilityState={{ disabled: plan.status !== "ready" }}
            disabled={plan.status !== "ready"}
            onPress={() => navigationRef.current.navigate("PlanStatus", { planId: plan.id })}
          >
            <Text style={styles.btnText}>
              <FormattedMessage {...M.open} />
            </Text>
          </Pressable>

          <Pressable
            testID={`plan-${archived ? "unarchive" : "archive"}-${plan.id}`}
            style={[styles.btnSecondary, busyPlanId === plan.id && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage(
              archived ? M.unarchiveAction : M.archiveAction,
            )}
            disabled={busyPlanId === plan.id}
            onPress={() =>
              // Unarchiving restores a plan and needs no warning; archiving
              // takes it out of circulation, so it asks first.
              archived ? applyArchive(plan.id, false) : setConfirmingPlanId(plan.id)
            }
          >
            <Text style={styles.btnSecondaryText}>
              <FormattedMessage {...(archived ? M.unarchiveAction : M.archiveAction)} />
            </Text>
          </Pressable>
        </View>

        {confirmingPlanId === plan.id && (
          <View testID={`plan-archive-confirm-${plan.id}`} style={styles.confirm}>
            <Text style={styles.sectionHeading}>
              <FormattedMessage {...M.confirmTitle} />
            </Text>
            {/* The whole reassurance, verbatim: this is where the user learns
                that archiving deletes nothing. */}
            <Text style={styles.body}>
              <FormattedMessage {...M.confirmBody} />
            </Text>
            <View style={styles.actionRow}>
              <Pressable
                testID={`plan-archive-confirm-yes-${plan.id}`}
                style={styles.btn}
                accessibilityRole="button"
                accessibilityLabel={intl.formatMessage(M.confirm)}
                onPress={() => applyArchive(plan.id, true)}
              >
                <Text style={styles.btnText}>
                  <FormattedMessage {...M.confirm} />
                </Text>
              </Pressable>
              <Pressable
                testID={`plan-archive-confirm-no-${plan.id}`}
                style={styles.btnSecondary}
                accessibilityRole="button"
                accessibilityLabel={intl.formatMessage(M.cancel)}
                onPress={() => setConfirmingPlanId(null)}
              >
                <Text style={styles.btnSecondaryText}>
                  <FormattedMessage {...M.cancel} />
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {plan.status !== "ready" && (
          <Text style={styles.detail}>
            <FormattedMessage
              {...(plan.status === "generating"
                ? M.openDisabledGenerating
                : M.openDisabledFailed)}
            />
          </Text>
        )}
      </View>
    );
  };

  if (phase === "loading") {
    return (
      <View style={styles.centered} testID="plans-loading">
        <ActivityIndicator color={styles.title.color} />
        <Text style={styles.body}>
          <FormattedMessage {...M.title} />
        </Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.centered} testID="plans-load-error">
        <Text style={styles.title}>
          <FormattedMessage {...M.title} />
        </Text>
        <Text style={styles.errorText} accessibilityRole="alert">
          <FormattedMessage {...M.loadError} />
        </Text>
        <Pressable
          testID="plans-retry"
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage(M.retry)}
          onPress={() => load()}
        >
          <Text style={styles.btnText}>
            <FormattedMessage {...M.retry} />
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="plans-ready">
      <Text style={styles.title}>
        <FormattedMessage {...M.title} />
      </Text>
      <Text style={styles.description}>
        <FormattedMessage {...M.description} />
      </Text>

      {actionFailed && (
        <Text testID="plans-action-error" style={styles.errorText} accessibilityRole="alert">
          <FormattedMessage {...M.actionError} />
        </Text>
      )}

      {plans.length === 0 ? (
        <View style={styles.card} testID="plans-empty">
          <Text style={styles.planName}>
            <FormattedMessage {...M.emptyTitle} />
          </Text>
          <Text style={styles.body}>
            <FormattedMessage {...M.emptyDesc} />
          </Text>
          <Pressable
            testID="plans-empty-cta"
            style={styles.btn}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage(M.emptyCta)}
            onPress={() => navigationRef.current.navigate("CreatePlanAssistant")}
          >
            <Text style={styles.btnText}>
              <FormattedMessage {...M.emptyCta} />
            </Text>
          </Pressable>
        </View>
      ) : (
        activePlans.map(renderPlan)
      )}

      {archivedPlans.length > 0 && (
        <Pressable
          testID="plans-show-archived"
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel={
            showArchived
              ? intl.formatMessage(M.hideToggle)
              : intl.formatMessage(M.showToggle, { count: archivedPlans.length })
          }
          accessibilityState={{ expanded: showArchived }}
          onPress={() => setShowArchived((current) => !current)}
        >
          <Text style={styles.btnSecondaryText}>
            {showArchived ? (
              <FormattedMessage {...M.hideToggle} />
            ) : (
              <FormattedMessage {...M.showToggle} values={{ count: archivedPlans.length }} />
            )}
          </Text>
        </Pressable>
      )}

      {showArchived && archivedPlans.length > 0 && (
        <View testID="plans-archived-section" style={styles.separator}>
          <Text style={styles.sectionHeading}>
            <FormattedMessage {...M.archivedHeading} />
          </Text>
          {archivedPlans.map(renderPlan)}
        </View>
      )}
    </ScrollView>
  );
}
