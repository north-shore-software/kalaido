import { err, ok } from "neverthrow";
import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CloudAuthRequiredError,
  createCloudClient,
} from "#kalaidoscope/client";

const mockGetCloudJwt = vi.fn();
const mockDropCloudSession = vi.fn();
vi.mock("#cloud/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#cloud/auth")>();
  return {
    ...actual,
    getCloudJwt: () => mockGetCloudJwt(),
    dropCloudSession: () => mockDropCloudSession(),
    getCloudRequestAuthHeaders: vi.fn(),
  };
});

vi.mock("#config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#config")>();
  return {
    ...actual,
    getCloudPbUrl: () => "https://s.kalaido.test",
  };
});

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
      timeoutMs: 100,
      retryDelayMs: 5,
    });

    expect(client.baseURL).toBe("https://s.kalaido.test/ws-1");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        method: "GET",
        requestKey: null,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("retries transient /token and /api/health errors until container becomes ready", async () => {
    mockGetCloudJwt
      .mockResolvedValueOnce(err(new Error("Temporary auth network blip")))
      .mockResolvedValue(ok("jwt_token"));
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
      timeoutMs: 500,
      retryDelayMs: 5,
    });

    expect(client.baseURL).toBe("https://s.kalaido.test/ws-1");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test("throws a descriptive timeout error including container id when deadline expires", async () => {
    mockSend.mockRejectedValue(
      new ClientResponseError({
        status: 503,
        response: {},
      }),
    );

    await expect(
      createCloudClient("ws-timeout", {
        timeoutMs: 20,
        retryDelayMs: 5,
      }),
    ).rejects.toThrow(
      "Timed out waiting for cloud container (ws-timeout) to start. (HTTP 503)",
    );

    expect(mockSend.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("does not retry fatal non-auth 4xx errors", async () => {
    mockSend.mockRejectedValue(
      new ClientResponseError({
        status: 403,
        response: { message: "forbidden" },
      }),
    );

    await expect(
      createCloudClient("ws-1", {
        timeoutMs: 500,
        retryDelayMs: 5,
      }),
    ).rejects.toThrow("forbidden");

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockDropCloudSession).not.toHaveBeenCalled();
  });

  test("drops session and throws CloudAuthRequiredError on 401 from /api/health", async () => {
    mockSend.mockRejectedValue(
      new ClientResponseError({
        status: 401,
        response: { message: "unauthorized" },
      }),
    );

    await expect(
      createCloudClient("ws-1", {
        timeoutMs: 500,
        retryDelayMs: 5,
      }),
    ).rejects.toBeInstanceOf(CloudAuthRequiredError);

    expect(mockDropCloudSession).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("throws CloudAuthRequiredError immediately if user is not signed in", async () => {
    mockGetCloudJwt.mockResolvedValueOnce(
      err(new CloudAuthRequiredError("Not signed in to a cloud account.")),
    );

    const promise = createCloudClient("ws-1", {
      timeoutMs: 500,
      retryDelayMs: 5,
    });
    await expect(promise).rejects.toBeInstanceOf(CloudAuthRequiredError);
    await expect(promise).rejects.toThrow(
      "Sign in to your cloud account to open this kalaidoscope.",
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("aborts immediately when signal is aborted", async () => {
    const controller = new AbortController();
    mockSend.mockImplementation(async () => {
      controller.abort(new Error("Switched away"));
      throw new Error("Container starting");
    });

    await expect(
      createCloudClient("ws-1", {
        timeoutMs: 5_000,
        retryDelayMs: 1_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Switched away");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
