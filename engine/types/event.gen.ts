// generated from schemas/event.v1.json by tools/gen-types.ts, do not edit

export type Event = {
  v: 1;
  seq: number;
  at: string;
  run: string;
  kind: EventKind;
  state?: string;
  atom?: string;
  key?: string;
  data: {
    [key: string]: unknown;
  };
  cost?: EventCost;
};
export type EventKind = "run.start" | "run.end" | "state.enter" | "state.exit" | "watch.start" | "watch.observe" | "watch.heartbeat" | "watermark" | "exit" | "act.start" | "act.done" | "model.spawn" | "model.done" | "wake" | "answer" | "guidance" | "exception.enter" | "exception.resume" | "grant.ask" | "grant.decide" | "grant.expire" | "draft.add" | "draft.replace" | "draft.send" | "draft.remove" | "send" | "error";
export type EventCost = {
  layer: "code" | "jev" | "haiku" | "llm";
  input_tokens: number;
  output_tokens: number;
};
