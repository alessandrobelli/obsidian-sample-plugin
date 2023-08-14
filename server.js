"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const proxyMiddleware = require("obsidian-http-request/server/http-proxy");

const PORT = process.env.PORT || 3042;

const app = express();

app.use("/proxy", bodyParser.raw({ type: "application/json" }));
app.use(
	"/proxy",
	proxyMiddleware({
		maxContentLength: 5 * 1024 * 1024, // Allows to transfer files of 5 MiB max
		allowedPorts: [80, 443], // Allows to download from ports 80 (http) and 443 (https)
		allowedMethods: ["GET"], // Allows to forward only GET requests
	})
);

console.log(`Starting Obsidian Proxy Server on 0.0.0.0:${PORT}`);
app.listen(PORT);
