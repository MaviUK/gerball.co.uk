import { createHandler } from "./collector.mjs";

Deno.serve(createHandler());
