// Serves build/ the way a static host would, for a local look at the preview
// and for test/e2e/preview.spec.mjs. STG_PREVIEW_PORT, default 3031.
import express from "express";
import {fileURLToPath} from "node:url";

const app = express();
app.disable("x-powered-by");
app.use(express.static(fileURLToPath(new URL("../build", import.meta.url))));
const port = Number(process.env.STG_PREVIEW_PORT ?? 3031);
app.listen(port, () => console.log(`preview build on http://localhost:${port}/`));
