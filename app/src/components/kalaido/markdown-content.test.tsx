import { render } from "@testing-library/react";
import { MarkdownContent } from "./markdown-content";
import { Chat, DocumentKitchenSink } from "./markdown-content.stories";

describe("MarkdownContent", () => {
  test("renders inline LaTeX math markup in document and chat stories", () => {
    const doc = render(<DocumentKitchenSink />);
    expect(
      doc.container.querySelectorAll(".katex").length,
    ).toBeGreaterThanOrEqual(2);
    expect(doc.container.textContent).toContain("→");
    expect(doc.container.textContent).not.toContain("$\\to$");
    expect(doc.container.textContent).not.toContain("$\\rightarrow$");
    doc.unmount();

    const chat = render(<Chat />);
    expect(
      chat.container.querySelectorAll(".katex").length,
    ).toBeGreaterThanOrEqual(2);
    expect(chat.container.textContent).toContain("→");
    chat.unmount();
  });

  test("renders inline LaTeX arrow sequences while streaming in chat", () => {
    const { container } = render(
      <MarkdownContent
        variant="chat"
        streaming
        content="「確認習慣 $\rightarrow$ 聊脫節情況 $\rightarrow$ 追問具體影響」"
      />,
    );
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-html")?.textContent).toBe("→");
    expect(container.textContent).not.toContain("$\\rightarrow$");
  });
});
