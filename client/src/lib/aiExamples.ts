// Typewriter "lure" pool used by both the corner AI drawer and the
// full /portal/ai page. Kept short on purpose — the drawer is ~380px
// wide so anything past ~35 chars wraps and the lure looks broken.
// Mix of reads, writes, emails, DMs, recaps, status checks, money,
// people, and photos so the user sees the breadth of what the
// assistant can actually do over the portal API.
export const AI_EXAMPLES: string[] = [
  // Leads
  'list active leads',
  'show stale leads',
  'leads from this week',
  'leads stuck in QUOTE_SENT',
  'high-value leads',
  "who's hottest right now?",
  "leads I haven't replied to",
  'show lost leads this month',
  'leads without estimates',
  'mark lead 12 as won',
  'add a lead named Sam',
  'close the Hughes lead',

  // Projects
  'list active projects',
  'show projects on hold',
  'projects starting next week',
  'running projects this month',
  'recap the Hughes project',
  'status of the deck job',
  "who's on the Smith project?",
  'show overdue project tasks',
  'completed projects this year',
  'biggest projects by revenue',
  'create a project for Cody',
  'start a deck project',

  // Invoices / money
  'show overdue invoices',
  'invoices over $5k?',
  "what's outstanding?",
  'invoices paid this week',
  'customers behind on bills',
  'unpaid invoices over 30 days',
  'total owed across customers',
  'revenue this quarter',
  'expenses this month',
  'tax-exempt customers',

  // Estimates / contracts
  'estimates pending response',
  'contracts awaiting signature',
  'show signed contracts',
  'estimates over $20k',
  'expired estimates',
  'quote conversion rate?',
  'drafts I never sent',

  // Schedule / calendar
  "list this week's schedule",
  "what's tomorrow?",
  "show today's events",
  'nothing on the books?',
  'busiest day next week',
  "who's scheduled Friday?",

  // People
  "who's on the deck job?",
  'show subs without W-9s',
  'subs missing licences',
  'employees missing licences',
  'active subcontractors',
  'find a plumbing sub',
  'add Mike as a sub',
  'customer count this year',

  // Messages / inbox
  "what's in my inbox?",
  'unread messages?',
  'board posts this week',
  'recent DMs',
  'emails sent today',
  'customer replies waiting',

  // Email drafts
  'draft an email to Cody',
  'email the Hughes follow-up',
  'send a thanks to Smith',
  'nudge the open invoices',
  'email subs about Friday',
  "confirm tomorrow's appt",
  'email Sam the estimate',

  // DMs
  'DM Matt about Wednesday',
  'DM the crew good morning',
  'message Lisa for an update',
  'DM the team a reminder',
  'ping Cody on the budget',

  // Recaps / summaries
  'recap this week',
  "what's changed this week?",
  'summarize my open work',
  "how's the pipeline?",
  'show me my morning brief',

  // Pay / sub bills / receipts
  'show pending pay requests',
  'pending sub bills?',
  'sub bills over $1k',
  'payroll due Friday?',
  'expenses I owe back',
  'log a 4-hour pay request',
  'recent job receipts',

  // Status / health
  "anything I'm missing?",
  'show alerts I should clear',
  "what's on fire?",
  'project red flags?',
  'flagged invoices',
  'show cancelled jobs',

  // Photos / gallery
  'recent project photos',
  'photos from the deck job',
  'missing project photos',
  'docs I still need to file',

  // Misc / quick
  'who replied to me?',
  "find Cody's contact info",
  'show my saved drafts',
  'quick portal stats',
  'top customers this year',
  'idle leads to follow up',
  "what's due today?",
  "what's due this week?",
  'show this month at a glance',
];
