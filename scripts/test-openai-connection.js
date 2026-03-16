const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

async function main() {
  if (!OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY.");
    process.exitCode = 1;
    return;
  }

  console.log(`Testing OpenAI connection with model: ${OPENAI_MODEL}`);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_output_tokens: 16,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Reply with exactly: ok",
            },
          ],
        },
      ],
    }),
  });

  const rawText = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errorMessage = parsed?.error?.message || rawText || "Unknown error";
    console.error(`OpenAI connection test failed: ${response.status} ${errorMessage}`);
    process.exitCode = 1;
    return;
  }

  const outputText = String(parsed?.output_text || "").trim();
  console.log("OpenAI connection test succeeded.");
  console.log(`Status: ${response.status}`);
  console.log(`Response text: ${outputText || "(empty output_text)"}`);
}

main().catch((error) => {
  console.error(`OpenAI connection test crashed: ${error.message}`);
  process.exitCode = 1;
});
