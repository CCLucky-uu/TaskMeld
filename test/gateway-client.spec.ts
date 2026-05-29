import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { createGatewayClient } from "../src/gateway";

const run = async () => {
  const clientA = createGatewayClient({
    gatewayUrl: "ws://127.0.0.1:65535",
    token: "test-token",
  });
  assert.equal(clientA.getStatus().status, "idle", "client should start idle");
  clientA.close();

  const clientB = createGatewayClient({
    gatewayUrl: "ws://127.0.0.1:65535",
    token: "test-token",
  });
  await assert.rejects(clientB.sendReq("agent.run", {}), /gateway_not_ready/);
  clientB.close();

  const server = new WebSocketServer({ port: 0 });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("invalid_test_server_address");
  }
  const receivedMessages: string[] = [];
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      receivedMessages.push(data.toString());
    });
  });

  const clientC = createGatewayClient({
    gatewayUrl: `ws://127.0.0.1:${address.port}`,
    token: "test-token",
  });
  const connectPromise = clientC.connect().catch((error) => error);
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(receivedMessages, [], "client must not send connect before gateway challenge");
  } finally {
    clientC.close();
    await connectPromise;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("gateway-client smoke tests passed");
};

void run().catch((error) => {
  console.error("gateway-client smoke tests failed", error);
  process.exitCode = 1;
});
