import type {
  ColourResponse,
  FragmentResponse,
  IsoAutoDateString,
} from "@/api/kalaidoscope/types";
import type { MemberRow } from "./fragments";

export const mockColours: ColourResponse[] = [
  {
    id: "col_1",
    name: "Customer Feedback",
    swatch: 0,
    prompt:
      "Emails and messages containing direct product feedback or feature requests.",
    created: "2026-07-01T10:00:00Z" as IsoAutoDateString,
    updated: "2026-07-01T10:00:00Z" as IsoAutoDateString,
    last_provider_error_kind: "",
    prompt_match_completed_up_to_fragment_id: "",
    thing_ids: null,
    created_by_discover_run_id: "",
    collectionId: "colour",
    collectionName: "colour",
  },
  {
    id: "col_2",
    name: "Urgent Bugs",
    swatch: 1,
    prompt:
      "Sms and notes about service crashes, downtime, or critical failures.",
    created: "2026-07-02T11:00:00Z" as IsoAutoDateString,
    updated: "2026-07-02T11:30:00Z" as IsoAutoDateString,
    last_provider_error_kind: "",
    prompt_match_completed_up_to_fragment_id: "",
    thing_ids: null,
    created_by_discover_run_id: "",
    collectionId: "colour",
    collectionName: "colour",
  },
  {
    id: "col_3",
    name: "Kudos & Compliments",
    swatch: 2,
    prompt: "Positive feedback, team praises, or happy customer messages.",
    created: "2026-07-03T12:00:00Z" as IsoAutoDateString,
    updated: "2026-07-03T12:00:00Z" as IsoAutoDateString,
    last_provider_error_kind: "",
    prompt_match_completed_up_to_fragment_id: "",
    thing_ids: null,
    created_by_discover_run_id: "",
    collectionId: "colour",
    collectionName: "colour",
  },
];

export const mockFragments: FragmentResponse[] = [
  {
    id: "frag_1",
    type: "email",
    ingested_via: "import",
    content:
      "Hi team, I really love the new dark mode design! But I noticed a slight lag when switching layouts. Can we optimize this?",
    source: "customer_portal",
    occurred_at: "2026-07-06T09:00:00Z",
    deleted_at: "",
    created: "2026-07-06T09:00:00Z" as IsoAutoDateString,
    collectionId: "fragment",
    collectionName: "fragment",
  },
  {
    id: "frag_2",
    type: "note",
    ingested_via: "sync",
    content:
      "ALERT: Production database latency has exceeded 500ms for the past 5 minutes. Investigating now.",
    source: "pagerduty",
    occurred_at: "2026-07-06T09:15:00Z",
    deleted_at: "",
    created: "2026-07-06T09:15:00Z" as IsoAutoDateString,
    collectionId: "fragment",
    collectionName: "fragment",
  },
  {
    id: "frag_3",
    type: "note",
    ingested_via: "app",
    content:
      "Self-note: Remember to follow up with Louis on the Step 17 layout chrome work. The colours stories need mock fragments.",
    source: "notetaker",
    occurred_at: "2026-07-06T09:30:00Z",
    deleted_at: "",
    created: "2026-07-06T09:30:00Z" as IsoAutoDateString,
    collectionId: "fragment",
    collectionName: "fragment",
  },
];

export const mockMembers: MemberRow[] = [
  {
    id: "mem_1",
    colour_id: "col_1",
    fragment_id: "frag_1",
    match_type: "prompt",
    expand: {
      fragment_id: mockFragments[0],
    },
  },
  {
    id: "mem_2",
    colour_id: "col_2",
    fragment_id: "frag_2",
    match_type: "manual_positive",
    expand: {
      fragment_id: mockFragments[1],
    },
  },
  {
    id: "mem_3",
    colour_id: "col_1",
    fragment_id: "frag_3",
    match_type: "manual_negative",
    expand: {
      fragment_id: mockFragments[2],
    },
  },
];
