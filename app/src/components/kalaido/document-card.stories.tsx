import type { Story } from "@ladle/react";
import { DocumentCard } from "./document-card.tsx";
import { ColourSwatch } from "./colour.tsx";
import { StatusPill } from "./status-pill.tsx";
import { DOCUMENT_FIXTURES } from "./fixtures.ts";

export default { title: "Kalaido / DocumentCard" };

export const Default: Story = () => {
  const doc = DOCUMENT_FIXTURES[0];
  return (
    <div className="max-w-sm p-4">
      <DocumentCard
        title={doc.title}
        lines={doc.lines}
        leading={<ColourSwatch c={doc.colours[0]} size={12} />}
        trailing={<StatusPill kind={doc.status}>{doc.statusText}</StatusPill>}
        footer={<span className="text-xs text-fg-3">{doc.subtitle}</span>}
        onClick={() => console.log("Card clicked")}
      />
    </div>
  );
};

export const DriftingState: Story = () => {
  const doc = DOCUMENT_FIXTURES[1];
  return (
    <div className="max-w-sm p-4">
      <DocumentCard
        title={doc.title}
        lines={doc.lines}
        leading={<ColourSwatch c={doc.colours[0]} size={12} />}
        trailing={<StatusPill kind={doc.status}>{doc.statusText}</StatusPill>}
        footer={<span className="text-xs text-fg-3">{doc.subtitle}</span>}
        onClick={() => console.log("Card clicked")}
      />
    </div>
  );
};

export const CriticalState: Story = () => {
  const doc = DOCUMENT_FIXTURES[2];
  return (
    <div className="max-w-sm p-4">
      <DocumentCard
        title={doc.title}
        lines={doc.lines}
        leading={
          <div className="flex gap-1">
            {doc.colours.map((c) => (
              <ColourSwatch key={c} c={c} size={10} />
            ))}
          </div>
        }
        trailing={<StatusPill kind={doc.status}>{doc.statusText}</StatusPill>}
        footer={<span className="text-xs text-fg-3">{doc.subtitle}</span>}
        onClick={() => console.log("Card clicked")}
      />
    </div>
  );
};

export const SimpleNoFooter: Story = () => {
  const doc = DOCUMENT_FIXTURES[3];
  return (
    <div className="max-w-sm p-4">
      <DocumentCard
        title={doc.title}
        lines={doc.lines}
        leading={<ColourSwatch c={doc.colours[0]} size={12} />}
        trailing={<StatusPill kind={doc.status}>{doc.statusText}</StatusPill>}
      />
    </div>
  );
};
