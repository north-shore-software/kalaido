import { describe, expect, test, vi } from "vitest";
import { createKalaidoChatTransport, listConversations } from "./chat";
import type { TypedPocketBase } from "./types";

function makeMockClient(records: Record<string, unknown>[]) {
  const getFullList = vi.fn().mockResolvedValue(records);
  const collection = vi.fn(() => ({ getFullList }));
  return {
    client: { collection } as unknown as TypedPocketBase,
    collection,
    getFullList,
  };
}

describe("listConversations", () => {
  test("queries view_chat_conversation, strips mentions, and falls back to New conversation", async () => {
    const { client, collection, getFullList } = makeMockClient([
      {
        id: "c1",
        external_conversation_id: "ext-1",
        created: "2026-11-01 10:00:00.000Z",
        preview: "Summarize @[Fragment:f1|Meeting Notes]",
      },
      {
        id: "c2",
        external_conversation_id: "ext-2",
        created: "2026-11-01 09:00:00.000Z",
        preview: "  Good morning!  ",
      },
      {
        id: "c3",
        external_conversation_id: "ext-3",
        created: "2026-11-01 08:00:00.000Z",
        preview: "",
      },
      {
        id: "c4",
        external_conversation_id: "",
        created: "2026-11-01 07:00:00.000Z",
        preview: "   ",
      },
    ]);

    const result = await listConversations(client);

    expect(collection).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith("view_chat_conversation");
    expect(getFullList).toHaveBeenCalledWith({
      sort: "-created",
      requestKey: null,
    });
    expect(result).toEqual([
      {
        id: "c1",
        clientId: "ext-1",
        preview: "Summarize @Meeting Notes",
        createdAt: "2026-11-01 10:00:00.000Z",
      },
      {
        id: "c2",
        clientId: "ext-2",
        preview: "Good morning!",
        createdAt: "2026-11-01 09:00:00.000Z",
      },
      {
        id: "c3",
        clientId: "ext-3",
        preview: "New conversation",
        createdAt: "2026-11-01 08:00:00.000Z",
      },
      {
        id: "c4",
        clientId: "",
        preview: "New conversation",
        createdAt: "2026-11-01 07:00:00.000Z",
      },
    ]);
  });
});

describe("createKalaidoChatTransport", () => {
  test("throws when api path is blank", () => {
    expect(() =>
      createKalaidoChatTransport({ baseURL: "http://127.0.0.1:8090", api: "" }),
    ).toThrow(/non-empty api path/);
    expect(() =>
      createKalaidoChatTransport({
        baseURL: "http://127.0.0.1:8090",
        api: "   ",
      }),
    ).toThrow(/non-empty api path/);
  });

  test("creates a transport when given an explicit api path", () => {
    const transport = createKalaidoChatTransport({
      baseURL: "http://127.0.0.1:8090",
      api: "/api/explore",
    });
    expect(transport).toBeDefined();
  });
});
