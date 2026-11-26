import { err, ok } from "neverthrow";
import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createCloudClient } from "#kalaidoscope/client";

const mockGetCloudJwt = vi.fn();
vi.mock("#cloud/auth", () => ({
  getCloudJwt: () => mockGetCloudJwt(),
  getCloudRequestAuthHeaders: vi.fn(),
}));

vi.mock("#config", () => ({
  getCloudPbUrl: () => "https://s.kalaido.test",
}));

const mockSend = vi.fn();
vi.mock("pocketbase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pocketbase")>();
  class MockPocketBase {
    baseURL: string;
    beforeSend?: (url: string, options: Record<string, unknown>) => unknown;
    authStore = { token: "", save: vi.fn() };
    constructor(baseURL: string) {
      this.baseURL = baseURL;
    }
    send(path: string, options: Record<string, unknown>) {
      return mockSend(path, options);
    }
  }
  return {
    ...actual,
    default: MockPocketBase,
  };
});

describe("createCloudClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCloudJwt.mockResolvedValue(ok("jwt_token"));
  });

  test("awaits /api/health and resolves immediately when container is ready", async () => {
    mockSend.mockResolvedValueOnce({ code: 200, message: "API is healthy." });

    const client = await createCloudClient("ws-1", {
      maxAttempts: 3,
      retryDelayMs: 1,
    });

    expect(client.baseURL).toBe("https://s.kalaido.test/ws-1");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith("/api/health", {
      method: "GET",
      requestKey: null,
    });
  });

  test("retries transient errors on /api/health until container becomes ready", async () => {
    mockSend
      .mockRejectedValueOnce(new Error("Container starting"))
      .mockRejectedValueOnce(
        new ClientResponseError({
          status: 503,
          response: { message: "Service unavailable" },
        }),
      )
      .mockResolvedValueOnce({ code: 200, message: "API is healthy." });

    const client = await createCloudClient("ws-1", {
      maxAttempts: 4,
      retryDelayMs: 1,
    });

    expect(client.baseURL).toBe("https://s.kalaido.test/ws-1");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test("stops retrying and throws after reaching maxAttempts", async () => {
    mockSend.mockRejectedValue(new Error("Container unavailable"));

    await expect(
      createCloudClient("ws-1", {
        maxAttempts: 3,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("Container unavailable");

    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test("does not retry fatal 4xx errors", async () => {
    mockSend.mockRejectedValue(
      new ClientResponseError({
        status: 403,
        response: { message: "forbidden" },
      }),
    );

    await expect(
      createCloudClient("ws-1", {
        maxAttempts: 3,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("forbidden");

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("throws if user is not signed in to cloud account", async () => {
    mockGetCloudJwt.mockResolvedValueOnce(err(new Error("Not signed in")));

    await expect(
      createCloudClient("ws-1", { maxAttempts: 2, retryDelayMs: 1 }),
    ).rejects.toThrow(
      "Sign in to your cloud account to open this kalaidoscope.",
    );
    expect(mockSend).not.toHaveBeenCalled();
  });
});
