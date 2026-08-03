export type KalaidoscopeMeta = {
  id: string;
  type: "local_file" | "cloud" | "local_net";
  locator: string;
  displayName: string;
  icon?: string;
};
