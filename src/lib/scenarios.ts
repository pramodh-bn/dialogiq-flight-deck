export type Scenario = {
  id: string;
  title: string;
  context: string;
  difficulty: "Easy" | "Medium" | "Hard";
  persona: { name: string; role: string; tension: string; traits: string[] };
  opener: string;
  best: number | null; // nodes revealed out of 7
  status: "Completed" | "In progress" | "New";
};

export const scenarios: Scenario[] = [
  {
    id: "difficult-feedback",
    title: "The Difficult Feedback Conversation",
    context: "Deliver feedback on missed Q3 deadlines without triggering defensiveness.",
    difficulty: "Hard",
    persona: { name: "Bob", role: "Senior Engineer", tension: "Feels unrecognized and is quietly job-hunting", traits: ["Avoidant", "High Resistance"] },
    opener: "You wanted to see me? If this is about the Q3 thing, I already sent the update.",
    best: 6,
    status: "Completed",
  },
  {
    id: "budget-defend",
    title: "The Budget Defend Meeting",
    context: "Justify your team's headcount to a CFO looking for 15% cuts.",
    difficulty: "Medium",
    persona: { name: "Elena", role: "CFO", tension: "Already promised the board savings from your org", traits: ["Data-driven", "Impatient"] },
    opener: "I have ten minutes. Convince me why your team shouldn't take the biggest cut.",
    best: 3,
    status: "In progress",
  },
  {
    id: "deadline-negotiation",
    title: "The Deadlined Project Negotiation",
    context: "Renegotiate an impossible launch date with a client stakeholder.",
    difficulty: "Hard",
    persona: { name: "Marcus", role: "Client VP", tension: "His bonus is tied to the original launch date", traits: ["Assertive", "Skeptical"] },
    opener: "Let me guess — you're here to tell me the date is slipping. Again.",
    best: null,
    status: "New",
  },
  {
    id: "burnout-disclosure",
    title: "The Burnout Check-in",
    context: "A high performer hints they're overwhelmed during a routine 1:1.",
    difficulty: "Easy",
    persona: { name: "Priya", role: "Product Designer", tension: "Afraid admitting burnout will cost her promotion", traits: ["Guarded", "Emotional"] },
    opener: "I'm fine, really. Just a busy sprint. What did you want to cover?",
    best: 5,
    status: "Completed",
  },
];

export const getScenario = (id?: string) => scenarios.find((s) => s.id === id) ?? scenarios[0]!;
