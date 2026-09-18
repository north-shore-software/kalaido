import { renderStory } from "@/testing/render-story";
import { Disabled, Gemini, GeminiHighlighted } from "./provider-fields.stories";

describe("ProviderFields", () => {
  test.each([
    ["Gemini", Gemini],
    ["GeminiHighlighted", GeminiHighlighted],
    ["Disabled", Disabled],
  ])("%s renders", (_name, Variant) => {
    const { container } = renderStory(<Variant />);
    expect(container.querySelector("input")).not.toBeNull();
  });
});
