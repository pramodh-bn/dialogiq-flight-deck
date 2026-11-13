import { describe, expect, it } from "vitest";

import { takeEvents } from "@/lib/research";

describe("takeEvents", () => {
  it("returns complete events and keeps the unfinished tail", () => {
    const first = takeEvents('event: started\ndata: {"brief_id":7}\n\nevent: step\ndata: {"sta');
    expect(first.events).toEqual([{ event: "started", data: { brief_id: 7 } }]);
    const second = takeEvents(first.rest + 'ge":"plan"}\n\n');
    expect(second.events).toEqual([{ event: "step", data: { stage: "plan" } }]);
    expect(second.rest).toBe("");
  });

  it("skips an event whose data is not JSON", () => {
    const taken = takeEvents(
      'event: step\ndata: {oops\n\nevent: started\ndata: {"brief_id":1}\n\n',
    );
    expect(taken.events).toEqual([{ event: "started", data: { brief_id: 1 } }]);
  });
});
