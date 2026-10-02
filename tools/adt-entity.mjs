import {createHash} from "node:crypto";

// ADT persists the entity tag from a properties/source response alongside
// the workspace file. Without it the filesystem synchronizer refuses to
// create the editor part. The tag describes the representation, so properties
// and source intentionally get different values and change with their body.
export const entityTag = (body) => createHash("sha256")
  .update(Buffer.from(String(body))).digest("hex").slice(0, 32);
export const normalizedTag = (value) => String(value ?? "").trim()
  .replace(/^W\//, "").replace(/^"|"$/g, "");

export const sendEntity = (req, res, body) => {
  const tag = entityTag(body);
  res.set("ETag", tag);
  const candidates = String(req.headers["if-none-match"] ?? "")
    .split(",").map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""));
  if (candidates.includes(tag)) {
    res.status(304).end();
    return;
  }
  res.send(body);
};
