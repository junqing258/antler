import { useState } from "react";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { HomePage } from "../views/home/home-page";
import { Probe } from "../experiments/probe";
import { Button } from "../components/button";
import { useRoot } from "../views/root/root-context";

/** `/` 主页路由：探针开关（仅自动化构建）+ 主页 + 退出登录。 */
export function HomeRoute() {
  const root = useRoot();
  const [showProbe, setShowProbe] = useState(false);
  if (!root.boot) return null;
  const { boot } = root;
  return (
    <>
      {boot.automationEnabled && (
        <Button
          label={showProbe ? "返回主页" : "流式诊断"}
          onPress={() => setShowProbe((value) => !value)}
        />
      )}
      {showProbe && boot.automationEnabled ? (
        <Probe streamFetch={expoFetch} />
      ) : (
        <HomePage
          config={boot.config}
          getToken={root.getToken}
          onUnauthorized={root.onUnauthorized}
          isCurrent={root.isCurrent}
          onOpenSettings={() => root.openSettings()}
          onOpenAgent={(agentId) =>
            root.openChat(
              { id: Crypto.randomUUID(), agentId },
              "push",
            )
          }
          onOpenConversation={(id, agentId, title) =>
            root.openChat({ id, agentId, title: title || "新会话" }, "push")
          }
        />
      )}
    </>
  );
}

export default HomeRoute;
