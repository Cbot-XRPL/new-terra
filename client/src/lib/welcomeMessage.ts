// Dashboard subtitle generator. Returns a holiday-aware or otherwise
// random construction-flavoured welcome line so the home page doesn't
// feel like the same static template every load.
//
// The pool is large enough that a user can hit the dashboard a dozen
// times a day without seeing the same line twice.

const POOL: string[] = [
  // Plain welcome variants
  'Welcome to your construction management suite.',
  'Your build hub — schedule, comms, and money in one place.',
  'Everything for the next swing of the hammer.',
  'Plans, people, and payments — all under one roof.',
  'Your jobsite command center.',
  'Where blueprints meet bookkeeping.',
  'From estimate to handoff, all in here.',
  'Run the build. We\'ll handle the rest.',
  'Your crew, your projects, your cash flow.',
  'Tools down, dashboards up.',

  // Quirky construction
  'Measure twice, click once.',
  'No saws required for this dashboard.',
  'Hard hats optional. Coffee mandatory.',
  'Today\'s forecast: 100% chance of progress.',
  'Building things, one click at a time.',
  'Pencils sharpened, levels calibrated.',
  'Plumb, square, and signed off.',
  'The crew\'s on site. The spreadsheet\'s here.',
  'Concrete plans for a concrete day.',
  'Nailing the office side so the field can fly.',

  // Motivational-but-not-cheesy
  'Let\'s build something good today.',
  'Big jobs, small steps.',
  'Another day, another dollar earned.',
  'Get the bid out, get the job in.',
  'Punch list down, profit up.',
  'On time, on budget, on it.',
  'Sweat the details — they pay.',
  'Dust on the boots, signal in the office.',
  'Tighten the schedule, loosen the grip.',
  'Eyes on the plan, hands on the work.',

  // Just kinda fun
  'Hope your truck started this morning.',
  'Coffee\'s hot, deadlines aren\'t.',
  'Crayons in the kid\'s room. Pencils here.',
  'It\'s never the foundation — until it is.',
  'Did the sub call you back? No? Same.',
  'Today\'s vibe: \'one more thing\' energy.',
  'Permits permitting, we\'ll get it done.',
  'Let\'s find that 2x4 we paid for twice.',
  'Code-compliant and customer-approved.',
  'Snap the line. Push the buttons.',

  // Industry-flavoured
  'Forms set, mud poured, bids out.',
  'Frame it, wrap it, side it, paint it.',
  'A lien-free day to you.',
  'May your draws clear the same week you sign.',
  'No surprise rocks today.',
  'Closeouts close themselves. Eventually.',
  'Inspector on the way? Take a deep breath.',
  'Estimating is half art, half spreadsheet.',
  'Margin, margin, margin.',
  'Substantial completion is a feeling.',

  // Bonus filler so we comfortably exceed 50
  'Let\'s ship some drywall today.',
  'The roof is the easy part.',
  'New day, fresh punch list.',
  'Sometimes the finish line is just trim.',
];

interface HolidayHit {
  message: string;
  // Bigger windows = the greeting shows for a few days around the date.
  // Window is +/- days from the anchor.
}

// Anchor list — month/day plus the message and optional window. We keep
// this US-centric since the company is in Georgia. Adding regional
// holidays is a one-liner here.
const HOLIDAYS: Array<{ month: number; day: number; window: number; message: string }> = [
  { month: 1, day: 1, window: 1, message: 'Happy New Year — fresh punch list, fresh start.' },
  { month: 2, day: 14, window: 0, message: 'Happy Valentine\'s Day — hug your subs (figuratively).' },
  { month: 3, day: 17, window: 0, message: 'Happy St. Patrick\'s Day — pour something green today (concrete counts).' },
  { month: 4, day: 1, window: 0, message: 'April Fool\'s — that change order is real, unfortunately.' },
  { month: 4, day: 22, window: 0, message: 'Happy Earth Day — recycle that pallet.' },
  { month: 5, day: 5, window: 0, message: 'Happy Cinco de Mayo — tacos on the trailer.' },
  { month: 7, day: 4, window: 1, message: 'Happy 4th of July — no fireworks on the jobsite, please.' },
  { month: 10, day: 31, window: 0, message: 'Happy Halloween — only thing scary should be the bid math.' },
  { month: 11, day: 11, window: 0, message: 'Veterans Day — thanks to those who served.' },
  { month: 12, day: 24, window: 0, message: 'Christmas Eve — wrap the day, then the presents.' },
  { month: 12, day: 25, window: 1, message: 'Merry Christmas — site\'s closed, the family\'s open.' },
  { month: 12, day: 31, window: 0, message: 'Happy New Year\'s Eve — close out those invoices.' },
];

// Returns the closest US Thanksgiving (4th Thursday of November) for a year.
function thanksgiving(year: number): Date {
  // Find first Thursday of November, add 21 days.
  const nov1 = new Date(year, 10, 1);
  const offset = (4 - nov1.getDay() + 7) % 7; // 4 = Thursday
  return new Date(year, 10, 1 + offset + 21);
}

// Memorial Day = last Monday of May.
function memorialDay(year: number): Date {
  const may31 = new Date(year, 4, 31);
  const offset = (may31.getDay() + 6) % 7; // back up to Monday
  return new Date(year, 4, 31 - offset);
}

// Labor Day = first Monday of September.
function laborDay(year: number): Date {
  const sep1 = new Date(year, 8, 1);
  const offset = (1 - sep1.getDay() + 7) % 7; // 1 = Monday
  return new Date(year, 8, 1 + offset);
}

function sameDay(a: Date, b: Date, window = 0): boolean {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms <= window * 24 * 60 * 60 * 1000;
}

function holidayFor(now: Date): HolidayHit | null {
  const y = now.getFullYear();

  for (const h of HOLIDAYS) {
    const anchor = new Date(y, h.month - 1, h.day);
    if (sameDay(anchor, now, h.window)) {
      return { message: h.message };
    }
  }

  // Floating-date holidays (computed per year).
  if (sameDay(thanksgiving(y), now, 1)) {
    return { message: 'Happy Thanksgiving — pass the rolls and the receipts.' };
  }
  if (sameDay(memorialDay(y), now, 0)) {
    return { message: 'Memorial Day — remembering those we lost.' };
  }
  if (sameDay(laborDay(y), now, 0)) {
    return { message: 'Happy Labor Day — to the people who actually built America.' };
  }

  return null;
}

/**
 * Returns the welcome subtitle for the dashboard. Picks a holiday line
 * if one applies for today (±window days), otherwise a random message
 * from the construction-flavoured pool.
 *
 * Pure function with an injectable `now` so tests can pin the date.
 */
export function welcomeMessage(now: Date = new Date()): string {
  const hit = holidayFor(now);
  if (hit) return hit.message;
  return POOL[Math.floor(Math.random() * POOL.length)] ?? POOL[0]!;
}
