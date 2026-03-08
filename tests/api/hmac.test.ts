import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSignatureHeader, verifyWebhookSignature } from "../../src/api/hmac.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWebhookSignature", () => {
  const secret = "test-secret-key";
  const body = '{"action":"update","type":"Issue"}';

  it("returns valid for correct signature", () => {
    const sig = sign(body, secret);
    const result = verifyWebhookSignature(body, secret, sig);
    expect(result).toEqual({ valid: true });
  });

  it("returns valid for correct signature with sha256= prefix", () => {
    const sig = `sha256=${sign(body, secret)}`;
    const result = verifyWebhookSignature(body, secret, sig);
    expect(result).toEqual({ valid: true });
  });

  it("returns invalid for wrong signature", () => {
    const result = verifyWebhookSignature(body, secret, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(result).toEqual({ valid: false, error: "Invalid signature" });
  });

  it("returns invalid for missing signature", () => {
    const result = verifyWebhookSignature(body, secret, undefined);
    expect(result).toEqual({ valid: false, error: "Missing signature header" });
  });

  it("returns invalid for empty signature", () => {
    const result = verifyWebhookSignature(body, secret, "");
    expect(result).toEqual({ valid: false, error: "Missing signature header" });
  });

  it("returns invalid for wrong secret", () => {
    const sig = sign(body, "wrong-secret");
    const result = verifyWebhookSignature(body, secret, sig);
    expect(result).toEqual({ valid: false, error: "Invalid signature" });
  });
});

describe("getSignatureHeader", () => {
  it("returns x-hub-signature-256 for github type", () => {
    expect(getSignatureHeader({ type: "github", config: {} })).toBe("x-hub-signature-256");
  });

  it("returns x-linear-signature for linear type", () => {
    expect(getSignatureHeader({ type: "linear", config: {} })).toBe("x-linear-signature");
  });

  it("returns custom header from config.signatureHeader", () => {
    expect(getSignatureHeader({ type: "webhook", config: { signatureHeader: "x-custom-sig" } })).toBe("x-custom-sig");
  });

  it("returns default x-webhook-signature for unknown type", () => {
    expect(getSignatureHeader({ type: "webhook", config: {} })).toBe("x-webhook-signature");
  });

  it("is case-insensitive for source type (GitHub → github)", () => {
    expect(getSignatureHeader({ type: "GitHub", config: {} })).toBe("x-hub-signature-256");
  });

  it("is case-insensitive for source type (LINEAR → linear)", () => {
    expect(getSignatureHeader({ type: "LINEAR", config: {} })).toBe("x-linear-signature");
  });
});
