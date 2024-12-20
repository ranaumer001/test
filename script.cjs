const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const { parse } = require("json2csv");

puppeteer.use(StealthPlugin());

(async () => {
  const businessLinksFile = "business_links.json";
  const businessDetailsFile = "public/updated_business_details.json";
  const businessDetailsCSV = "public/updated_business_details.csv";

  try {
    console.log("[INFO] Launching first browser for collecting business links...");
    const browser = await puppeteer.launch({
      executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
      ],
    });
    const page = await browser.newPage();
    console.log("[INFO] First browser launched successfully.");

    const url = process.argv[2]; // Get the URL from command-line arguments
    if (!url) {
      console.error("[ERROR] URL not provided. Exiting.");
      process.exit(1);
    }

    console.log(`[INFO] Navigating to URL: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    try {
      const acceptCookiesSelector = "form:nth-child(2)";
      console.log("[INFO] Checking for cookies pop-up...");
      await page.waitForSelector(acceptCookiesSelector, { timeout: 5000 });
      await page.click(acceptCookiesSelector);
      console.log("[INFO] Cookies pop-up dismissed.");
    } catch (error) {
      console.log("[WARN] No cookies pop-up found. Proceeding...");
    }

    const links = [];
    const businessSelector = ".hfpxzc";

    console.log("[INFO] Scrolling to load all results...");
    await page.evaluate(async () => {
      const scrollDistance = 1000;
      const scrollDelay = 3000;
      const maxAttempts = 5;

      let totalScrolled = 0;
      let attempts = 0;
      const container = document.querySelector('div[role="feed"]');

      while (attempts < maxAttempts) {
        const previousHeight = container.scrollHeight;
        container.scrollBy(0, scrollDistance);
        totalScrolled += scrollDistance;

        await new Promise((resolve) => setTimeout(resolve, scrollDelay));
        if (container.scrollHeight === previousHeight) {
          attempts++;
        } else {
          attempts = 0;
        }
      }
    });

    console.log("[INFO] Extracting business links...");
    const extractedLinks = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((el) => el.href);
    }, businessSelector);

    extractedLinks.forEach((link) => {
      if (!links.includes(link)) {
        links.push(link);
      }
    });

    fs.writeFileSync(businessLinksFile, JSON.stringify(links, null, 2));
    console.log(`[INFO] Collected ${links.length} business links.`);

    await browser.close();
    console.log("[INFO] First browser closed.");

    // Proceed with Part 2: Scraping business details
    if (!fs.existsSync(businessLinksFile)) {
      throw new Error(`[ERROR] ${businessLinksFile} not found. Aborting business details scraping.`);
    }

    const businessLinks = JSON.parse(fs.readFileSync(businessLinksFile));
    const results = [];
    const browser2 = await puppeteer.launch({
      executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
      ],
    });
    const page2 = await browser2.newPage();

    for (let i = 0; i < businessLinks.length; i++) {
      const link = businessLinks[i];
      console.log(`[INFO] Scraping business ${i + 1} of ${businessLinks.length}: ${link}`);

      try {
        await page2.goto(link, { waitUntil: "networkidle2", timeout: 60000 });

        const data = await page2.evaluate(() => {
          const extractText = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : "N/A";
          };

          const extractAttribute = (selector, attr) => {
            const element = document.querySelector(selector);
            return element ? element.getAttribute(attr) : "N/A";
          };

          const name = extractText("h1.DUwDvf.lfPIob");
          const rating = extractText(".F7nice span[aria-hidden='true']");
          const reviews = extractText(".F7nice span[aria-label*='reviews']").replace(/[()]/g, "");
          const businessType = extractText("button.DkEaL");
          const address = extractText("button.CsEnBe[data-item-id='address'] .Io6YTe.fontBodyMedium");
          const phone = extractText("button.CsEnBe[data-item-id^='phone:'] .Io6YTe.fontBodyMedium");
          let openTime = extractText("div.t39EBf.GUrTXd[aria-label]");
          openTime = openTime
            .replace(/Suggest new hours$/, "")
            .replace(//g, "")
            .replace(/([a-zA-Z])([0-9])/g, "$1: $2")
            .replace(/([a-z])([A-Z])/g, "$1 | $2")
            .replace(/\s+/g, " ")
            .replace(/Closed/, "Closed |")
            .replace(/\|\s+\|/g, "|")
            .replace(/:\s+\|/g, ":");

          const website = extractAttribute("a.CsEnBe[data-item-id='authority']", "href");

          return { name, rating, reviews, businessType, address, phone, openTime, website };
        });

        results.push({ link, ...data });
      } catch (error) {
        console.error(`[ERROR] Failed to scrape ${link}: ${error.message}`);
        results.push({ link, error: error.message });
      }
    }

    fs.writeFileSync(businessDetailsFile, JSON.stringify(results, null, 2));
    console.log(`[INFO] Scraping completed. Results saved to '${businessDetailsFile}'.`);

    // Convert JSON to CSV
    try {
      const csv = parse(results);
      fs.writeFileSync(businessDetailsCSV, csv);
      console.log(`[INFO] CSV file created: ${businessDetailsCSV}`);
    } catch (error) {
      console.error("[ERROR] Error while converting JSON to CSV:", error.message);
    }

    await browser2.close();
  } catch (error) {
    console.error("[ERROR] Error in script execution:", error.message);
  }
})();
