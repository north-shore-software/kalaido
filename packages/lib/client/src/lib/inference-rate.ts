type InferenceRateListener = (tokensPerSecond: number) => void;

const listeners = new Set<InferenceRateListener>();

export function emitInferenceRate(tokensPerSecond: number): void {
  for (const listener of listeners) {
    listener(tokensPerSecond);
  }
}

export function subscribeInferenceRate(
  listener: InferenceRateListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
