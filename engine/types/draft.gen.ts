// generated from schemas/draft.v1.json by tools/gen-types.ts, do not edit

export type Draft = {
  id: string;
  schema: "numberone-draft/v1";
  to: {
    kind: "dm" | "channel" | "thread";
    ref: string;
    label: string;
  };
  body: string;
  meta: {
    why: string;
    added: string;
    flow: string;
    run: string;
    stage: string;
  };
  send_box: boolean;
  state: "drafted" | "sending" | "sent" | "removed";
  section_id?: string;
};
