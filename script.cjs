const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const { parse } = require("json2csv");

puppeteer.use(StealthPlugin());

(async () => {
  const businessLinksFile = "business_links.json";
  const businessDetailsFile = "public/updated_business_details.json";
  const businessDetailsCSV = "public/updated_business_details.csv";

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Part 1: Scrape business links
    const url = process.argv[2]; // Get the URL from command-line arguments
    if (!url) {
    console.error("URL not provided.");
    process.exit(1);
    }

    await page.goto(url, { waitUntil: "networkidle2" });

    try {
      const acceptCookiesSelector = "form:nth-child(2)";
      await page.waitForSelector(acceptCookiesSelector, { timeout: 5000 });
      await page.click(acceptCookiesSelector);
    } catch (error) {
      console.log("No cookies pop-up found, proceeding...");
    }

    const links = [];
    const businessSelector = ".hfpxzc";

    await page.evaluate(async () => {
      const searchResultsSelector = 'div[role="feed"]';
      const wrapper = document.querySelector(searchResultsSelector);

      await new Promise((resolve) => {
        const distance = 1000;
        const scrollDelay = 3000;
        let totalHeight = 0;
        let attempts = 0;

        const timer = setInterval(async () => {
          const scrollHeightBefore = wrapper.scrollHeight;
          wrapper.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeightBefore) {
            totalHeight = 0;
            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, scrollDelay));
            const scrollHeightAfter = wrapper.scrollHeight;

            if (scrollHeightAfter <= scrollHeightBefore || attempts > 5) {
              clearInterval(timer);
              resolve();
            }
          }
        }, 500);
      });
    });

    const extractedLinks = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map((el) => el.href);
    }, businessSelector);

    extractedLinks.forEach((link) => {
      if (!links.includes(link)) {
        links.push(link);
      }
    });

    fs.writeFileSync(businessLinksFile, JSON.stringify(links, null, 2));
    console.log(`Collected ${links.length} business links.`);

    await browser.close();

    // Part 2: Scrape business details using collected links
    if (!fs.existsSync(businessLinksFile)) {
      throw new Error(`${businessLinksFile} not found. Aborting business details scraping.`);
    }

    const businessLinks = JSON.parse(fs.readFileSync(businessLinksFile));
    const results = [];
    const browser2 = await puppeteer.launch({ headless: true });
    const page2 = await browser2.newPage();

    for (let i = 0; i < businessLinks.length; i++) {
      const link = businessLinks[i];
      console.log(`Scraping business ${i + 1} of ${businessLinks.length}: ${link}`);

      try {
        await page2.goto(link, { waitUntil: "networkidle2" });

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
        console.log(`Failed to scrape ${link}:`, error.message);
        results.push({ link, error: error.message });
      }
    }

    fs.writeFileSync(businessDetailsFile, JSON.stringify(results, null, 2));
    console.log(`Scraping completed. Results saved to '${businessDetailsFile}'.`);

    // Convert JSON to CSV
    try {
      const csv = parse(results);
      fs.writeFileSync(businessDetailsCSV, csv);
      console.log(`CSV file created: ${businessDetailsCSV}`);
    } catch (error) {
      console.error("Error while converting JSON to CSV:", error.message);
    }

    await browser2.close();
  } catch (error) {
    console.error("Error in script execution:", error.message);
  }
})();
