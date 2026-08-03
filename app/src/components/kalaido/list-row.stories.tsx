import type { Story } from "@ladle/react";
import { ListRow } from "./list-row.tsx";
import { ColourSwatch } from "./colour.tsx";
import { StatusPill } from "./status-pill.tsx";
import { PinToggle } from "./pin-toggle.tsx";
import { LIST_ROW_FIXTURES } from "./fixtures.ts";
import { action } from "@/lib/story-utils.ts";

export default { title: "Kalaido / ListRow" };

export const FlatList: Story = () => (
  <div className="flex flex-col gap-1 max-w-md p-4 bg-background border border-line rounded-lg">
    {LIST_ROW_FIXTURES.map((item) => (
      <ListRow
        key={item.title}
        title={item.title}
        subtitle={item.subtitle}
        leading={<ColourSwatch c={item.colours[0]} size={12} />}
        trailing={<StatusPill kind={item.status}>{item.statusText}</StatusPill>}
        onClick={() => console.log("List row clicked:", item.title)}
      />
    ))}
  </div>
);

export const SelectedRow: Story = () => (
  <div className="max-w-md p-4 bg-background border border-line rounded-lg">
    <ListRow
      title={LIST_ROW_FIXTURES[0].title}
      subtitle={LIST_ROW_FIXTURES[0].subtitle}
      leading={<ColourSwatch c={LIST_ROW_FIXTURES[0].colours[0]} size={12} />}
      trailing={
        <StatusPill kind={LIST_ROW_FIXTURES[0].status}>
          {LIST_ROW_FIXTURES[0].statusText}
        </StatusPill>
      }
      selected
      onClick={action("onClick")}
    />
  </div>
);

export const CardRow: Story = () => (
  <div className="flex flex-col gap-2 max-w-md p-4">
    <ListRow
      variant="card"
      title={LIST_ROW_FIXTURES[0].title}
      subtitle={LIST_ROW_FIXTURES[0].subtitle}
      leading={
        <div className="flex gap-1 shrink-0">
          {LIST_ROW_FIXTURES[0].colours.map((c) => (
            <ColourSwatch key={c} c={c} size={9} />
          ))}
        </div>
      }
      trailing={<PinToggle pinned={false} onToggle={action("onToggle")} />}
    />
    <ListRow
      variant="card"
      title={LIST_ROW_FIXTURES[1].title}
      subtitle={LIST_ROW_FIXTURES[1].subtitle}
      leading={
        <div className="flex gap-1 shrink-0">
          {LIST_ROW_FIXTURES[1].colours.map((c) => (
            <ColourSwatch key={c} c={c} size={9} />
          ))}
        </div>
      }
      trailing={<PinToggle pinned onToggle={action("onToggle")} />}
    />
  </div>
);
