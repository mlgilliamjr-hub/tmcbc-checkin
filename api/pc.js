// Vercel Serverless Function -- Planning Center API Proxy
const PC_BASE = "https://api.planningcenteronline.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PC_APP_ID = process.env.PC_APP_ID;
  const PC_SECRET = process.env.PC_SECRET;
  if (!PC_APP_ID || !PC_SECRET) {
    return res.status(500).json({ error: "Credentials not configured" });
  }

  // Extract the PC path from the request URL
  // e.g. /api/pc/people/v2/people -> /people/v2/people
  const reqUrl = req.url || "";
  const pcPath = reqUrl.replace(/^\/api\/pc/, "") || "/";

  const fullUrl = PC_BASE + pcPath;

  try {
    const pcRes = await fetch(fullUrl, {
      method: req.method,
      headers: {
        Authorization: "Basic " + Buffer.from(PC_APP_ID + ":" + PC_SECRET).toString("base64"),
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: req.method !== "GET" && req.body ? JSON.stringify(req.body) : undefined,
    });

    const text = await pcRes.text();
    try {
      const data = JSON.parse(text);
      return res.status(pcRes.status).json(data);
    } catch (e) {
      return res.status(pcRes.status).send(text);
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
