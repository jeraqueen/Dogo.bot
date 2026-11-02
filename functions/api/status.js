export async function onRequestGet({ env }) {
  const appId = "34QAdfWKVQBkld9sq3LRi";
  const token = env.DERIV_API_TOKEN;

  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (!token) {
    return new Response(JSON.stringify({
      ok: false,
      connected: false,
      message: "DERIV_API_TOKEN is missing from the Pages production environment."
    }), { status: 503, headers });
  }

  try {
    const upstream = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Deriv-App-ID": appId,
        "Accept": "application/json"
      }
    });

    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 300) }; }

    if (!upstream.ok) {
      return new Response(JSON.stringify({
        ok: false,
        connected: false,
        httpStatus: upstream.status,
        message: data?.message || data?.error?.message || "Deriv rejected the authentication request."
      }), { status: 502, headers });
    }

    return new Response(JSON.stringify({
      ok: true,
      connected: true,
      appIdConfigured: true,
      message: "Deriv API authentication succeeded. Account-specific trading connection is the next step.",
      accounts: Array.isArray(data?.data) ? data.data.map(a => ({
        accountId: a.account_id || a.id || null,
        currency: a.currency || null,
        accountType: a.account_type || null,
        status: a.status || null
      })) : undefined
    }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      connected: false,
      message: "Could not reach Deriv API.",
      detail: String(error?.message || error)
    }), { status: 502, headers });
  }
}
