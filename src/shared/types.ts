export type Provider = "github" | "stripe" | "slack" | "generic";

export interface Channel {
  id: string;
  name: string;
  provider: Provider | null;
  secret: string | null;
  callbackUrl: string | null;
  authToken: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookEvent {
  id: string;
  channelId: string;
  headers: Record<string, string>;
  body: string;
  method: string;
  sourceIp: string;
  receivedAt: number;
  deliveredAt: number | null;
  attempts: number;
}
