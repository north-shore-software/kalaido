import type { UIMessage } from "ai";
import type { Conversation } from "@/api/kalaidoscope/chat";

export const fixtureConversations: Conversation[] = [
  {
    id: "conv-1",
    clientId: "client-1",
    preview: "What does kalaido stand for?",
    createdAt: "2026-07-06T08:00:00Z",
  },
  {
    id: "conv-2",
    clientId: "client-2",
    preview: "Design a color palette based on oceans",
    createdAt: "2026-07-05T12:00:00Z",
  },
  {
    id: "conv-3",
    clientId: "client-3",
    preview: "How can I integrate Valtio here?",
    createdAt: "2026-07-04T10:30:00Z",
  },
];

export const fixtureMessages: UIMessage[] = [
  {
    id: "msg-0",
    role: "system",
    parts: [
      {
        type: "text",
        text: "This is a system prompt or a context_spec that should be filtered out",
      },
    ],
  },
  {
    id: "msg-1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "What does kalaido stand for?",
      },
    ],
  },
  {
    id: "msg-2",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Kalaido stands for kaleidoscope, reflecting the vibrant and changing facets of your projects.",
      },
    ],
  },
  {
    id: "msg-3",
    role: "user",
    parts: [
      {
        type: "text",
        text: "That sounds awesome! Can you help me organize my thoughts?",
      },
    ],
  },
];
