import { chromium } from "playwright";

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_DEBUG_LINES = 20;

function splitCsv(value) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pushLimited(list, value) {
  if (list.length < MAX_DEBUG_LINES) {
    list.push(value);
  }
}

function formatSection(title, values) {
  if (!values.length) {
    return `${title}: none`;
  }

  return `${title}:\n- ${values.join("\n- ")}`;
}

function isRelevantUrl(value) {
  return /find\.isharoverwhite\.com|econnect|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|:8000|:9123|:3000/i.test(
    value,
  );
}

function buildFailure(message, details) {
  const error = new Error(message);
  error.details = details;
  return error;
}

async function main() {
  const scanUrl = process.env.DISCOVERY_SCAN_URL?.trim();
  if (!scanUrl) {
    throw new Error("DISCOVERY_SCAN_URL is required.");
  }

  const label = process.env.DISCOVERY_SCAN_LABEL?.trim() || scanUrl;
  const timeoutMs = Number.parseInt(process.env.DISCOVERY_SCAN_TIMEOUT_MS || "", 10) || DEFAULT_TIMEOUT_MS;
  const expectedAny = splitCsv(process.env.DISCOVERY_EXPECT_ANY);

  const consoleEvents = [];
  const pageErrors = [];
  const requestFailures = [];
  const relevantResponses = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      pushLimited(consoleEvents, `[${type}] ${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    pushLimited(pageErrors, error.message);
  });

  page.on("requestfailed", (request) => {
    if (!isRelevantUrl(request.url())) {
      return;
    }

    const failureText = request.failure()?.errorText || "unknown failure";
    pushLimited(requestFailures, `${request.method()} ${request.url()} -> ${failureText}`);
  });

  page.on("response", (response) => {
    if (!isRelevantUrl(response.url())) {
      return;
    }

    pushLimited(
      relevantResponses,
      `${response.status()} ${response.request().method()} ${response.url()}`,
    );
  });

  try {
    await page.goto(scanUrl, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });

    const restartButton = page.getByRole("button", {
      name: /Scan( LAN)? Again/i,
    });

    if (await restartButton.isVisible().catch(() => false)) {
      await restartButton.click();
    }

    await page
      .waitForFunction(
        () => /Waiting for searching E-Connect server/i.test(document.body?.innerText || ""),
        null,
        { timeout: 5_000 },
      )
      .catch(() => null);

    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || "";
        return /Scan Results \(\d+\)|No E-Connect Servers Found|Scan Failed/.test(text);
      },
      null,
      { timeout: timeoutMs },
    );

    const pageText = await page.locator("body").innerText();
    const compactPageText = pageText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" | ");
    const resultMatch = pageText.match(/Scan Results \((\d+)\)/);

    if (pageText.includes("Scan Failed")) {
      throw buildFailure(`Discovery smoke failed for ${label}: page reported Scan Failed.`, compactPageText);
    }

    if (pageText.includes("No E-Connect Servers Found")) {
      throw buildFailure(`Discovery smoke failed for ${label}: no servers found.`, compactPageText);
    }

    if (!resultMatch) {
      throw buildFailure(
        `Discovery smoke failed for ${label}: no terminal scan state was detected.`,
        compactPageText,
      );
    }

    const matchedToken = expectedAny.find((token) => pageText.includes(token));
    if (expectedAny.length > 0 && !matchedToken) {
      throw buildFailure(
        `Discovery smoke failed for ${label}: scan results did not contain any expected token (${expectedAny.join(", ")}).`,
        compactPageText,
      );
    }

    console.log(
      `Discovery smoke passed for ${label}: ${resultMatch[1]} result(s)${
        matchedToken ? `, matched ${matchedToken}` : ""
      }.`,
    );
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    const details =
      error && typeof error === "object" && "details" in error && typeof error.details === "string"
        ? error.details
        : null;

    console.error(summary);
    if (details) {
      console.error(`Page text: ${details}`);
    }
    console.error(formatSection("Console", consoleEvents));
    console.error(formatSection("Page errors", pageErrors));
    console.error(formatSection("Request failures", requestFailures));
    console.error(formatSection("Relevant responses", relevantResponses));
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
