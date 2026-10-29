import * as tauriCore from "@tauri-apps/api/core";
import * as clipboardManager from "@tauri-apps/plugin-clipboard-manager";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessages } from "@/components/kalaido/chat-messages";
import { renderStory } from "@/testing/render-story";
import { ChatMessageActions } from "./chat-message-actions";
import {
  Bookmarked,
  Default,
  Pending,
  SavedAsFragment,
} from "./chat-message-actions.stories";

describe("ChatMessageActions", () => {
  test("offers to bookmark", () => {
    renderStory(<Default />);
    expect(screen.getByText("Bookmark")).toBeEnabled();
  });

  test("offers to copy", () => {
    renderStory(<Default />);
    expect(screen.getByText("Copy")).toBeEnabled();
  });

  test("shows the bookmarked state", () => {
    renderStory(<Bookmarked />);
    expect(screen.getByText("Bookmarked")).toBeInTheDocument();
  });

  test("shows the saved pill once a fragment exists", () => {
    renderStory(<SavedAsFragment />);
    expect(screen.getByText("saved as fragment")).toBeInTheDocument();
  });

  test("is disabled while the reply is pending", () => {
    renderStory(<Pending />);
    expect(screen.getByText("Bookmark")).toBeDisabled();
  });

  test("copies rendered HTML and plain text without internal IDs", async () => {
    const isTauriSpy = vi.spyOn(tauriCore, "isTauri").mockReturnValue(true);
    const writeHtmlSpy = vi
      .spyOn(clipboardManager, "writeHtml")
      .mockResolvedValue(undefined);

    render(
      <ChatMessages
        messages={[
          {
            id: "msg-1",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "## Summary of @[Fragment:abc123def456ghi|standup notes]",
              },
            ],
          },
        ]}
        messageActions={() => (
          <ChatMessageActions
            bookmarked={false}
            pending={false}
            onToggle={() => {}}
          />
        )}
      />,
    );

    await userEvent.click(screen.getByText("Copy"));

    expect(writeHtmlSpy).toHaveBeenCalledTimes(1);
    const [html, altText] = writeHtmlSpy.mock.calls[0];
    expect(html).toContain("<h2");
    expect(html).toContain("@standup notes");
    expect(html).not.toContain("abc123def456ghi");
    expect(altText).toBe("Summary of @standup notes");
    expect(altText).not.toContain("abc123def456ghi");
    expect(screen.getByText("Copied")).toBeInTheDocument();

    writeHtmlSpy.mockRestore();
    isTauriSpy.mockRestore();
  });
});
