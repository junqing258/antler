import { useState } from "react";
import { fetch as expoFetch } from "expo/fetch";
import { Pressable, Text, View } from "react-native";
import { Probe } from "./probe";
import { NativeChatProbe } from "./native-chat";

export function App() {
  const [showStream, setShowStream] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setShowStream((value) => !value)}
        style={{ padding: 12, paddingTop: 48 }}
      >
        <Text>{showStream ? "打开聊天验证" : "打开流式诊断"}</Text>
      </Pressable>
      {showStream ? <Probe streamFetch={expoFetch} /> : <NativeChatProbe />}
    </View>
  );
}
