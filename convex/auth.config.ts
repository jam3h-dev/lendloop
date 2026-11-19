import type { AuthConfig } from "convex/server";

// Clerk JWT template must be named "convex". Set CLERK_JWT_ISSUER_DOMAIN on
// the Convex deployment (npx convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
