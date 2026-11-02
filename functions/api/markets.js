import { DIGIT_MARKETS, DIGIT_CONTRACT_TYPES } from "../_lib/digit-markets.js";

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    scope: "digit-contracts",
    markets: DIGIT_MARKETS,
    contractTypes: DIGIT_CONTRACT_TYPES
  }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}
