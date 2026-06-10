import { Agent } from "@mastra/core/agent";
import { StagehandBrowser } from "@mastra/stagehand";
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url).pathname });

const featherlessApiKey = process.env.FEATHERLESS_API_KEY;
if (!featherlessApiKey) {
  throw new Error("FEATHERLESS_API_KEY is missing. Add it to your .env file.");
}
console.log("FEATHERLESS_API_KEY loaded:", featherlessApiKey ? `${featherlessApiKey.slice(0, 8)}...` : "MISSING");

// Stagehand's internal AI SDK reads these env vars for the openai/ provider
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || featherlessApiKey;
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.featherless.ai/v1";

const email = process.env.PRESSMASTERS_EMAIL;
const password = process.env.PRESSMASTERS_PASSWORD;

if (!email || !password) {
  throw new Error("Set PRESSMASTERS_EMAIL and PRESSMASTERS_PASSWORD env vars before running.");
}

const browser = new StagehandBrowser({
  env: "LOCAL",
  headless: false,
  verbose: 2,
  model: "zai-org/GLM-5.1",
});

export const loginAgent = new Agent({
  id: "login-agent",
  name: "Login Agent",
  instructions: `You are a web automation assistant that logs into Pressmasters.ai.

Use stagehand tools to interact with pages:
- stagehand_navigate to go to URLs
- stagehand_act to perform actions described in natural language
- stagehand_extract to get structured data from the page
- stagehand_observe to find available actions on the page
- stagehand_screenshot to visually inspect the page`,
  model: {
    id: "featherless/zai-org/GLM-5.1",
    apiKey: featherlessApiKey,
    url: "https://api.featherless.ai/v1",
  },
  browser,
});

async function login() {
  const result = await loginAgent.generate(
    `Log into https://app.pressmaster.ai/sign-in with email ${email} and password ${password}. Then confirm if login was successful by extracting the page heading.`,
  );
  console.log("Login result:", result.text);
  return result.text;
}

login().catch(console.error);
