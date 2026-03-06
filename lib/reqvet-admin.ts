// lib/reqvet-admin.ts — Client ReqVet avec cle reseller
// Utilise uniquement dans les routes /api/admin/*
// Ne jamais importer depuis un composant client ou une route non-admin
import ReqVet from "@reqvet-sdk/sdk";

let _client: ReqVet | null = null;

export function getResellerClient(): ReqVet {
  if (!process.env.REQVET_RESELLER_API_KEY) {
    throw new Error("REQVET_RESELLER_API_KEY manquante — ce Vetpulse n'est pas configure en mode admin reseller.");
  }
  if (!_client) {
    _client = new ReqVet(process.env.REQVET_RESELLER_API_KEY, {
      baseUrl: process.env.REQVET_BASE_URL ?? "https://api.reqvet.com",
    });
  }
  return _client;
}
