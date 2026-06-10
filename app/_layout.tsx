import { Stack } from "expo-router/stack";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Stack
        screenOptions={{
          headerLargeTitle: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#f7f7f4" },
          contentStyle: { backgroundColor: "#f7f7f4" }
        }}
      >
        <Stack.Screen name="index" options={{ title: "Stock Report" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
