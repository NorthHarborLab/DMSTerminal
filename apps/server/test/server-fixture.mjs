import { createApplication } from "../dist/index.js";

// This module is a local test entry, is not packaged and has no production configuration switch
const identities = new Map([
  ["id=test-alice", { username: "alice", uid: "1026" }],
  ["id=test-bob", { username: "bob", uid: "1027" }]
]);
const { server } = await createApplication({ authMode: "dsm-cgi",
  verifyIdentity: async (context) => context.synoToken === "test-syno-token" ? identities.get(context.cookie) : undefined
});
server.listen(0, "127.0.0.1", () => console.log(`DSM Terminal listening on http://127.0.0.1:${server.address().port}`));
