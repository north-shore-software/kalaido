import { defineRoute } from "@/routes/route-kit";
import { useAppNavigate } from "@/routes/use-app-navigate";
import { TemplateSection } from "../components/template-section";
import type { Template } from "../templates";
import { templates } from "../templates";
import { selectTemplateTransitions } from "./SelectTemplate.transitions";

export default function SelectTemplate() {
  const { go } = useAppNavigate();

  function handleSelect(template: Template) {
    go(selectTemplateTransitions.setupKalaidoscope, {
      state: {
        template,
      },
    });
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "calc(100svh - var(--titlebar-height))" }}
    >
      <main className="relative flex-1 overflow-auto p-8 flex flex-col items-center">
        <div className="w-full max-w-3xl space-y-10">
          {templates.map((section) => (
            <TemplateSection
              key={section.title}
              title={section.title}
              templates={section.templates}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

export const selectTemplateRoute = defineRoute({
  id: "select-template",
  path: "/kalaidoscope/new",
  feature: "Create Kalaidoscope",
  requiredScope: [],
  transitions: selectTemplateTransitions,
  Component: SelectTemplate,
});
