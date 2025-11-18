import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { getLogs } from "../utils/logger.server.js";

export async function loader({ request }) {
  const auth = await authenticate.public.appProxy(request);

  let cors = (res) => res;
  if (auth && typeof auth.cors === "function") {
    cors = auth.cors;
  }
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Number.isFinite(Number(limitParam))
    ? Math.max(1, Math.min(500, Number(limitParam)))
    : 100;

  const logs = getLogs(limit);

  return cors(
    json({
      success: true,
      count: logs.length,
      logs,
    })
  );
}
