import { createRequestHandler } from "@remix-run/architect";

exports.handler = createRequestHandler({
  build: require("../build"),
});
