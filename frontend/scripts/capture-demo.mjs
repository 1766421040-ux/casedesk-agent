import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  await page.goto(process.env.CASEDESK_DEMO_URL || "http://127.0.0.1:5173");
  await mkdir("../docs/images", { recursive: true });
  await page.screenshot({ path: "../docs/images/login.png", fullPage: true });
  await page.getByLabel("工作邮箱").fill("agent@aurora.demo");
  await page.getByLabel("密码", { exact: true }).fill("DemoPass!2026");
  await page.getByRole("button", { name: "进入 CaseDesk" }).click();
  await page
    .locator(".ticket-card")
    .filter({ hasText: "耳机已签收，希望申请退款" })
    .click();
  await page.locator(".run-result").waitFor({ state: "visible" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: "../docs/images/workspace.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^执行轨迹/ }).click();
  await page
    .locator(".trace-list summary")
    .filter({ hasText: "规则校验" })
    .click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../docs/images/trace.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "审批中心" })
    .click();
  await page.screenshot({
    path: "../docs/images/approval.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "工单工作台" })
    .click();
  await page.screenshot({ path: "../docs/images/mobile.png", fullPage: true });
  console.log("Saved 5 screenshots from running CaseDesk demo.");
} finally {
  await browser.close();
}
