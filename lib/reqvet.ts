// lib/reqvet.ts — Singleton côté serveur (ne jamais importer depuis un composant client)
// Pattern proxy : la clé API reste ici, jamais exposée au navigateur
import ReqVet from "@reqvet-sdk/sdk";

if (!process.env.REQVET_API_KEY) {
  throw new Error("REQVET_API_KEY manquante dans .env.local");
}

export const reqvet = new ReqVet(process.env.REQVET_API_KEY, {
  baseUrl: process.env.REQVET_BASE_URL ?? "https://api.reqvet.com",
  pollInterval: 5000,
  timeout: 5 * 60 * 1000,
});
