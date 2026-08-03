export const invoke = async (cmd: string, _args?: Record<string, unknown>) => {
  throw new Error(
    `tauri stub: invoke called outside Tauri for command "${cmd}"`,
  );
};
