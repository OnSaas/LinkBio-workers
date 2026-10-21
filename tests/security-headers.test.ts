import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security";

describe("securityHeaders", () => {
  it("adds HSTS only for https and always sets object-src", () => {
    const https = securityHeaders(true);
    const http = securityHeaders(false);
    expect(https["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(https["Strict-Transport-Security"]).not.toContain("includeSubDomains");
    expect(http["Strict-Transport-Security"]).toBeUndefined();
    expect(http["Content-Security-Policy"]).toContain("object-src 'none'");
  });
});
