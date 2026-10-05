import { describe, expect, it } from "vitest";
import { botInviteLink, normalizeBotUsername } from "@/lib/telegram-bot-invite";

describe("normalizeBotUsername", () => {
  it("接受 @ 開頭、純帳號與 t.me 連結", () => {
    expect(normalizeBotUsername("@fore_erp_bot")).toBe("fore_erp_bot");
    expect(normalizeBotUsername("  fore_erp_bot ")).toBe("fore_erp_bot");
    expect(normalizeBotUsername("https://t.me/fore_erp_bot")).toBe("fore_erp_bot");
    expect(normalizeBotUsername("t.me/ForeErpBot?start=ABC")).toBe("ForeErpBot");
  });

  it("不是 bot 帳號或格式不符時回傳 null", () => {
    expect(normalizeBotUsername("")).toBeNull();
    expect(normalizeBotUsername(null)).toBeNull();
    expect(normalizeBotUsername("fore_erp")).toBeNull();
    expect(normalizeBotUsername("1fore_bot")).toBeNull();
    expect(normalizeBotUsername("fore-erp-bot")).toBeNull();
    expect(normalizeBotUsername("bot")).toBeNull();
    expect(normalizeBotUsername(`a${"x".repeat(29)}bot`)).toBeNull();
  });
});

describe("botInviteLink", () => {
  it("帶入 start 參數", () => {
    expect(botInviteLink("fore_erp_bot", "AB23CD45")).toBe(
      "https://t.me/fore_erp_bot?start=AB23CD45",
    );
  });
});
