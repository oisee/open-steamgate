import {expect} from "chai";
import {decompressSAP, parseSAPCompressHeader, SAPCompressError} from "../tools/protocols/sap-compress.mjs";

describe("the built-in MIT SAP compression decoder", () => {
  const plain = Buffer.from("abc", "ascii");
  const lzc = Buffer.from("03000000111f9d8d61c48c01", "hex");
  const lzh = Buffer.from("03000000121f9d027f8949c90000", "hex");

  it("decodes the compact LZC form used by SAP GUI PAI frames", () => {
    expect(decompressSAP(lzc).equals(plain)).to.equal(true);
  });

  it("decodes SAP's prefixed raw-DEFLATE LZH form", () => {
    expect(decompressSAP(lzh).equals(plain)).to.equal(true);
  });

  it("bounds declared output before allocating it", () => {
    expect(() => parseSAPCompressHeader(lzc, {maxOutputLength: 2})).to.throw(SAPCompressError);
    expect(() => decompressSAP(Buffer.from("0300000012000000", "hex"))).to.throw(SAPCompressError);
  });
});
