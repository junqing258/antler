import { useEffect } from "react";
import { useRouter } from "expo-router";

/**
 * 兜底路由：antler://autostart 等非页面深链不应渲染任何 UI。
 * 挂载即回主页，避免冷启动停留在空白兜底页；自动化参数由根容器的
 * Linking 监听单独处理，不在此处消费。
 */
export default function UnmatchedRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
