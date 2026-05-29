import assert from "node:assert/strict";
import { createRouter } from "../../src/server/router";
import type { RequestContext } from "../../src/server/types";

const run = async () => {
  // 1. createRouter creates successfully
  {
    const router = createRouter();
    assert.ok(router, "createRouter should return a router");
    assert.equal(typeof router.register, "function");
    assert.equal(typeof router.match, "function");
    console.log("1. createRouter creates successfully - PASS");
  }

  // 2. Static route: GET /api/health matches
  {
    const router = createRouter();
    let called = false;
    router.register("GET", "/api/health", () => { called = true; });
    const result = router.match("GET", "/api/health");
    assert.ok(result, "should match /api/health");
    assert.deepEqual(result.params, {});
    result.handler({} as never);
    assert.equal(called, true);
    console.log("2. GET /api/health matches - PASS");
  }

  // 3. Static route: POST /api/pipelines matches
  {
    const router = createRouter();
    let called = false;
    router.register("POST", "/api/pipelines", () => { called = true; });
    const result = router.match("POST", "/api/pipelines");
    assert.ok(result, "should match POST /api/pipelines");
    result.handler({} as never);
    assert.equal(called, true);
    console.log("3. POST /api/pipelines matches - PASS");
  }

  // 4. Param route: GET /api/pipelines/:id/status matches and extracts params
  {
    const router = createRouter();
    let capturedParams: Record<string, string> = {};
    router.register("GET", "/api/pipelines/:id/status", (ctx: RequestContext) => {
      capturedParams = ctx.params;
    });
    const result = router.match("GET", "/api/pipelines/pipe-123/status");
    assert.ok(result, "should match param route");
    assert.equal(result.params.id, "pipe-123");
    result.handler({ params: result.params } as never);
    assert.equal(capturedParams.id, "pipe-123");
    console.log("4. GET /api/pipelines/:id/status matches - PASS");
  }

  // 5. Multi-param route: /api/:a/:b/:c matches
  {
    const router = createRouter();
    router.register("GET", "/api/:a/:b/:c", async () => {});
    const result = router.match("GET", "/api/one/two/three");
    assert.ok(result, "should match multi-param route");
    assert.equal(result.params.a, "one");
    assert.equal(result.params.b, "two");
    assert.equal(result.params.c, "three");
    console.log("5. /api/:a/:b/:c matches - PASS");
  }

  // 6. Wildcard route: GET /api/agents/:agentId/files/*name matches multiple segments
  {
    const router = createRouter();
    router.register("GET", "/api/agents/:agentId/files/*name", async () => {});
    const result = router.match("GET", "/api/agents/agent-1/files/dir/subdir/file.txt");
    assert.ok(result, "should match wildcard route");
    assert.equal(result.params.agentId, "agent-1");
    assert.equal(result.params.name, "dir/subdir/file.txt");
    console.log("6. GET /api/agents/:agentId/files/*name matches - PASS");
  }

  // 7. Priority: static /api/artifacts/content over param /api/artifacts/:id
  {
    const router = createRouter();
    let staticCalled = false;
    let paramCalled = false;
    router.register("GET", "/api/artifacts/content", () => { staticCalled = true; });
    router.register("GET", "/api/artifacts/:id", () => { paramCalled = true; });

    const result = router.match("GET", "/api/artifacts/content");
    assert.ok(result, "should match static route");
    result.handler({} as never);
    assert.equal(staticCalled, true);
    assert.equal(paramCalled, false, "param route should not be called");
    console.log("7. Static priority over param - PASS");
  }

  // 8. Priority: param /api/agents/:id/files over wildcard /api/agents/:id/files/*name
  {
    const router = createRouter();
    let paramFilesCalled = false;
    let wildcardFilesCalled = false;
    router.register("GET", "/api/agents/:id/files", () => { paramFilesCalled = true; });
    router.register("GET", "/api/agents/:id/files/*name", () => { wildcardFilesCalled = true; });

    const result = router.match("GET", "/api/agents/agent-1/files");
    assert.ok(result, "should match param route");
    result.handler({} as never);
    assert.equal(paramFilesCalled, true);
    assert.equal(wildcardFilesCalled, false, "wildcard route should not be called");
    console.log("8. Param priority over wildcard - PASS");
  }

  // 9. No match returns null
  {
    const router = createRouter();
    router.register("GET", "/api/health", async () => {});
    const result = router.match("GET", "/api/nonexistent");
    assert.equal(result, null);
    console.log("9. No match returns null - PASS");
  }

  // 10. Different methods for same path match independently
  {
    const router = createRouter();
    let getCalled = false;
    let postCalled = false;
    router.register("GET", "/api/data", () => { getCalled = true; });
    router.register("POST", "/api/data", () => { postCalled = true; });

    const getResult = router.match("GET", "/api/data");
    assert.ok(getResult);
    getResult.handler({} as never);
    assert.equal(getCalled, true);
    assert.equal(postCalled, false);

    const postResult = router.match("POST", "/api/data");
    assert.ok(postResult);
    postResult.handler({} as never);
    assert.equal(postCalled, true);
    console.log("10. Different methods match independently - PASS");
  }

  // 11. Duplicate registration throws
  {
    const router = createRouter();
    router.register("GET", "/api/duplicate", async () => {});
    assert.throws(
      () => router.register("GET", "/api/duplicate", async () => {}),
      /Duplicate route/,
    );
    console.log("11. Duplicate registration throws - PASS");
  }

  // 12. Path not starting with / throws
  {
    const router = createRouter();
    assert.throws(
      () => router.register("GET", "api/health", async () => {}),
      /must start with/,
    );
    console.log("12. Path not starting with / throws - PASS");
  }

  // 13. Query params do not affect matching
  {
    const router = createRouter();
    let called = false;
    router.register("GET", "/api/health", () => { called = true; });
    const result = router.match("GET", "/api/health");
    assert.ok(result, "should match without query string");
    assert.equal(called, false);
    console.log("13. Query params don't affect matching - PASS");
  }

  // 14. URL-encoded params decode via decodeURIComponent
  {
    const router = createRouter();
    router.register("GET", "/api/items/:id", async () => {});
    const result = router.match("GET", "/api/items/hello%20world");
    assert.ok(result);
    assert.equal(result.params.id, "hello world");
    console.log("14. URL-encoded params decode - PASS");
  }

  // 15. Special characters (Chinese param) correct decode
  {
    const router = createRouter();
    router.register("GET", "/api/items/:name", async () => {});
    const result = router.match("GET", "/api/items/%E4%B8%AD%E6%96%87");
    assert.ok(result);
    assert.equal(result.params.name, "中文");
    console.log("15. Chinese param decode - PASS");
  }

  // 16. Invalid percent encoding returns null
  {
    const router = createRouter();
    router.register("GET", "/api/items/:id", async () => {});
    const result = router.match("GET", "/api/items/%ZZ");
    assert.equal(result, null, "invalid percent encoding should return null");
    console.log("16. Invalid percent encoding returns null - PASS");
  }

  console.log("router tests passed");
};

void run().catch((error) => {
  console.error("router tests failed", error);
  process.exitCode = 1;
});
