export type OpenPhysicsBridge = {
  onPaneReady?: (payload: string) => void;
  onPayloadRendered?: (payload: string) => void;
  onPaneError?: (payload: string) => void;
  onHeightChanged?: (payload: string) => void;
  onOptionSelected?: (payload: string) => void;
  onOpenTutor?: (payload: string) => void;
  onOpenImage?: (payload: string) => void;
  onOpenLessonVideo?: (payload: string) => void;
  onOpenReview?: (payload: string) => void;
  onCorrectGrading?: (payload: string) => void;
  onOpenMistake?: (payload: string) => void;
  onToggleMistakeSelection?: (payload: string) => void;
};

export type OpenPhysicsPaneApi = {
  setPayload: (payload: string | Record<string, unknown>) => void;
  setTheme: (payload: string | Record<string, unknown>) => void;
  setFontScale: (payload: string | number) => void;
  setAnswerState: (payload: string | Record<string, unknown> | null) => void;
  showAnalysis: (payload: string | Record<string, unknown> | null) => void;
};

export type OpenPhysicsQuestionPaneApi = {
  setQuestion: (payload: string | Record<string, unknown>) => void;
  setTheme: (payload: string | Record<string, unknown>) => void;
  setFontScale: (payload: string | number) => void;
  setAnswerState: (payload: string | Record<string, unknown> | null) => void;
  showAnalysis: (payload: string | Record<string, unknown> | null) => void;
};

declare global {
  interface Window {
    OpenPhysicsBridge?: OpenPhysicsBridge;
    OpenPhysicsAndroidQuestionPane?: OpenPhysicsBridge;
    OpenPhysicsPane?: OpenPhysicsPaneApi;
    OpenPhysicsQuestionPane?: OpenPhysicsQuestionPaneApi;
  }
}

export function postBridgeEvent(method: keyof OpenPhysicsBridge, payload: Record<string, unknown>) {
  const message = JSON.stringify(payload);
  const bridge = window.OpenPhysicsBridge || window.OpenPhysicsAndroidQuestionPane;
  bridge?.[method]?.(message);
}

export function parseBridgePayload<T>(payload: string | T): T {
  if (typeof payload === 'string') return JSON.parse(payload) as T;
  return payload;
}
