import type { KalaidoscopeAction } from "./";

export interface TemplateProjection {
  name: string;
  lensPrompt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon?: string;
  section: string;
  projections: TemplateProjection[];
  actions: KalaidoscopeAction[];
}

export interface TemplateSection {
  title: string;
  templates: Template[];
}

export const templates: TemplateSection[] = [
  {
    title: "For Work",
    templates: [
      {
        id: "meeting-notes",
        name: "Meeting Notes",
        description: "Capture decisions and action items",
        icon: "MessageSquareIcon",
        section: "For Work",
        projections: [
          {
            name: "Decisions & Action Items",
            lensPrompt:
              "From these meeting notes, list the decisions made and the action items agreed, with owners and dates where stated.",
          },
        ],
        actions: [],
      },
      {
        id: "project-tracker",
        name: "Project Tracker",
        description: "Track tasks and milestones",
        icon: "ClipboardListIcon",
        section: "For Work",
        projections: [
          {
            name: "Open Tasks",
            lensPrompt:
              "List all outstanding tasks mentioned across the sources. For each, capture the owner, status, and any deadline. Sort by deadline.",
          },
        ],
        actions: [],
      },
      {
        id: "sprint-board",
        name: "Sprint Board",
        description: "Agile sprint planning and review",
        icon: "CalendarIcon",
        section: "For Work",
        projections: [],
        actions: [],
      },
    ],
  },
  {
    title: "Personal",
    templates: [
      {
        id: "goals",
        name: "Goals",
        description: "Track personal goals and habits",
        icon: "TargetIcon",
        section: "Personal",
        projections: [],
        actions: [],
      },
      {
        id: "journal",
        name: "Journal",
        description: "Daily reflections and thoughts",
        icon: "BookOpenIcon",
        section: "Personal",
        projections: [],
        actions: [],
      },
      {
        id: "organize-emails",
        name: "Organize Emails",
        description: "Summarize and triage an email archive",
        icon: "MailIcon",
        section: "Personal",
        projections: [
          {
            name: "Action Items",
            lensPrompt:
              "From the source emails, extract every action item or request. For each, note who is responsible and any due date. Group them by sender and present as a checklist.",
          },
          {
            name: "Summary",
            lensPrompt:
              "Write a concise summary of the key topics, decisions, and threads across these emails, ordered from most to least important.",
          },
        ],
        actions: [
          {
            id: "organize-emails-action-0",
            type: "import",
            title: "Import your emails",
            description:
              "Bring in an mbox archive to populate this kalaidoscope, then build the views above.",
            icon: "MailIcon",
          },
        ],
      },
      {
        id: "reading-list",
        name: "Reading List",
        description: "Books and articles to read",
        icon: "BookmarkIcon",
        section: "Personal",
        projections: [],
        actions: [],
      },
    ],
  },
  {
    title: "Education",
    templates: [
      {
        id: "course-notes",
        name: "Course Notes",
        description: "Organized lecture and study notes",
        icon: "GraduationCapIcon",
        section: "Education",
        projections: [],
        actions: [],
      },
      {
        id: "research",
        name: "Research",
        description: "Collect and synthesize sources",
        icon: "SearchIcon",
        section: "Education",
        projections: [
          {
            name: "Key Findings",
            lensPrompt:
              "Synthesize the source material into a list of key findings. For each, cite which source it came from and note any disagreements between sources.",
          },
        ],
        actions: [],
      },
      {
        id: "study-plan",
        name: "Study Plan",
        description: "Plan and schedule your learning",
        icon: "CalendarIcon",
        section: "Education",
        projections: [],
        actions: [],
      },
    ],
  },
  {
    title: "Blank",
    templates: [
      {
        id: "empty",
        name: "Empty Kalaidoscope",
        description: "Start from scratch",
        icon: "FileIcon",
        section: "Blank",
        projections: [],
        actions: [],
      },
    ],
  },
];
