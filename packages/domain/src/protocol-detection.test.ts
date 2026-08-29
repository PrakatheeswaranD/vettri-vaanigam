import { describe, it, expect } from "vitest";
import { detectProtocol, PROTOCOL_HEADER, PROTOCOL_VERSION_HEADER } from "./protocol-detection.js";

describe("protocol detection", () => {
  it("trusts an explicit header over anything in the body", () => {
    const result = detectProtocol({ [PROTOCOL_HEADER]: "ACP" }, { x402Version: 1 });
    expect(result).toMatchObject({ protocol: "ACP", source: "HEADER" });
  });

  it("carries the declared protocol version through", () => {
    const result = detectProtocol({ [PROTOCOL_HEADER]: "acp", [PROTOCOL_VERSION_HEADER]: "2026-04-01" }, {});
    expect(result).toMatchObject({ protocol: "ACP", version: "2026-04-01" });
  });

  it("accepts spelled-out and punctuated protocol names", () => {
    expect(detectProtocol({ [PROTOCOL_HEADER]: "agentic-commerce-protocol" }, {}).protocol).toBe("ACP");
    expect(detectProtocol({ [PROTOCOL_HEADER]: "x-402" }, {}).protocol).toBe("X402");
    expect(detectProtocol({ [PROTOCOL_HEADER]: "AP-2" }, {}).protocol).toBe("AP2");
  });

  it("infers x402 from its version marker", () => {
    expect(detectProtocol({}, { x402Version: 1 })).toMatchObject({ protocol: "X402", source: "BODY_SHAPE" });
  });

  it("infers x402 from an exact-scheme payment payload", () => {
    const body = { scheme: "exact", network: "base-sepolia", payload: { authorization: {} } };
    expect(detectProtocol({}, body).protocol).toBe("X402");
  });

  it("infers AP2 from a cart mandate envelope", () => {
    expect(detectProtocol({}, { cart_mandate: { contents: {} } }).protocol).toBe("AP2");
  });

  it("infers ACP from line items plus a buyer block", () => {
    const body = { items: [{ id: "sku-1", quantity: 1 }], buyer: { email: "a@b.test" } };
    expect(detectProtocol({}, body)).toMatchObject({ protocol: "ACP", source: "BODY_SHAPE" });
  });

  /**
   * A caller that named a protocol we do not implement must NOT then be
   * shape-sniffed. It told us what it is; parsing its body with a
   * different adapter risks reading the wrong field as an amount.
   */
  it("refuses to sniff the body when an unsupported protocol was declared", () => {
    const body = { items: [{ id: "sku-1" }], buyer: {} };
    const result = detectProtocol({ [PROTOCOL_HEADER]: "UAP" }, body);
    expect(result.protocol).toBe("UNKNOWN");
  });

  it("returns UNKNOWN rather than guessing at an unrecognised body", () => {
    expect(detectProtocol({}, { hello: "world" }).protocol).toBe("UNKNOWN");
    expect(detectProtocol({}, null).protocol).toBe("UNKNOWN");
    expect(detectProtocol({}, "not-an-object").protocol).toBe("UNKNOWN");
  });

  it("handles a repeated header without crashing", () => {
    expect(detectProtocol({ [PROTOCOL_HEADER]: ["AP2", "ACP"] }, {}).protocol).toBe("AP2");
  });
});
