import { Client } from "@line/bot-sdk";

export function getLineMessagingClient(): Client | null {
  const channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
  if (!channelAccessToken) return null;
  return new Client({ channelAccessToken });
}
