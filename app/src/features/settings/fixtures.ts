import type { LocalAiModelVM } from "./components/model-radio-list";

export const FIXTURE_MODELS_LIST: LocalAiModelVM[] = [
  { name: "gemma3:latest", size: 2150000000 },
  { name: "llama3:latest", size: 4700000000 },
  { name: "mistral:7b", size: 4100000000 },
];

export const FIXTURE_MODELS_EMPTY: LocalAiModelVM[] = [];
