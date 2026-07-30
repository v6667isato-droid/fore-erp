/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * Cloudflare Workers 入口：包住 OpenNext 產生的 worker，補上 Vercel Cron 對應的
 * scheduled 處理（Cloudflare Cron Triggers）。
 * cron 表達式需與 wrangler.jsonc 的 triggers.crons 一致；
 * 觸發時比照 Vercel Cron 以 Authorization: Bearer CRON_SECRET 呼叫自身路由。
 */
// @ts-ignore `.open-next/worker.js` 在 `opennextjs-cloudflare build` 時產生
import { default as handler } from "./.open-next/worker.js";

const CRON_ROUTES: Record<string, string> = {
  "0 1 * * 1": "/api/cron/weekly-order-summary",
  "0 0 1,16 * *": "/api/gmail-import",
};

interface Env {
  WORKER_SELF_REFERENCE: {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
  CRON_SECRET?: string;
}

const worker = {
  fetch: handler.fetch,

  async scheduled(
    controller: { cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ) {
    const path = CRON_ROUTES[controller.cron];
    if (!path) return;
    ctx.waitUntil(
      env.WORKER_SELF_REFERENCE.fetch(`https://fore-erp.internal${path}`, {
        headers: env.CRON_SECRET
          ? { authorization: `Bearer ${env.CRON_SECRET}` }
          : undefined,
      })
    );
  },
};

export default worker;
