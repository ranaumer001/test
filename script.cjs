const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const { parse } = require("json2csv");

// Use stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

(async () => {
  const businessLinksFile = "business_links.json";
  const businessDetailsFile = "public/updated_business_details.json";
  const businessDetailsCSV = "public/updated_business_details.csv";

  try {
    console.log("Launching the browser...");
    const browser = await puppeteer.launch({
      executablePath: "/snap/chromium/current/usr/lib/chromium-browser/chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();

    // Part 1: Scrape business links
    const url = process.argv[2];
    if (!url) {
      console.error("Error: No URL provided. Please provide a URL as a command-line argument.");
      process.exit(1);
    }

    console.log(`Navigating to the URL: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });

    // Handle cookie pop-up
    try {
      const acceptCookiesSelector = "form:nth-child(2)";
      await page.waitForSelector(acceptCookiesSelector, { timeout: 5000 });
      console.log("Accepting cookies...");
      await page.click(acceptCookiesSelector);
    } catch {
      console.log("No cookie pop-up detected. Proceeding...");
    }

    console.log("Scrolling the page to load all business links...");
    const links = await page.evaluate(async () => {
      const selector = ".hfpxzc";
      const uniqueLinks = new Set();

      const scrollAndCollect = async () => {
        let previousHeight;
        while (true) {
          previousHeight = document.body.scrollHeight;
          window.scrollBy(0, 1000);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          document.querySelectorAll(selector).forEach((el) => uniqueLinks.add(el.href));
          if (document.body.scrollHeight === previousHeight) break;
        }
      };

      await scrollAndCollect();
      return Array.from(uniqueLinks);
    });

    console.log(`Collected ${links.length} business links.`);
    fs.writeFileSync(businessLinksFile, JSON.stringify(links, null, 2));
    console.log(`Saved business links to '${businessLinksFile}'.`);

    await browser.close();

    // Part 2: Scrape business details
    if (!fs.existsSync(businessLinksFile)) {
      throw new Error(`File not found: ${businessLinksFile}. Aborting.`);
    }

    console.log("Reading business links...");
    const businessLinks = JSON.parse(fs.readFileSync(businessLinksFile));
    const results = [];

    console.log("Launching a new browser instance for scraping business details...");
    const browser2 = await puppeteer.launch({
      executablePath: "/snap/chromium/current/usr/lib/chromium-browser/chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });
    const page2 = await browser2.newPage();

    for (const [index, link] of businessLinks.entries()) {
      console.log(`Scraping ${index + 1}/${businessLinks.length}: ${link}`);
      try {
        await page2.goto(link, { waitUntil: "networkidle2" });

        const data = await page2.evaluate(() => {
          const extractText = (selector) => document.querySelector(selector)?.textContent.trim() || "N/A";
          const extractAttribute = (selector, attr) => document.querySelector(selector)?.getAttribute(attr) || "N/A";

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

          return {
            name: extractText("h1.DUwDvf.lfPIob"),
            rating: extractText(".F7nice span[aria-hidden='true']"),
            reviews: extractText(".F7nice span[aria-label*='reviews']").replace(/[()]/g, ""),
            businessType: extractText("button.DkEaL"),
            address: extractText("button.CsEnBe[data-item-id='address'] .Io6YTe.fontBodyMedium"),
            phone: extractText("button.CsEnBe[data-item-id^='phone:'] .Io6YTe.fontBodyMedium"),
            openTime: openTime,
            website: extractAttribute("a.CsEnBe[data-item-id='authority']", "href"),
          };
        });

        results.push({ link, ...data });
      } catch (error) {
        console.error(`Error scraping ${link}: ${error.message}`);
        results.push({ link, error: error.message });
      }
    }

    console.log("Scraping completed. Saving results...");
    fs.writeFileSync(businessDetailsFile, JSON.stringify(results, null, 2));
    console.log(`Business details saved to '${businessDetailsFile}'.`);

    // Convert JSON to CSV
    try {
      console.log("Converting business details to CSV...");
      const csv = parse(results);
      fs.writeFileSync(businessDetailsCSV, csv);
      console.log(`CSV file created: '${businessDetailsCSV}'.`);
    } catch (error) {
      console.error("Error converting JSON to CSV:", error.message);
    }

    await browser2.close();
    console.log("Script execution completed successfully.");
  } catch (error) {
    console.error("Error during script execution:", error.message);
  }
})();
