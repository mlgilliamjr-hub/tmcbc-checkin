// Vercel Serverless Function -- Planning Center API Proxy
const PC_BASE = "https://api.planningcenteronline.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const PC_APP_ID = process.env.PC_APP_ID;
  const PC_SECRET = process.env.PC_SECRET;
  if (!PC_APP_ID || !PC_SECRET) return res.status(500).json({ error: "Credentials not configured" });

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path" });

  const pcPath = Array.isArray(path) ? "/" + path.join("/") : path;
  const queryParams = { ...req.query };
  delete queryParams.path;
  const queryString = new URLSearchParams(queryParams).toString();
  const fullUrl = PC_BASE + pcPath + (queryString ? "?" + queryString : "");

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
    const data = await pcRes.json();
    return res.status(pcRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
