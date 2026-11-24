export type UnlistenFn = () => void;

export const listen = async (
  event: string,
  _handler: (event: { payload: unknown }) => void,
): Promise<UnlistenFn> => {
  console.log(`tauri stub: listen registered for event "${event}"`);
  return () => {
    console.log(`tauri stub: unlisten called for event "${event}"`);
  };
};
