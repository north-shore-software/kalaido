export interface PostHogClientInput {
  apiKey: string;
  host: string;
  feedbackSurveyId?: string;
  feedbackQuestionId?: string;
  debug?: boolean;
}

export interface ClientConfig {
  authUrl: string;
  cloudPbUrl: string;
  posthog?: PostHogClientInput;
}

export interface ResolvedPostHogConfig {
  apiKey: string;
  options: {
    api_host: string;
    defaults: "2026-01-30";
    capture_exceptions: false;
    autocapture: false;
    capture_pageview: false;
    capture_pageleave: false;
    disable_surveys: true;
    disable_session_recording: true;
    mask_all_text: true;
    mask_all_element_attributes: true;
    debug: boolean;
  };
  feedbackSurveyId?: string;
  feedbackQuestionId?: string;
}

let activeConfig: ClientConfig | null = null;
const configListeners = new Set<() => void>();

export function onClientConfigChange(listener: () => void): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

export function configureClient(config: ClientConfig): void {
  activeConfig = {
    authUrl: config.authUrl.replace(/\/+$/, ""),
    cloudPbUrl: config.cloudPbUrl.replace(/\/+$/, ""),
    posthog: config.posthog,
  };
  for (const listener of configListeners) {
    listener();
  }
}

export function getAuthUrl(): string {
  if (!activeConfig?.authUrl) {
    throw new Error(
      "Client not configured — call configureClient() with authUrl first",
    );
  }
  return activeConfig.authUrl;
}

export function getCloudPbUrl(): string {
  if (!activeConfig?.cloudPbUrl) {
    throw new Error(
      "Client not configured — call configureClient() with cloudPbUrl first",
    );
  }
  return activeConfig.cloudPbUrl;
}

export function getPosthogConfig(): ResolvedPostHogConfig | null {
  const ph = activeConfig?.posthog;
  if (!ph?.apiKey || !ph?.host) return null;
  return {
    apiKey: ph.apiKey,
    options: {
      api_host: ph.host,
      defaults: "2026-01-30",
      capture_exceptions: false,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_surveys: true,
      disable_session_recording: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      debug: ph.debug ?? false,
    },
    feedbackSurveyId: ph.feedbackSurveyId,
    feedbackQuestionId: ph.feedbackQuestionId,
  };
}
