/**
 * ClientListScreen — mobile trainer client-list surface
 * (15a-v2-trainer-account-access, Slice 5).
 *
 * The RN equivalent of the web `/clients` page: lists assigned clients
 * (`GET /trainer/clients`), an invite-by-email form
 * (`POST /trainer/clients/invite`), and a per-client "create plan" entry that
 * navigates to `ClientCreatePlanScreen`. A `403` on the initial fetch is the
 * ONLY signal available that the caller isn't an entitled trainer (mirrors
 * the web `/clients` page's gating note) and renders an access-restricted
 * state instead of the list.
 *
 * Architecture — thin glue over the tested `trainer-client.ts`, mirroring
 * `PlanStatusScreen`'s shape (injectable client, mount-guarded setState).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { FormattedMessage, useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ClientSummaryDTO } from "@kinora/contracts";

import {
  fetchClients as defaultFetchClients,
  inviteClient as defaultInviteClient,
  type ClientOptions,
  type FetchClientsResult,
  type InviteClientResult,
} from "../../api/trainer-client";
import { messages as M } from "./messages";
import { styles } from "./ClientListScreen.styles";

interface ClientListClientApi {
  fetchClients: (options?: ClientOptions) => Promise<FetchClientsResult>;
  inviteClient: (email: string, options?: ClientOptions) => Promise<InviteClientResult>;
}

export interface ClientListScreenProps {
  navigation: NativeStackNavigationProp<any>;
  client?: Partial<ClientListClientApi>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

type Phase = "loading" | "forbidden" | "error" | "ready";

export default function ClientListScreen({
  navigation,
  client,
  apiBaseUrl,
  getToken,
}: ClientListScreenProps) {
  const intl = useIntl();
  const [phase, setPhase] = useState<Phase>("loading");
  const [clients, setClients] = useState<ClientSummaryDTO[]>([]);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const clientRef = useRef<ClientListClientApi>({
    fetchClients: client?.fetchClients ?? defaultFetchClients,
    inviteClient: client?.inviteClient ?? defaultInviteClient,
  });
  clientRef.current = {
    fetchClients: client?.fetchClients ?? defaultFetchClients,
    inviteClient: client?.inviteClient ?? defaultInviteClient,
  };

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setPhase("loading");
    const result = await clientRef.current.fetchClients(clientOptions);
    if (!mountedRef.current) return;

    if (result.kind === "forbidden") {
      setPhase("forbidden");
      return;
    }
    if (result.kind === "error") {
      setPhase("error");
      return;
    }
    setClients(result.clients);
    setPhase("ready");
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await clientRef.current.inviteClient(trimmed, clientOptions);
      if (!mountedRef.current) return;
      if (result.kind === "ok") {
        setStatusIsError(false);
        setStatusMessage(intl.formatMessage(M.inviteSuccess));
        setEmail("");
      } else {
        setStatusIsError(true);
        const key =
          result.message === "client_already_assigned"
            ? M.inviteErrorAlreadyAssigned
            : result.message === "client_not_found"
              ? M.inviteErrorNotFound
              : M.inviteErrorGeneric;
        setStatusMessage(intl.formatMessage(key));
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
    // clientOptions derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, submitting, intl]);

  if (phase === "loading") {
    return (
      <View style={styles.centered} testID="clients-loading">
        <ActivityIndicator color={styles.title.color} />
        <Text style={styles.body}>
          <FormattedMessage {...M.loadingLabel} />
        </Text>
      </View>
    );
  }

  if (phase === "forbidden") {
    return (
      <View style={styles.centered} testID="clients-forbidden">
        <Text style={styles.title}>
          <FormattedMessage {...M.accessRestrictedTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...M.accessRestrictedBody} />
        </Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.centered} testID="clients-error">
        <Text style={styles.errorText} accessibilityRole="alert">
          <FormattedMessage {...M.loadError} />
        </Text>
        <Pressable testID="retry-btn" style={styles.btn} accessibilityRole="button" onPress={load}>
          <Text style={styles.btnText}>
            <FormattedMessage {...M.retryLabel} />
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="clients-ready">
      <Text style={styles.title}>
        <FormattedMessage {...M.pageTitle} />
      </Text>

      <View style={styles.card}>
        <Text style={styles.subtitle}>
          <FormattedMessage {...M.inviteTitle} />
        </Text>
        <TextInput
          testID="invite-email-input"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={intl.formatMessage(M.inviteEmailLabel)}
          accessibilityLabel={intl.formatMessage(M.inviteEmailLabel)}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!submitting}
        />
        <Pressable
          testID="invite-submit-btn"
          style={[styles.btn, submitting && styles.btnDisabled]}
          accessibilityRole="button"
          disabled={submitting || !email.trim()}
          onPress={handleInvite}
        >
          {submitting ? (
            <ActivityIndicator color={styles.btnText.color} />
          ) : (
            <Text style={styles.btnText}>
              <FormattedMessage {...M.inviteSubmit} />
            </Text>
          )}
        </Pressable>
        {statusMessage && (
          <Text
            testID="invite-status"
            style={statusIsError ? styles.errorText : styles.body}
            accessibilityRole={statusIsError ? "alert" : "text"}
          >
            {statusMessage}
          </Text>
        )}
      </View>

      {clients.length === 0 ? (
        <Text style={styles.body} testID="clients-empty">
          <FormattedMessage {...M.emptyState} />
        </Text>
      ) : (
        clients.map((c) => (
          <View key={c.clientUserId} style={styles.clientRow} testID="client-row">
            <View>
              <Text style={styles.clientEmail}>{c.email}</Text>
              <Text style={styles.clientStatus}>
                <FormattedMessage
                  {...(c.status === "active"
                    ? M.statusActive
                    : c.status === "invited"
                      ? M.statusInvited
                      : M.statusRevoked)}
                />
              </Text>
            </View>
            <Pressable
              testID="create-plan-btn"
              style={styles.btnSecondary}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate("ClientCreatePlan", { clientUserId: c.clientUserId })
              }
            >
              <Text style={styles.btnSecondaryText}>
                <FormattedMessage {...M.createPlanCta} />
              </Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
