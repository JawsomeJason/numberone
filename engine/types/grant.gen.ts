// generated from schemas/grant.v1.json by tools/gen-types.ts, do not edit

export type Grant = {
  id: string;
  schema: "numberone-grant/v1";
  title: string;
  wording: string;
  covers: {
    runs: string[];
    prs: string[];
    people: string[];
    tickets: string[];
  };
  actions: GrantAction[];
  expires: GrantExpiry;
  status: "pending" | "approved" | "denied" | "revoked" | "expired";
  asked_at: string;
  decided?: {
    by: string;
    at: string;
    via: string;
  };
  supersedes: string | null;
};
export type GrantAction = {
  verb: string;
  where?: string;
  prs?: string[];
  when?: string;
  [key: string]: unknown;
};
export type GrantExpiry = {
  "run-end": true;
} | {
  at: string;
} | {
  stage: string;
};
