export function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const base: Record<string, string> = { 
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS", 
    "Vary": "Origin" 
  };
  if (!origin) return base;
  return allowed.includes(origin) ? { ...base, "Access-Control-Allow-Origin": origin } : null;
}

export function jsonError(status: number, code: string, headers: HeadersInit) {
  return new Response(JSON.stringify({ error: code }), { 
    status, 
    headers: { ...headers, "Content-Type": "application/json" } 
  });
}
