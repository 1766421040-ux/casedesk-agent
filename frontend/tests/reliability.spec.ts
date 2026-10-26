import { expect, test, type Page } from "@playwright/test";

type Session = { token: string; user: { tenantId: string } };
type Ticket = { id: string; subject: string; description: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function subject(prefix: string) {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function login(
  page: Page,
  email = "agent@aurora.demo",
  options: { navigate?: boolean; waitForQueue?: boolean } = {},
): Promise<Session> {
  if (options.navigate !== false) await page.goto("/");
  await page.getByLabel("工作邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill("DemoPass!2026");
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === "/api/auth/login" &&
      item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "进入 CaseDesk" }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "工单工作台" }),
  ).toBeVisible();
  if (options.waitForQueue !== false) {
    await expect(
      page.locator(".ticket-list .ticket-card").first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新数据" })).toBeEnabled();
  }
  return result.json();
}

async function createTicket(
  page: Page,
  session: Session,
  title: string,
  description: string,
  orderId: string | null = null,
): Promise<Ticket> {
  // Test setup uses the real authenticated API, not a fabricated UI fixture.
  const response = await page.request.post("/api/tickets", {
    headers: { Authorization: `Bearer ${session.token}` },
    data: {
      subject: title,
      description,
      orderId,
      customerName: "可靠性测试客户",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).ticket;
}

async function refresh(page: Page) {
  const response = page.waitForResponse(
    (item) =>
      new URL(item.url()).pathname === "/api/tickets" &&
      item.request().method() === "GET",
  );
  await page.getByRole("button", { name: "刷新数据" }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("button", { name: "刷新数据" })).toBeEnabled();
}

async function selectTicket(page: Page, ticket: Ticket) {
  await page
    .locator(".ticket-card")
    .filter({ hasText: ticket.subject })
    .click();
  await expect(
    page.locator(".detail-heading").getByRole("heading", {
      name: ticket.subject,
      exact: true,
    }),
  ).toBeVisible();
}

test("旧租户刷新响应晚到不污染新租户（仅延迟真实 GET 响应）", async ({
  page,
}) => {
  const aurora = await login(page);
  const original = await createTicket(
    page,
    aurora,
    subject("异步隔离仅极光可见"),
    "此工单只属于极光租户，用于检查迟到响应不会污染另一工作空间。",
  );
  const entered = deferred();
  const release = deferred();
  let intercepted = false;
  let oldTicketIds: string[] = [];

  // Read the actual Aurora response before logout, but deliver it only after
  // Harbor has logged in. No ticket fields, identities or API results are mocked.
  await page.route(
    (url) => url.pathname === "/api/tickets",
    async (route) => {
      if (
        intercepted ||
        route.request().method() !== "GET" ||
        route.request().headers().authorization !== `Bearer ${aurora.token}`
      ) {
        await route.continue();
        return;
      }
      intercepted = true;
      const response = await route.fetch();
      oldTicketIds = (await response.json()).items.map(
        (item: Ticket) => item.id,
      );
      entered.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
  );

  try {
    await page.getByRole("button", { name: "刷新数据" }).click();
    await entered.promise;
    expect(oldTicketIds).toContain(original.id);
    const logout = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/auth/logout",
    );
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    expect((await logout).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "进入工作台" }),
    ).toBeVisible();
    // Do not navigate or reload: the old fetch must remain alive in this document.
    const harbor = await login(page, "agent@harbor.demo", { navigate: false });
    expect(harbor.user.tenantId).toBe("harbor");
    await expect(page.locator(".workspace-tag")).toContainText("海港生活");
    const harborCards = await page
      .locator(".ticket-list .ticket-card")
      .allTextContents();

    const lateResponse = page.waitForResponse(
      (item) =>
        new URL(item.url()).pathname === "/api/tickets" &&
        item.request().headers().authorization === `Bearer ${aurora.token}`,
    );
    release.resolve();
    expect((await lateResponse).status()).toBe(200);
    // Give the released fetch and React render a browser frame, without a timed sleep.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.locator(".workspace-tag")).toContainText("海港生活");
    await expect(page.locator(".ticket-list .ticket-card")).toHaveText(
      harborCards,
    );
    await expect(page.locator(".main")).not.toContainText(original.subject);
    await expect(page.getByRole("heading", { name: "进入工作台" })).toHaveCount(
      0,
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "规则知识库" })
      .click();
    await expect(page.locator(".knowledge-grid")).toContainText(
      "harbor-refund",
    );
    await expect(page.locator(".knowledge-grid")).not.toContainText("aurora-");
  } finally {
    release.resolve();
  }
});

test("运行 A 时切换 B，A 返回后详情仍属于 B（仅延迟真实运行响应）", async ({
  page,
}) => {
  const session = await login(page);
  const ticketA = await createTicket(
    page,
    session,
    subject("并发选择工单 A"),
    "请查询手表的物流配送状态，并根据当前规则解释配送时效。",
    "AURORA-1004",
  );
  const ticketB = await createTicket(
    page,
    session,
    subject("并发选择工单 B"),
    "这是尚未运行的独立客户问题，暂不关联订单。",
  );
  await refresh(page);
  await selectTicket(page, ticketA);
  const entered = deferred();
  const release = deferred();
  let actualRunId = "";

  // The backend really executes and persists A. Only its HTTP response delivery
  // is gated, so switching the selected ticket races a genuine completed request.
  await page.route(`**/api/tickets/${ticketA.id}/runs`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    actualRunId = body.run.id;
    entered.resolve();
    await release.promise;
    await route.fulfill({ response });
  });

  try {
    await page.getByRole("button", { name: "运行 Agent", exact: true }).click();
    await entered.promise;
    await expect(page.getByRole("button", { name: "正在分析…" })).toBeVisible();
    await selectTicket(page, ticketB);
    await expect(page.locator(".run-result")).toHaveCount(0);
    const completed = page.waitForResponse(
      (item) =>
        new URL(item.url()).pathname === `/api/tickets/${ticketA.id}/runs`,
    );
    release.resolve();
    expect((await completed).status()).toBe(200);
    await expect(
      page.getByRole("status").filter({ hasText: "运行结果已保存" }),
    ).toBeVisible();
    await expect(page.locator(".detail-heading")).toContainText(
      ticketB.subject,
    );
    await expect(page.locator(".customer-message")).toHaveText(
      `客户描述${ticketB.description}`,
    );
    await expect(page.locator(".run-result")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "运行 Agent", exact: true }),
    ).toBeEnabled();

    const persistedB = await page.request.get(`/api/tickets/${ticketB.id}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect((await persistedB.json()).runs).toEqual([]);
    await selectTicket(page, ticketA);
    await expect(page.locator(".run-result")).toBeVisible();
    await expect(page.locator(".run-meta")).toContainText(
      actualRunId.slice(-8),
    );
    await expect(page.locator(".answer-label .badge")).toHaveText("已完成");
  } finally {
    release.resolve();
  }
});

test("首次队列加载失败可刷新恢复（仅初始 GET /tickets 返回 503）", async ({
  page,
}) => {
  let reads = 0;
  let initialLoad = true;
  await page.route(
    (url) => url.pathname === "/api/tickets",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      reads++;
      if (!initialLoad) {
        await route.continue();
        return;
      }
      // Only the initial list-loading phase is synthetic. React StrictMode may
      // issue this effect twice in development, so both initial reads fail.
      // Manual retry and every other API call use the actual backend.
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "TEST_TEMPORARY_UNAVAILABLE",
            message: "测试模拟：首次工单读取暂不可用，请刷新重试。",
          },
        },
      });
    },
  );
  await login(page, "agent@harbor.demo", { waitForQueue: false });
  await expect(page.getByRole("alert")).toContainText("首次工单读取暂不可用");
  await expect(page.locator(".ticket-list .ticket-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新数据" })).toBeEnabled();
  const initialReads = reads;
  initialLoad = false;
  await refresh(page);
  expect(reads).toBeGreaterThan(initialReads);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".ticket-list .ticket-card").first()).toBeVisible();
  await expect(page.locator(".detail-heading h2")).toBeVisible();
  await expect(page.locator(".workspace-tag")).toContainText("海港生活");
});
