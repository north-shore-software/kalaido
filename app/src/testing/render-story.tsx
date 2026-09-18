import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * Render a Ladle story under the same providers `.ladle/components.tsx`
 * gives it in the workbench — theme and a memory router — so a story that
 * navigates or reads the theme renders in a test exactly as it does on screen.
 */
export function renderStory(story: ReactElement): RenderResult {
  return render(
    <ThemeProvider>
      <MemoryRouter>{story}</MemoryRouter>
    </ThemeProvider>,
  );
}
