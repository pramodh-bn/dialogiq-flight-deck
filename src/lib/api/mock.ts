import { classifyTurn } from "../classify";
import type { DialogApi, Scenario } from "./types";

// Canned stand-in for the backend so the app runs with no server. Replies follow the
// same open / closed / empathy split the Arena used before the API layer existed.

export const mockScenarios: Scenario[] = [
  {
    id: 1,
    title: "Bob: Defensive Team Member",
    description: "Performance review · missed Q3 deadlines",
  },
  {
    id: 2,
    title: "Teenage Daughter: Homework Friction",
    description: "Evening check-in · phone boundaries",
  },
  { id: 3, title: "Priya: Burnout Disclosure", description: "1:1 · workload renegotiation" },
  { id: 4, title: "Vendor: Contract Pushback", description: "Negotiation · price increase" },
];

const replies = {
  closed: [
    "Yeah. I guess. Is that all?",
    "No. I already told you it wasn't my fault.",
    "Sure, fine. Whatever you think.",
  ],
  open: [
    "Honestly? The design team kept changing specs and I was the one left holding the bag.",
    "I don't know… I felt like nobody noticed how much I was juggling until it fell apart.",
    "If I'm being real, I stopped asking for help because it never came.",
  ],
  empathy: [
    "…Yeah. It's been rough. Thanks for actually saying that.",
    "I appreciate that. I didn't think you'd see it that way.",
  ],
};

export function createMockApi(random: () => number = Math.random): DialogApi {
  let nextSession = 1;
  const turns = new Map<number, number>();

  return {
    async listScenarios() {
      return mockScenarios;
    },
    async createSession({ scenario_id }) {
      const id = nextSession++;
      turns.set(id, 0);
      return { id, scenario_id, score: 0 };
    },
    async sendTurn({ session_id, user_message }) {
      const turn = (turns.get(session_id) ?? 0) + 1;
      turns.set(session_id, turn);
      const c = classifyTurn(user_message);
      const pool = c.empathy ? replies.empathy : c.open ? replies.open : replies.closed;
      const reply = pool[Math.floor(random() * pool.length)] ?? pool[0]!;
      return { turn_id: turn, character_response: reply, revealed_node_score: null };
    },
  };
}
