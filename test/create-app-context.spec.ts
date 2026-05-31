import assert from "node:assert/strict";
import { createAppContext } from "../src/app/create-app-context";

const run = async () => {
  {
    const appContext = createAppContext({
      env: {
        API_PORT: "54320",
      },
    });

    // 宿主进程允许先起服务，再把“缺少网关配置”的失败保留到首次真正连网关时触发；
    // 这样本地开发和只看本地状态的路径不会在装配阶段被硬阻断。
    assert.equal(appContext.gateway.client.getStatus().status, "idle");
    await assert.rejects(
      () => appContext.gateway.connect(),
      (error: unknown) => error instanceof Error && error.message === "missing_required_env:OPENCLAW_GATEWAY_URL",
    );
    appContext.dispose();
  }

  {
    const appContext = createAppContext({
      env: {
        OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:18789",
        OPENCLAW_GATEWAY_TOKEN: "test-token",
      },
    });

    assert.equal(appContext.gateway.url, "ws://127.0.0.1:18789");
    assert.equal(appContext.gateway.token, "test-token");
    assert.deepEqual(appContext.gateway.client.getStatus().scopes, appContext.gateway.scopes);
    appContext.dispose();
  }
};

void run();
