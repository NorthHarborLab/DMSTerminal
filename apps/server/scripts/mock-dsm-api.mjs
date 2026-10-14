import http from "node:http";

const port = Number(process.env.MOCK_DSM_PORT ?? 46901);

const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url?.startsWith("/webapi/entry.cgi") && request.headers.cookie === "id=valid") {
    response.end(JSON.stringify({ success: true, data: { model: "mock-dsm" } }));
    return;
  }
  response.end(JSON.stringify({ success: false, error: { code: 119 } }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock DSM API listening on http://127.0.0.1:${port}`);
});
