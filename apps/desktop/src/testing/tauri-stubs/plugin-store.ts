export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

export const load = async (path: string): Promise<Store> => {
  console.log(`tauri stub: plugin-store.load for path "${path}"`);
  return {
    get: async () => null,
    set: async () => {},
    save: async () => {},
  };
};
